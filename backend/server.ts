import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { PrismaClient, Role } from '@prisma/client';
import { z } from 'zod';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const localEnvPath=fileURLToPath(new URL('.env',import.meta.url));
if(existsSync(localEnvPath))process.loadEnvFile(localEnvPath);

const prisma=new PrismaClient();
const app=express();
const allowedOrigins=process.env.CORS_ORIGIN?.split(',').map(value=>value.trim().replace(/\/+$/,'')).filter(Boolean);
app.use(cors({origin:allowedOrigins?.length?allowedOrigins:true})); app.use(express.json());
type Actor={id:string;role:Role;baseId?:string};
declare global { namespace Express { interface Request { actor?:Actor } } }

const scrypt=promisify(scryptCallback);
const jwtSecret=process.env.JWT_SECRET||'development-only-secret';
const publicUserSelect={id:true,name:true,email:true,role:true,baseId:true,createdAt:true} as const;

async function hashPassword(password:string){
  const salt=randomBytes(16).toString('hex');
  const hash=await scrypt(password,salt,64) as Buffer;
  return `${salt}:${hash.toString('hex')}`;
}

async function passwordMatches(password:string,stored:string){
  const [salt,hex]=stored.split(':');
  if(!salt||!hex)return false;
  const storedHash=Buffer.from(hex,'hex');
  const suppliedHash=await scrypt(password,salt,storedHash.length) as Buffer;
  return storedHash.length===suppliedHash.length&&timingSafeEqual(storedHash,suppliedHash);
}

function issueToken(user:{id:string;role:Role;baseId:string|null}){
  return jwt.sign({id:user.id,role:user.role,...(user.baseId&&{baseId:user.baseId})},jwtSecret,{expiresIn:'8h'});
}

const credentialsSchema=z.object({email:z.string().email().transform(value=>value.toLowerCase().trim()),password:z.string().min(8).max(128)});
const signupSchema=credentialsSchema.extend({name:z.string().trim().min(2).max(80),baseId:z.string().optional()});

app.get('/api/health',(_req,res)=>res.json({status:'ok',service:'military-assets-api'}));

app.post('/api/auth/signup',async(req,res,next)=>{try{
  const data=signupSchema.parse(req.body);
  const existing=await prisma.user.findUnique({where:{email:data.email}});
  if(existing)return res.status(409).json({error:'An account with this email already exists'});
  if(data.baseId&&!await prisma.base.findUnique({where:{id:data.baseId}}))return res.status(400).json({error:'Selected base does not exist'});
  const user=await prisma.user.create({data:{name:data.name,email:data.email,passwordHash:await hashPassword(data.password),role:'LOGISTICS_OFFICER',baseId:data.baseId},select:publicUserSelect});
  await prisma.auditLog.create({data:{userId:user.id,action:'USER_SIGNUP',entityType:'User',entityId:user.id,method:req.method,path:req.path,ipAddress:req.ip}});
  res.status(201).json({user,token:issueToken(user)});
}catch(e){next(e)}});

app.post('/api/auth/login',async(req,res,next)=>{try{
  const data=credentialsSchema.parse(req.body);
  const user=await prisma.user.findUnique({where:{email:data.email}});
  if(!user||!await passwordMatches(data.password,user.passwordHash))return res.status(401).json({error:'Invalid email or password'});
  await prisma.auditLog.create({data:{userId:user.id,action:'USER_LOGIN',entityType:'User',entityId:user.id,method:req.method,path:req.path,ipAddress:req.ip}});
  const {passwordHash:_,...safeUser}=user;
  res.json({user:safeUser,token:issueToken(user)});
}catch(e){next(e)}});

function authenticate(req:Request,res:Response,next:NextFunction){
  const raw=req.headers.authorization?.replace(/^Bearer /,'');
  if(!raw && process.env.NODE_ENV!=='production'){req.actor={id:'development-admin',role:'ADMIN'};return next()}
  try{req.actor=jwt.verify(raw!,jwtSecret) as Actor;next()}catch{return res.status(401).json({error:'Invalid or missing access token'})}
}
const permit=(...roles:Role[])=>(req:Request,res:Response,next:NextFunction)=>roles.includes(req.actor!.role)?next():res.status(403).json({error:'Insufficient permissions'});
const enforceBase=(requested:string|undefined,actor:Actor)=>actor.role==='BASE_COMMANDER'&&requested!==actor.baseId?false:true;
async function audit(req:Request,action:string,entityType:string,entityId?:string,metadata?:unknown){await prisma.auditLog.create({data:{userId:req.actor?.id==='development-admin'?undefined:req.actor?.id,action,entityType,entityId,method:req.method,path:req.path,ipAddress:req.ip,metadata:metadata?JSON.stringify(metadata):undefined}})}
app.use('/api',authenticate);

app.get('/api/auth/me',async(req,res,next)=>{try{const user=await prisma.user.findUnique({where:{id:req.actor!.id},select:publicUserSelect});if(!user)return res.status(404).json({error:'User not found'});res.json({user})}catch(e){next(e)}});

app.get('/api/dashboard',async(req,res,next)=>{try{const baseId=req.actor!.role==='BASE_COMMANDER'?req.actor!.baseId:req.query.baseId as string|undefined;const from=req.query.from?new Date(String(req.query.from)):new Date(new Date().getFullYear(),new Date().getMonth(),1);const to=req.query.to?new Date(String(req.query.to)):new Date();const where={...(baseId&&{baseId}),occurredAt:{gte:from,lte:to}};const grouped=await prisma.movement.groupBy({by:['type'],where,_sum:{quantity:true}});const v=(t:string)=>grouped.find(x=>x.type===t)?._sum.quantity||0;const before=await prisma.movement.aggregate({where:{...(baseId&&{baseId}),occurredAt:{lt:from}},_sum:{quantity:true}});const opening=before._sum.quantity||0;const purchases=v('PURCHASE'),transferIn=v('TRANSFER_IN'),transferOut=Math.abs(v('TRANSFER_OUT'));res.json({opening,closing:opening+purchases+transferIn-transferOut-v('EXPENDITURE'),purchases,transferIn,transferOut,assigned:Math.abs(v('ASSIGNMENT')),expended:Math.abs(v('EXPENDITURE'))})}catch(e){next(e)}});

const purchaseSchema=z.object({baseId:z.string(),assetId:z.string(),quantity:z.number().int().positive(),unitCost:z.number().nonnegative().optional(),purchasedAt:z.coerce.date(),reference:z.string().max(80).optional()});
app.get('/api/purchases',permit('ADMIN','BASE_COMMANDER','LOGISTICS_OFFICER'),async(req,res,next)=>{try{const baseId=req.actor!.role==='BASE_COMMANDER'?req.actor!.baseId:req.query.baseId as string|undefined;res.json(await prisma.purchase.findMany({where:{...(baseId&&{baseId})},include:{asset:true,base:true},orderBy:{purchasedAt:'desc'}}))}catch(e){next(e)}});
app.post('/api/purchases',permit('ADMIN','LOGISTICS_OFFICER'),async(req,res,next)=>{try{const d=purchaseSchema.parse(req.body);if(!enforceBase(d.baseId,req.actor!))return res.status(403).json({error:'Base access denied'});const item=await prisma.$transaction(async tx=>{const p=await tx.purchase.create({data:d});await tx.inventoryBalance.upsert({where:{baseId_assetId:{baseId:d.baseId,assetId:d.assetId}},create:{baseId:d.baseId,assetId:d.assetId,quantity:d.quantity},update:{quantity:{increment:d.quantity}}});await tx.movement.create({data:{type:'PURCHASE',baseId:d.baseId,assetId:d.assetId,quantity:d.quantity,occurredAt:d.purchasedAt,referenceType:'Purchase',referenceId:p.id}});return p});await audit(req,'PURCHASE_CREATED','Purchase',item.id,d);res.status(201).json(item)}catch(e){next(e)}});

const transferSchema=z.object({fromBaseId:z.string(),toBaseId:z.string(),assetId:z.string(),quantity:z.number().int().positive(),transferredAt:z.coerce.date(),reference:z.string().max(80).optional()}).refine(x=>x.fromBaseId!==x.toBaseId,'Bases must differ');
app.get('/api/transfers',permit('ADMIN','BASE_COMMANDER','LOGISTICS_OFFICER'),async(req,res,next)=>{try{const baseId=req.actor!.role==='BASE_COMMANDER'?req.actor!.baseId:req.query.baseId as string|undefined;res.json(await prisma.transfer.findMany({where:baseId?{OR:[{fromBaseId:baseId},{toBaseId:baseId}]}:{},include:{asset:true,fromBase:true,toBase:true},orderBy:{transferredAt:'desc'}}))}catch(e){next(e)}});
app.post('/api/transfers',permit('ADMIN','LOGISTICS_OFFICER'),async(req,res,next)=>{try{const d=transferSchema.parse(req.body);const item=await prisma.$transaction(async tx=>{const source=await tx.inventoryBalance.findUnique({where:{baseId_assetId:{baseId:d.fromBaseId,assetId:d.assetId}}});if(!source||source.quantity<d.quantity)throw new Error('INSUFFICIENT_STOCK');const t=await tx.transfer.create({data:d});await tx.inventoryBalance.update({where:{baseId_assetId:{baseId:d.fromBaseId,assetId:d.assetId}},data:{quantity:{decrement:d.quantity}}});await tx.inventoryBalance.upsert({where:{baseId_assetId:{baseId:d.toBaseId,assetId:d.assetId}},create:{baseId:d.toBaseId,assetId:d.assetId,quantity:d.quantity},update:{quantity:{increment:d.quantity}}});await tx.movement.createMany({data:[{type:'TRANSFER_OUT',baseId:d.fromBaseId,assetId:d.assetId,quantity:-d.quantity,occurredAt:d.transferredAt,referenceType:'Transfer',referenceId:t.id},{type:'TRANSFER_IN',baseId:d.toBaseId,assetId:d.assetId,quantity:d.quantity,occurredAt:d.transferredAt,referenceType:'Transfer',referenceId:t.id}]});return t});await audit(req,'TRANSFER_CREATED','Transfer',item.id,d);res.status(201).json(item)}catch(e){next(e)}});

const assignmentSchema=z.object({baseId:z.string(),assetId:z.string(),assigneeName:z.string().min(2),quantity:z.number().int().positive(),assignedAt:z.coerce.date(),notes:z.string().optional()});
app.get('/api/assignments',permit('ADMIN','BASE_COMMANDER'),async(req,res,next)=>{try{const baseId=req.actor!.role==='BASE_COMMANDER'?req.actor!.baseId:req.query.baseId as string|undefined;res.json(await prisma.assignment.findMany({where:{...(baseId&&{baseId})},include:{asset:true,base:true,expenditures:true},orderBy:{assignedAt:'desc'}}))}catch(e){next(e)}});
app.post('/api/assignments',permit('ADMIN','BASE_COMMANDER'),async(req,res,next)=>{try{const d=assignmentSchema.parse(req.body);if(!enforceBase(d.baseId,req.actor!))return res.status(403).json({error:'Base access denied'});const item=await prisma.$transaction(async tx=>{const stock=await tx.inventoryBalance.findUnique({where:{baseId_assetId:{baseId:d.baseId,assetId:d.assetId}}});if(!stock||stock.quantity<d.quantity)throw new Error('INSUFFICIENT_STOCK');const a=await tx.assignment.create({data:d});await tx.inventoryBalance.update({where:{baseId_assetId:{baseId:d.baseId,assetId:d.assetId}},data:{quantity:{decrement:d.quantity}}});await tx.movement.create({data:{type:'ASSIGNMENT',baseId:d.baseId,assetId:d.assetId,quantity:-d.quantity,occurredAt:d.assignedAt,referenceType:'Assignment',referenceId:a.id}});return a});await audit(req,'ASSIGNMENT_CREATED','Assignment',item.id,d);res.status(201).json(item)}catch(e){next(e)}});
app.get('/api/audit',permit('ADMIN'),async(_req,res,next)=>{try{res.json(await prisma.auditLog.findMany({take:200,orderBy:{createdAt:'desc'},include:{user:{select:{name:true,email:true}}}}))}catch(e){next(e)}});

app.use((err:unknown,_req:Request,res:Response,_next:NextFunction)=>{if(err instanceof z.ZodError)return res.status(400).json({error:'Validation failed',details:err.issues});if(err instanceof Error&&err.message==='INSUFFICIENT_STOCK')return res.status(409).json({error:'Insufficient stock'});console.error(err);res.status(500).json({error:'Internal server error'})});
const port=Number(process.env.PORT||4000);app.listen(port,()=>console.log(`API listening on http://localhost:${port}`));

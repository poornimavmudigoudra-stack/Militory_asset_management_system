import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const now = new Date();
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

async function main() {
  const [alpha, bravo, central] = await Promise.all([
    prisma.base.upsert({ where: { code: 'ALPHA' }, update: { name: 'Fort Alpha' }, create: { name: 'Fort Alpha', code: 'ALPHA' } }),
    prisma.base.upsert({ where: { code: 'BRAVO' }, update: { name: 'Camp Bravo' }, create: { name: 'Camp Bravo', code: 'BRAVO' } }),
    prisma.base.upsert({ where: { code: 'CENTRAL' }, update: { name: 'Depot Central' }, create: { name: 'Depot Central', code: 'CENTRAL' } }),
  ]);

  const [rifle, ammunition, vehicle, nightVision] = await Promise.all([
    prisma.asset.upsert({ where: { sku: 'WPN-M4-001' }, update: {}, create: { name: 'M4 Carbine', type: 'Weapon', sku: 'WPN-M4-001' } }),
    prisma.asset.upsert({ where: { sku: 'AMMO-556-001' }, update: {}, create: { name: '5.56mm Ammunition', type: 'Ammunition', sku: 'AMMO-556-001', unit: 'rounds' } }),
    prisma.asset.upsert({ where: { sku: 'VEH-TAC-001' }, update: {}, create: { name: 'Tactical Vehicle', type: 'Vehicle', sku: 'VEH-TAC-001' } }),
    prisma.asset.upsert({ where: { sku: 'EQP-NVG-001' }, update: {}, create: { name: 'Night Vision Device', type: 'Equipment', sku: 'EQP-NVG-001' } }),
  ]);

  const seedReference = 'DEMO-SEED-2026';
  const alreadySeeded = await prisma.movement.findFirst({ where: { referenceType: 'DemoSeed', referenceId: seedReference } });
  if (alreadySeeded) {
    console.log('Demo operational records already exist; base and asset records were refreshed.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    await Promise.all([
      tx.inventoryBalance.upsert({ where: { baseId_assetId: { baseId: alpha.id, assetId: rifle.id } }, update: { quantity: 153 }, create: { baseId: alpha.id, assetId: rifle.id, quantity: 153 } }),
      tx.inventoryBalance.upsert({ where: { baseId_assetId: { baseId: alpha.id, assetId: ammunition.id } }, update: { quantity: 7_960 }, create: { baseId: alpha.id, assetId: ammunition.id, quantity: 7_960 } }),
      tx.inventoryBalance.upsert({ where: { baseId_assetId: { baseId: bravo.id, assetId: rifle.id } }, update: { quantity: 90 }, create: { baseId: bravo.id, assetId: rifle.id, quantity: 90 } }),
      tx.inventoryBalance.upsert({ where: { baseId_assetId: { baseId: bravo.id, assetId: vehicle.id } }, update: { quantity: 28 }, create: { baseId: bravo.id, assetId: vehicle.id, quantity: 28 } }),
      tx.inventoryBalance.upsert({ where: { baseId_assetId: { baseId: central.id, assetId: nightVision.id } }, update: { quantity: 215 }, create: { baseId: central.id, assetId: nightVision.id, quantity: 215 } }),
    ]);

    const ammoPurchase = await tx.purchase.create({ data: { baseId: alpha.id, assetId: ammunition.id, quantity: 1_200, unitCost: 0.42, purchasedAt: daysAgo(6), reference: 'PO-2026-1042' } });
    const vehiclePurchase = await tx.purchase.create({ data: { baseId: bravo.id, assetId: vehicle.id, quantity: 8, unitCost: 82_500, purchasedAt: daysAgo(9), reference: 'PO-2026-1039' } });
    const transfer = await tx.transfer.create({ data: { fromBaseId: alpha.id, toBaseId: bravo.id, assetId: rifle.id, quantity: 20, transferredAt: daysAgo(4), reference: 'TR-26091' } });
    const assignment = await tx.assignment.create({ data: { baseId: alpha.id, assetId: rifle.id, assigneeName: '1st Infantry Platoon', quantity: 12, assignedAt: daysAgo(5), notes: 'Training deployment' } });
    const expenditure = await tx.expenditure.create({ data: { assignmentId: assignment.id, quantity: 4, reason: 'Field training exercise', expendedAt: daysAgo(2) } });

    await tx.movement.createMany({ data: [
      { type: 'OPENING', baseId: alpha.id, assetId: ammunition.id, quantity: 7_000, occurredAt: daysAgo(29), referenceType: 'DemoSeed', referenceId: seedReference },
      { type: 'PURCHASE', baseId: alpha.id, assetId: ammunition.id, quantity: 1_200, occurredAt: daysAgo(6), referenceType: 'Purchase', referenceId: ammoPurchase.id },
      { type: 'PURCHASE', baseId: bravo.id, assetId: vehicle.id, quantity: 8, occurredAt: daysAgo(9), referenceType: 'Purchase', referenceId: vehiclePurchase.id },
      { type: 'TRANSFER_OUT', baseId: alpha.id, assetId: rifle.id, quantity: -20, occurredAt: daysAgo(4), referenceType: 'Transfer', referenceId: transfer.id },
      { type: 'TRANSFER_IN', baseId: bravo.id, assetId: rifle.id, quantity: 20, occurredAt: daysAgo(4), referenceType: 'Transfer', referenceId: transfer.id },
      { type: 'ASSIGNMENT', baseId: alpha.id, assetId: rifle.id, quantity: -12, occurredAt: daysAgo(5), referenceType: 'Assignment', referenceId: assignment.id },
      { type: 'EXPENDITURE', baseId: alpha.id, assetId: rifle.id, quantity: -4, occurredAt: daysAgo(2), referenceType: 'Expenditure', referenceId: expenditure.id },
    ] });

    await tx.auditLog.create({ data: { action: 'DEMO_DATA_SEEDED', entityType: 'System', method: 'SEED', path: 'prisma/seed.ts', metadata: JSON.stringify({ seedReference }) } });
  });

  console.log('Demo data created successfully.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());

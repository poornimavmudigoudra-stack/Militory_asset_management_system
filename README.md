# Military Asset Management System

A full-stack framework for tracking military asset inventory, movement, assignment, expenditure, and auditing across multiple bases.

![React](https://img.shields.io/badge/React-19-20232a?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript)
![Express](https://img.shields.io/badge/Express-5-24312b?logo=express)
![Prisma](https://img.shields.io/badge/Prisma-6-2d3748?logo=prisma)

## Features

- Dashboard with opening balance, closing balance, net movement, assigned assets, and expenditures
- Filters for date, base, and equipment type
- Purchase recording and historical transaction views
- Base-to-base transfers with clear movement history
- Personnel assignments and expenditure tracking
- Role-based permissions for administrators, base commanders, and logistics officers
- Immutable movement ledger and independent API audit log
- Responsive interface with a military logistics visual theme

## Run locally

```powershell
Copy-Item backend/.env.example backend/.env
npm.cmd install
npm.cmd run db:push
npm.cmd run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Project layout and separate deployment

- `frontend/` is an independent React/Vite static application.
- `backend/` is an independent Express/Prisma API application.
- `backend/prisma/` owns the schema and local SQLite database.

Each application has its own `package.json` and `.env.example`, so it can be
installed and deployed independently. Set the frontend's `VITE_API_URL` to the
public backend URL, and set the backend's `CORS_ORIGIN` to the public frontend
URL. The root scripts remain available for running both applications locally.

> In development, the API uses an administrator identity when no bearer token is supplied. Production requires a signed JWT and a secure `JWT_SECRET`.

## Architecture

- **React + TypeScript + Vite** provides a fast, typed, and responsive client.
- **Express + Zod** provides REST endpoints, request validation, centralized errors, JWT authentication, and role middleware.
- **Prisma + SQLite** provides a zero-setup relational development database. PostgreSQL is recommended for production concurrency, backups, and operational scale.

The immutable `Movement` ledger is the reporting source for opening balance, closing balance, and net movement. `InventoryBalance` is a transactional projection for fast stock validation. Transfers create matching OUT and IN entries in one database transaction. `AuditLog` records who performed each operation, when it occurred, and which entity was affected.

## Role-based access

| Role | Scope |
| --- | --- |
| Admin | All bases, operations, users, and audit data |
| Base Commander | Dashboard, assignments, and records for the assigned base |
| Logistics Officer | Purchases and transfers; no assignment or audit access |

Base scoping is enforced by the API and is never trusted solely to the interface.

## API overview

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/dashboard?baseId=&from=&to=` | Inventory metrics |
| `GET`, `POST` | `/api/purchases` | Purchase history and creation |
| `GET`, `POST` | `/api/transfers` | Transfer history and creation |
| `GET`, `POST` | `/api/assignments` | Assignment history and creation |
| `GET` | `/api/audit` | Administrator audit history |

Inventory-changing writes use database transactions. A production deployment should also include HTTPS, an external identity provider, rate limiting, backups, and append-only audit export.

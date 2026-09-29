# Backend

This folder contains the Express API for the Military Asset Management System.

## Development

From the project root, run:

```powershell
npm.cmd run db:push
npm.cmd run dev
```

The API runs at `http://localhost:4000` and the Vite frontend runs at
`http://localhost:5173`.

## Authentication endpoints

- `POST /api/auth/signup` creates a logistics officer account.
- `POST /api/auth/login` validates credentials and returns an eight-hour JWT.
- `GET /api/auth/me` returns the authenticated user's profile.

Send authenticated requests with this header:

```text
Authorization: Bearer <token>
```

User records, password hashes, roles, and audit events are persisted through
Prisma in the SQLite database configured by `DATABASE_URL`. The Prisma schema
remains in `prisma/schema.prisma` so standard Prisma commands work normally.

## Environment variables

- `DATABASE_URL`: Prisma database connection string.
- `JWT_SECRET`: secret used to sign access tokens; use a long random value.
- `PORT`: API port, defaulting to `4000`.

Use `.env.example` as the safe template. Never commit the real `.env` file.

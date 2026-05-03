# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BDE Intra is an internal management platform for a student association (BDE). It is a full-stack TypeScript monorepo with:
- **Backend**: Express.js + Prisma ORM + PostgreSQL (`/backend`)
- **Frontend**: Next.js 14 (App Router) + React Query (`/frontend`)
- **Infrastructure**: Docker Compose orchestrates db, backend, and frontend

## Development Commands

### Full stack (recommended)
```bash
# Copy env first
cp env.example .env
# Start all services
docker compose up --build
```
Backend: `http://localhost:4000` — Frontend: `http://localhost:3000`

### Backend only (local dev)
```bash
cd backend
npm install
npm run dev          # ts-node-dev with hot reload
npm run build        # tsc compile to dist/
npm run db:migrate   # prisma migrate dev (creates/runs migrations)
npm run db:generate  # regenerate Prisma client after schema changes
npm run db:studio    # open Prisma Studio GUI
```

### Frontend only (local dev)
```bash
cd frontend
npm install
npm run dev    # Next.js dev server on port 3000
npm run build  # production build
npm run lint   # ESLint via next lint
```

## Architecture

### Backend — layered MVC

```
src/
  index.ts              # Express app setup, route mounting, CORS, static uploads
  controllers/          # Request handlers, one file per domain
  routes/               # Express Router definitions, wire middleware + controller
  services/             # Domain logic extracted from controllers (auth, avoirs, lock)
  middleware/
    auth.ts             # JWT Bearer authentication + role-based access (requireRole)
    errorHandler.ts     # Centralised error shape
  utils/
    prisma.ts           # Singleton PrismaClient
    jwt.ts              # Sign/verify access & refresh tokens
    mailer.ts           # Nodemailer helper
    upload.ts           # Multer config for file uploads
```

All API routes are prefixed `/api/v1/`. Uploaded files are served statically from `/uploads`.

### Frontend — Next.js App Router

```
src/
  app/
    (auth)/login/       # Public login page
    (intra)/            # Protected pages behind auth guard
      buvette, events, membres, avoirs, stock, tresorerie, ...
  context/
    AuthContext.tsx     # Auth state (user, login, logout) via React context
  lib/
    api.ts              # Typed fetch wrapper with auto token refresh
  components/
    Sidebar.tsx         # Navigation sidebar
```

### Authentication Flow

- **Access token**: short-lived JWT (15 min), stored in `localStorage`.
- **Refresh token**: 7-day JWT, stored in an `httpOnly` cookie.
- `api.ts` automatically retries a failed 401 request after calling `/auth/refresh`. On refresh failure it clears storage and redirects to `/login`.
- Backend middleware: `authenticate` → sets `req.user`; `requireRole(...roles)` enforces the hierarchy `MEMBRE < POLE_LEAD < ADMIN`.

### Data Conventions

- **Monetary amounts** are always stored in **cents** (integer) — e.g. `amountCents`, `priceCents`, `totalCents`.
- **Soft deletes** use a `deletedAt DateTime?` column on most models.
- **Roles**: `ADMIN`, `POLE_LEAD`, `MEMBRE`
- **Poles**: `BUREAU`, `COMMUNICATION`, `EVENEMENT`, `PARTENARIAT`, `TRESORERIE`, `LOGISTIQUE`

### Environment Variables

See `env.example` for all required variables. Key ones:
| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | Token signing keys |
| `LOCK_CODE_ENCRYPTION_KEY` | Must be exactly 32 chars |
| `FRONTEND_URL` | Used for CORS allowlist |
| `UPLOAD_DIR` | Where multer stores files (default `/app/uploads`) |

After editing `prisma/schema.prisma`, always run `npm run db:generate` inside `backend/` to regenerate the Prisma client, and `npm run db:migrate` to create a migration.

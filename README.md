# Wave BDE Platform

Internal platform for **Wave**, the BDE (student association) of Epitech Lyon: a point-based system for the student bar (buvette), plus a global tracking layer for treasury and member activity. One backend and one PostgreSQL database serve four frontends (public showcase, buvette, pole sites, bureau back-office).

Full context, architecture, roles, and build order live in [CLAUDE.md](CLAUDE.md).

## Requirements

- Node.js >=22.13
- pnpm — run via corepack (`corepack enable`), which picks up the pinned version from `package.json`
- Docker + Docker Compose (for Postgres and the backend container)

## Install

```bash
pnpm install
```

## Run locally

1. Copy the env file and adjust if needed (defaults work out of the box):

   ```bash
   cp .env.example .env
   ```

2. Start Postgres and the backend (containerized):

   ```bash
   docker compose up
   ```

   This brings up:
   - `postgres` — PostgreSQL 16, dev-only default credentials, persisted in a named volume.
   - `backend` — `apps/backend`, built from its `Dockerfile`, waits for Postgres to be healthy. Exposes `GET /health` on `http://localhost:3000/health`.

   Frontend apps are **not** containerized yet — run them locally instead.

3. In separate terminals, run whichever frontend(s) you're working on:

   ```bash
   pnpm --filter @wave/showcase dev             # http://localhost:5173
   pnpm --filter @wave/buvette dev              # http://localhost:5174
   pnpm --filter @wave/bureau dev               # http://localhost:5175
   pnpm --filter @wave/pole-comm dev            # http://localhost:5176
   pnpm --filter @wave/pole-events dev          # http://localhost:5177
   pnpm --filter @wave/pole-partenariats dev    # http://localhost:5178
   ```

   Or run every app in the workspace at once (frontends + backend outside Docker):

   ```bash
   pnpm dev
   ```

## Status

**Phase 0 (setup) is complete**: monorepo scaffolded, local Docker/Postgres/backend infra in place, CI (lint + build) running on push/PR. The backend currently exposes only a `GET /health` route — no auth, RBAC, audit logging, or Prisma schema yet. See the Build Order section in [CLAUDE.md](CLAUDE.md) for what's next.

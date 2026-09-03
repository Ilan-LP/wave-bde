# Wave BDE Platform

Internal platform for **Wave**, the BDE (student association) of Epitech Lyon: a point-based system for the student bar (buvette), plus a global tracking layer for treasury and member activity. One backend and one PostgreSQL database serve four frontends (public showcase, buvette, pole sites, bureau back-office).

Full context, architecture, roles, and build order live in [CLAUDE.md](CLAUDE.md).

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
   pnpm --filter @wave/showcase dev
   pnpm --filter @wave/buvette dev
   pnpm --filter @wave/bureau dev
   pnpm --filter @wave/pole-comm dev
   pnpm --filter @wave/pole-events dev
   pnpm --filter @wave/pole-partenariats dev
   ```

   Or run every app in the workspace at once (frontends + backend outside Docker):

   ```bash
   pnpm dev
   ```

## Status

This repo is being built in a fixed order — see the Build Order section in [CLAUDE.md](CLAUDE.md). At this stage: monorepo scaffolded, local Docker/Postgres/backend infra in place. No auth, RBAC, audit logging, or Prisma schema yet.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Phase 0 (scaffold) is complete. The monorepo is set up as pnpm workspaces with the backend and all 4 frontends scaffolded under `apps/`, shared packages under `packages/`, local Docker/Postgres infra, a root README, and a CI pipeline (lint + build on push/PR).

The backend exposes `GET /health` plus `POST /auth/login`, `/auth/refresh`, `/auth/logout` (see **Authentication** below), the Prisma schema/migrations (see **Data model** below), RBAC middleware (`authenticate`, `requireRole`, `requirePoleAccess` — see **RBAC Middleware** below), and a generic audit logging middleware (`auditLog` — see **Audit Logging** below). Business logic beyond auth + RBAC + audit logging is still Build Order step 1, not started. Frontends are scaffolded shells (Vite/React/TS/Tailwind) with no real UI or routes yet.

Two security fixes have been applied since scaffolding: the backend Docker container runs as a non-root user (`USER node`), and CI is scoped to `permissions: contents: read`. Still verify current file/dependency state before assuming anything beyond this.

## Project overview

Wave BDE Platform is a solo-built internal platform for **Wave**, the BDE (student association) of Epitech Lyon. It replaces a fully manual, no-system current state. Two core drivers:

- A **point-based system** for the student bar (buvette) to push consumption and speed up service.
- A **global tracking layer** for treasury and member activity (todos).

## Architecture

- Single backend, single PostgreSQL database, serving **4 separate frontends**.
- Monorepo via pnpm workspaces with:
  - `apps/` — one app per frontend, plus the backend
  - `packages/` — shared code: API types, RBAC definitions, shared UI, auth client
- Deployed on a personal VPS via Docker Compose.

## Stack

- **Backend**: Express + Prisma + PostgreSQL
- **Frontends**: React + Vite + TypeScript + Tailwind
- **Auth**: JWT with refresh tokens, tied to the school email
- **Runtime**: Node.js >=22.13 (required by the pinned `pnpm@11.18.0` package manager via corepack; enforced in `engines`, CI, and the backend Dockerfile)

## The 4 frontends

1. **Public showcase site** — public-facing, no auth.
2. **Buvette (bar/checkout) site** — product buttons with point prices, a custom price field, a QR scanner button (points payment), a cash button (shows a change-counting helper), and a card button (triggers a SumUp card reader via the SumUp Cloud API). One purchase = one payment method only.
3. **Pole sites** (Communication, Events, Partenariats) — share a common template (todos, personal task space); each pole additionally gets custom, non-reusable modules for its specific needs (to be defined per pole later).
4. **Bureau (board) site** — full management back-office, including a private todo list not visible to anyone else.

## Points system

- Users buy points (top-up = money in); points are linked to the school email and identified via a per-user QR code.
- Spending at the buvette deducts points.
- Points can also be earned (e.g. via event participation; other methods TBD).
- This is a **distinct system** from the existing loyalty card program — do not conflate the two.

## Roles (RBAC) — 3 tiers

- **`BUREAU`** — full access to everything; the only tier that can correct point disputes/errors.
- **`RESPONSABLE_POLE`** — extended access on their own pole; can delegate cross-pole access to a member.
- **`MEMBRE_POLE`** — basic access on their own pole; targeted read access to shared data.

Pole todos can be assigned cross-pole (any BDE member can help another pole) but assignment is favored toward the pole's own members.

## Audit logging

Every mutating action must be logged from day one — transactions, point movements, role changes, deletions, everything. This is a **hard requirement**, not optional. Logs are exported daily via an automated job to Google Drive as a passive backup (no formal restore process required for now).

## Data model (Prisma schema)

Schema lives at `apps/backend/prisma/schema.prisma`, migrated via `prisma migrate dev` (first migration: `20260903205827_init`). All primary keys are `String @id @default(cuid())`, not autoincrement ints — several IDs (User, PointsAccount) end up embedded in QR codes, and sequential ints would make accounts guessable/enumerable.

**Models:**
- **`User`** — base identity for *anyone* in the system: BDE staff and plain students who just top up points at the buvette. Fields: email (unique), firstName, lastName, isActive, `passwordHash` (nullable — only set for `User`s that also have a `Member`; plain students never log in anywhere and never get one), timestamps. Optional 1:1 `Member`, optional 1:1 `PointsAccount`, 1:N `AuditLog` (as actor), 1:N `RefreshToken`.
- **`Member`** — extends `User` (1:1 via `userId`, `onDelete: Cascade`) for people who are actually part of the BDE. This is where RBAC lives: `role` (`MemberRole` enum), optional `poleId`. Also the anchor for Todo assignment/creation, PoleAccessGrant give/receive, and manual Transaction adjustments.
- **`Pole`** — `COMMUNICATION` / `EVENTS` / `PARTENARIATS` (enum `PoleType`, unique). Has Members, Todos, PoleAccessGrants.
- **`PoleAccessGrant`** — a `RESPONSABLE_POLE` delegating cross-pole access to a `Member`. Unique on `[memberId, poleId]`; both grantee (`memberId`, cascade) and pole (cascade) delete the grant, but the granting member (`grantedById`) does not (restrict).
- **`Todo`** — `status` (`TodoStatus`: TODO/IN_PROGRESS/DONE/BLOCKED), `scope` (`TodoScope`: PERSONAL/POLE/BUREAU). `poleId` is nullable at the DB level even though it's conceptually required when `scope = POLE` — **that constraint is enforced in application code, not the DB.** `assigneeId` is `SetNull` on delete (todo survives, becomes unassigned); `creatorId` is required and restricted (can't delete a Member who has created Todos without reassigning first).
- **`PointsAccount`** — 1:1 with `User` (cascade), `balance` (Int, default 0). 1:N `Transaction`.
- **`Transaction`** — signed `amount` (Int; positive = credit, negative = debit), `type` (`TransactionType`: TOPUP/PURCHASE/EVENT_REWARD/ADJUSTMENT/REFUND), `metadata` (Json, nullable — SumUp refs, QR scan data, event id, etc.), optional `performedById` (only set for manual staff adjustments). Indexed on `[pointsAccountId, createdAt]` for account history queries.
- **`AuditLog`** — `actorId` is nullable + `SetNull` on delete **on purpose**: the log must outlive the user it references. Indexed on `[entityType, entityId]` and `[createdAt]`.
- **`RefreshToken`** — one row per issued refresh token; see **Authentication** below.

Every FK column is now covered by an index (either a dedicated `@@index` or, where it's already the leading column of a `@@unique`/composite index, that): `Member.poleId`, `PoleAccessGrant.poleId`/`grantedById`, `Todo.poleId`/`assigneeId`/`creatorId`, `Transaction.performedById`, `AuditLog.actorId`, `RefreshToken.userId` (migration `20260903211613_add_fk_indexes`).

**Why `User`/`Member` are split:** every human who touches the system becomes a `User` (a student buying a coffee needs an identity + points account, nothing else). Only actual BDE staff get a `Member` row layered on top, carrying the RBAC role and pole assignment. This keeps the 3-tier RBAC (see below) from leaking onto the thousands of students who are just customers.

**Why `Role` is a Prisma enum, not a table:** the 3-tier RBAC (`BUREAU` / `RESPONSABLE_POLE` / `MEMBRE_POLE`) is fixed and not meant to be DB-editable — no admin UI for creating custom roles is planned. An enum is simpler and gets compile-time exhaustiveness checks; revisit only if the RBAC model itself changes.

**Gotchas:**
- `isActive` flags on `User`/`Member` are there for planned soft-delete — the app layer should prefer flipping `isActive` over hard-deleting rows. The cascade/`SetNull` rules above are already set up with that in mind (e.g. `AuditLog.actorId` survives user removal); don't add hard-delete flows that fight this.
- Running Prisma commands locally requires `apps/backend/.env` (gitignored, not committed) with `DATABASE_URL` pointing at the docker-compose Postgres (`postgresql://wave:wave_dev_password@localhost:5432/wave_dev` by default) — copy from `apps/backend/.env.example`.
- The Prisma CLI loads `.env` itself, but the running app never did — it only ever read `PORT`, so this was invisible. Now that the app validates `JWT_SECRET`/`JWT_REFRESH_SECRET` at startup (see **Authentication**), `pnpm dev` loads `apps/backend/.env` via Node's native `--env-file=.env` flag (in the `dev` script) — no `dotenv` dependency added. Docker/production get real env vars injected directly by `docker-compose.yml`, so they don't need this.
- `pnpm-workspace.yaml` has an `allowBuilds` allowlist (pnpm's supply-chain gate for postinstall scripts) — `@prisma/client`, `@prisma/engines`, and `prisma` are set to `true` there so `pnpm install` can fetch Prisma's query engine binaries. Any future package with a build script will need the same treatment or its build gets silently skipped.

## Authentication

Implemented in `apps/backend/src/routes/auth.ts`, `src/lib/jwt.ts`, `src/lib/password.ts`, `src/lib/prisma.ts`, `src/config/env.ts`.

- **Who can log in**: a `User` whose `passwordHash` is set (bcryptjs, 12 salt rounds) **and** who has an active `Member` (role/pole come from `Member`, not `User`). Plain students (no `Member`) can never log in — they only ever get scanned via QR at the buvette. `isActive` is checked on both `User` and `Member`; any failure returns a generic `401 { error: "invalid credentials" }` to avoid leaking which emails exist.
- **Access token**: JWT, HS256, signed with `JWT_SECRET`, 15 min expiry. Payload: `{ sub: userId, memberId, role, poleId }` — enough for a future RBAC middleware to authorize without a DB hit.
- **Refresh token**: *also* a JWT, signed with a separate secret (`JWT_REFRESH_SECRET`), 30 day expiry, payload `{ sub: userId, jti }`. The JWT itself is never trusted alone — only its SHA-256 hash, looked up against `RefreshToken.tokenHash`, determines whether it's still valid (unrevoked, unexpired, unrotated). Both tokens are returned in the JSON response body (not cookies — avoids pulling in `cors`/cookie middleware, which is out of scope; storing the refresh token in an httpOnly cookie is a documented future hardening step once the frontends need cross-origin cookie handling).
- **Rotation**: every `POST /auth/refresh` call issues a brand-new access+refresh pair and revokes the presented refresh token (`revokedAt` + `replacedByTokenId` linking the chain), done inside a Prisma interactive transaction.
- **Reuse/theft detection**: presenting a refresh token that's already `revokedAt` (i.e. already rotated away, or logged out) revokes **every** active refresh token for that user, not just the one presented — treats reuse as a stolen-token signal.
- **Logout** (`POST /auth/logout`): revokes just the presented refresh token. Idempotent — a missing/garbage/already-revoked token still returns `204`.
- **Required env vars** (fail-fast, `src/config/env.ts`, imported first thing in `src/index.ts`): `JWT_SECRET`, `JWT_REFRESH_SECRET`. Missing or empty → the server throws and refuses to start, before any request is served. Generate real values with `openssl rand -hex 32`; never reuse the same value for both.
- **Known gap**: there is no endpoint or seed script to *create* a `Member`'s initial password — `passwordHash` currently has to be set directly in the DB (e.g. via Prisma Studio or a one-off script) for local testing. An invite/registration/password-reset flow is a separate future task.
- **Implemented**: RBAC/authorization middleware lives in `src/middleware/` — see **RBAC Middleware** section below.

## RBAC Middleware

Implemented in `apps/backend/src/middleware/authenticate.ts`, `src/middleware/rbac.ts`, `src/middleware/index.ts`. Types in `src/types/express.d.ts`. Tests in `src/__tests__/middleware/rbac.test.ts` (Vitest + Supertest — no running database required; Prisma is mocked).

**Two-layer design:**

1. `authenticate` — verifies the Bearer token and attaches `req.auth: AccessTokenPayload`. Always required first on any protected route. Stateless, no DB hit.
2. Composable factory middlewares, applied per route after `authenticate`:
   - `requireRole(...roles: MemberRole[])` — passes if the caller's role is in the list. **BUREAU always bypasses this check** (hardcoded). Returns 403 otherwise.
   - `requirePoleAccess()` — passes if the caller has access to the pole in `req.params.poleId`. Check order: BUREAU bypass (no DB) → native `poleId` match (no DB) → `PoleAccessGrant` DB lookup. Returns 403 if none match.

**How to protect a route:**

```ts
import { authenticate, requireRole, requirePoleAccess } from "../middleware/index.js";

// BUREAU-only:
router.post("/adjustments", authenticate, requireRole("BUREAU"), handler);

// Any logged-in member:
router.get("/todos", authenticate, requireRole("RESPONSABLE_POLE", "MEMBRE_POLE"), handler);

// Pole-scoped (native membership + delegated grants):
router.get("/poles/:poleId/todos", authenticate, requirePoleAccess(), handler);

// Stack both (role check first, then pole access):
router.post("/poles/:poleId/todos", authenticate, requireRole("RESPONSABLE_POLE", "MEMBRE_POLE"), requirePoleAccess(), handler);
```

**Cross-pole delegation:** `requirePoleAccess()` does a single `prisma.poleAccessGrant.findUnique({ where: { memberId_poleId: { memberId, poleId } } })`. The grant can be time-bounded via `expiresAt` — expired grants are rejected silently. The DB hit is skipped for BUREAU and for users on their own pole.

**Running tests:** `pnpm --filter @wave/backend test` or `cd apps/backend && pnpm test`. No database needed.

**Gotchas:**
- Always chain `authenticate` before any RBAC middleware — both factories return 401 defensively if `req.auth` is missing, but `authenticate` must always run first in production.
- `requirePoleAccess()` reads `req.params.poleId` — routes using it must include `:poleId` in the path, otherwise it returns 400.
- BUREAU bypass is hardcoded in both factories. Do not try to restrict BUREAU via these middlewares — the spec defines BUREAU as full-access.

## Audit Logging

Implemented in `apps/backend/src/middleware/audit.ts` (exported as `auditLog` from `src/middleware/index.ts`), wired globally in `src/index.ts` via `app.use(auditLog)` right after `app.use(express.json())`, before any router. Tests in `src/__tests__/middleware/audit.test.ts` (Vitest + Supertest, `prisma.auditLog.create` mocked — no running database required).

**How it works:** every `POST`/`PUT`/`PATCH`/`DELETE` request is logged automatically, with no per-route call needed — the middleware hooks `res.on("finish")` early in the chain, then reads `req.auth` (set later by that route's `authenticate`, if any) once the response has actually finished. It writes one `AuditLog` row via:
- `actorId`: `req.auth?.sub ?? null` (matches `User.id`).
- `action`: `CREATE` (POST) / `UPDATE` (PUT, PATCH) / `DELETE` (DELETE).
- `entityType`: inferred from the first path segment (kebab-case → PascalCase, naive trailing-`s` stripped, e.g. `/points-accounts` → `PointsAccount`).
- `entityId`: `req.params.id` if present, else the response body's `id` field, else the literal string `"unknown"` (with a `console.warn`) — a row is always written, never silently dropped for lack of an id.
- `metadata`: `{ method, path, role, requestBody, responseBody }` — both bodies redacted (keys `password`, `passwordHash`, `token`, `accessToken`, `refreshToken`, `tokenHash` become `"[REDACTED]"`). There's no dedicated `role` column on `AuditLog`, so role rides in `metadata` instead — a deliberate choice, not a schema gap.

**Only successful mutations are logged** (`res.statusCode < 400`) — a rejected request didn't actually change anything, so it isn't recorded as an audit entry.

**Excluded automatically:** `/auth/*` and `/health`. Auth routes mutate `RefreshToken` rows but that's already self-documented there (`revokedAt`/`replacedByTokenId`); the audit log stays scoped to business-entity mutations.

**To exclude or override a route without touching the middleware:**
- `res.locals.skipAudit = true` — skips audit logging entirely for that route.
- `res.locals.auditEntityType` / `res.locals.auditEntityId` — override automatic inference (needed for non-flat routes, e.g. a future nested resource like `POST /points-accounts/:id/transactions`, where the mutated entity isn't the first path segment).

**Error handling:** the audit write is fired from inside the `finish` handler, after the response has already been sent, and is never awaited by the request — a DB/logging failure cannot block or fail the business response. On failure it's `console.error`'d (never silently swallowed) so a missed log is visible in server logs even though the client never sees it.

**Known limitation:** there's no generic DB "before" snapshot. `metadata.requestBody` is the client's change payload, not a true prior-row read — building one generically would require mapping each inferred `entityType` back to a Prisma delegate, which is unverified against any real route since none exist yet. If a future route needs a real before/after diff, have that handler set `res.locals.auditBefore` before responding and extend the middleware to include it (not currently implemented).

**Coverage right now:** zero live routes actually produce an audit row today — the only mutating routes that exist (`/auth/login`, `/auth/refresh`, `/auth/logout`) are excluded by design above. The middleware applies automatically the moment any future business mutating route is added; no wiring needed per route.

## Build order (hard priority — do not reorder without explicit instruction)

1. Backend operational and secured (auth, RBAC, audit logging, DB schema)
2. Buvette, functional end to end including SumUp integration — no treasury dashboard needed yet, raw logs are sufficient at this stage
3. Treasury dashboard and bureau back-office (built on the logs already being collected)
4. Pole sites and their custom modules — last

## Commit conventions

All commits must follow **Conventional Commits** (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`, `ci:`, etc.), with an optional scope matching the affected app or package. Keep descriptions short and imperative.

Examples:
- `feat(buvette): add QR scan endpoint`
- `fix(backend): correct RBAC middleware check`

## Working conventions for Claude Code sessions on this repo

- Always read this CLAUDE.md fully before starting any task.
- Tasks are handled in small, isolated chunks — one Claude Code session per task, easy to review.
- Always propose a plan and wait for confirmation before writing code.
- Never expand scope beyond the requested task.
- Follow the Conventional Commits rule above on every commit.
- Summarize exactly what was done at the end of every session — the project owner needs to know precisely what the AI changed (school policy requirement).

## Open questions

These are ambiguous in the current spec and were not guessed silently — resolve with the project owner when relevant:

- **Point-earning methods** beyond event participation: TBD.
- **Pole-specific custom modules**: not yet defined per pole (Communication, Events, Partenariats) — to be specified before Build Order step 4.
- **SumUp Cloud API integration details** (auth flow, device pairing, webhook handling): not yet specified.
- **Log export mechanics** to Google Drive (format, frequency beyond "daily", auth credentials): not yet specified.
- **Initial password / Member creation flow**: no endpoint or seed script sets a `Member`'s first password yet — see **Authentication** gotcha above.

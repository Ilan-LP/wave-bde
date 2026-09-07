# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Phase 0 (scaffold) is complete. The monorepo is set up as pnpm workspaces with the backend and all 4 frontends scaffolded under `apps/`, shared packages under `packages/`, local Docker/Postgres infra, a root README, and a CI pipeline (`prisma generate` → lint → build → test on push/PR).

The backend exposes `GET /health` plus `POST /auth/login`, `/auth/refresh`, `/auth/logout` (see **Authentication** below), the Prisma schema/migrations (see **Data model** below), RBAC middleware (`authenticate`, `requireRole`, `requirePoleAccess` — see **RBAC Middleware** below), and a generic audit logging middleware (`auditLog` — see **Audit Logging** below). Business logic beyond auth + RBAC + audit logging is still Build Order step 1, not started. Frontends are scaffolded shells (Vite/React/TS/Tailwind) with no real UI or routes yet.

Two security fixes have been applied since scaffolding: the backend Docker container runs as a non-root user (`USER node`), and CI is scoped to `permissions: contents: read`. A further hardening pass (2026-09-04, see **Security hardening** below) closed out the findings from `AUDIT-auth-rbac-audit-log.md`'s 2026-09-03 revision. A second follow-up pass (2026-09-07) fixed 12 more findings from that same file's 2026-09-07 revision — see **Known issues / follow-ups**. Still verify current file/dependency state before assuming anything beyond this.

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

Every FK column is now covered by an index (either a dedicated `@@index` or, where it's already the leading column of a `@@unique`/composite index, that): `Member.poleId`, `PoleAccessGrant.poleId`/`grantedById`, `Todo.poleId`/`assigneeId`/`creatorId`, `Transaction.performedById`, `AuditLog.actorId` (migration `20260903211613_add_fk_indexes`), and `RefreshToken.userId` (migration `20260903211625_add_password_hash_and_refresh_token`, added alongside the `RefreshToken` table itself).

**Why `User`/`Member` are split:** every human who touches the system becomes a `User` (a student buying a coffee needs an identity + points account, nothing else). Only actual BDE staff get a `Member` row layered on top, carrying the RBAC role and pole assignment. This keeps the 3-tier RBAC (see below) from leaking onto the thousands of students who are just customers.

**Why `Role` is a Prisma enum, not a table:** the 3-tier RBAC (`BUREAU` / `RESPONSABLE_POLE` / `MEMBRE_POLE`) is fixed and not meant to be DB-editable — no admin UI for creating custom roles is planned. An enum is simpler and gets compile-time exhaustiveness checks; revisit only if the RBAC model itself changes.

**Gotchas:**
- `isActive` flags on `User`/`Member` are there for planned soft-delete — the app layer should prefer flipping `isActive` over hard-deleting rows. The cascade/`SetNull` rules above are already set up with that in mind (e.g. `AuditLog.actorId` survives user removal); don't add hard-delete flows that fight this.
- Running Prisma commands locally requires `apps/backend/.env` (gitignored, not committed) with `DATABASE_URL` pointing at the docker-compose Postgres (`postgresql://wave:wave_dev_password@localhost:5432/wave_dev` by default) — copy from `apps/backend/.env.example`.
- The Prisma CLI loads `.env` itself, but the running app never did — it only ever read `PORT`, so this was invisible. Now that the app validates `JWT_SECRET`/`JWT_REFRESH_SECRET` at startup (see **Authentication**), `pnpm dev` loads `apps/backend/.env` via Node's native `--env-file=.env` flag (in the `dev` script) — no `dotenv` dependency added. Docker/production get real env vars injected directly by `docker-compose.yml`, so they don't need this.
- `pnpm-workspace.yaml` has an `allowBuilds` allowlist (pnpm's supply-chain gate for postinstall scripts) — `@prisma/client`, `@prisma/engines`, and `prisma` are set to `true` there so `pnpm install` can fetch Prisma's query engine binaries. Any future package with a build script will need the same treatment or its build gets silently skipped.

## Authentication

Implemented in `apps/backend/src/routes/auth.ts`, `src/lib/jwt.ts`, `src/lib/password.ts`, `src/lib/prisma.ts`, `src/config/env.ts`.

- **Who can log in**: a `User` whose `passwordHash` is set (bcryptjs, 12 salt rounds) **and** who has an active `Member` (role/pole come from `Member`, not `User`). Plain students (no `Member`) can never log in — they only ever get scanned via QR at the buvette. `isActive` is checked on both `User` and `Member`; any failure returns a generic `401 { error: "invalid credentials" }` to avoid leaking which emails exist. This is timing-safe too: when the user/member lookup fails before a real password hash exists, `verifyDummyPassword` (`src/lib/password.ts`) still runs one bcrypt comparison against a fixed dummy hash, so a nonexistent/inactive account and a valid-email/wrong-password attempt take the same time — otherwise the early return was a measurable side-channel for enumerating registered emails.
- **Email lookup is case-normalized**: `/auth/login` lowercases and trims the submitted email (`rawEmail.trim().toLowerCase()`) before the Prisma lookup, since `User.email`'s unique index is case-sensitive at the DB level. This only fixes the read side — nothing yet normalizes email casing at write time, since there's no user-creation endpoint (see the "Known gap" below); any future creation/seed flow must lowercase on insert too, or the two sides can still drift.
- **Access token**: JWT, HS256 (algorithm pinned explicitly on both sign and verify — `{ algorithms: ["HS256"] }` — as defense-in-depth, not because anything asymmetric exists in this app today), signed with `JWT_SECRET`, 15 min expiry. Payload: `{ sub: userId, memberId, role, poleId }` — enough for a future RBAC middleware to authorize without a DB hit. **Accepted tradeoff**: because `authenticate`/`requireRole`/`requirePoleAccess`'s BUREAU-bypass and native-pole paths never hit the DB, a role change, pole reassignment, or deactivation doesn't take effect for an already-issued access token until it expires — up to 15 minutes. This is an intentional stateless-JWT tradeoff for this project's size, not an oversight; revisit (e.g. a `tokenVersion` column checked in `authenticate`) only if that window becomes unacceptable.
- **Refresh token**: *also* a JWT (same HS256 pinning), signed with a separate secret (`JWT_REFRESH_SECRET`), 30 day expiry, payload `{ sub: userId, jti }`. The JWT itself is never trusted alone — only its SHA-256 hash, looked up against `RefreshToken.tokenHash`, determines whether it's still valid (unrevoked, unexpired, unrotated — `/auth/refresh` checks `RefreshToken.expiresAt` explicitly as a DB-side backstop, independent of the JWT's own `exp`). Both tokens are returned in the JSON response body (not cookies — avoids pulling in `cors`/cookie middleware, which is out of scope; storing the refresh token in an httpOnly cookie is a documented future hardening step once the frontends need cross-origin cookie handling).
- **Rotation**: every `POST /auth/refresh` call issues a brand-new access+refresh pair and revokes the presented refresh token (`revokedAt` + `replacedByTokenId` linking the chain), done inside a Prisma interactive transaction. The revoke is a conditional `updateMany({ where: { id, revokedAt: null } })` checked for `count === 0` *inside* that same transaction (not a separate read-then-write) — this closes a race where two concurrent refreshes of the same token could otherwise both succeed before either observed the other's revoke, silently doubling a session without tripping reuse-detection.
- **Reuse/theft detection**: presenting a refresh token that's already `revokedAt` (i.e. already rotated away, logged out, or lost the rotation race above) revokes **every** active refresh token for that user, not just the one presented — treats reuse as a stolen-token signal.
- **Logout** (`POST /auth/logout`): revokes just the presented refresh token. Idempotent — a missing/garbage/already-revoked token still returns `204`.
- **Rate limiting**: `POST /auth/login` is limited to 10 attempts per 15 minutes per IP; `POST /auth/refresh` and `POST /auth/logout` share a looser 30-attempts-per-15-minutes limiter (`express-rate-limit`, in-memory store — fine for a single-instance VPS deployment; revisit if the backend is ever horizontally scaled, since the counter wouldn't be shared across instances). Both limiters are constructed fresh inside `createApp()` (see **Security hardening**), not at module scope, so each app instance gets its own in-memory state.
- **Required env vars** (fail-fast, `src/config/env.ts`, imported first thing in both `src/app.ts` and `src/index.ts`): `JWT_SECRET`, `JWT_REFRESH_SECRET`. Missing or empty → the server throws and refuses to start, before any request is served. Generate real values with `openssl rand -hex 32`. **Enforced, not just documented**: `env.ts` also throws if the two secrets are equal — "never reuse the same value for both" used to be convention only.
- **Known gap**: there is no endpoint or seed script to *create* a `Member`'s initial password — `passwordHash` currently has to be set directly in the DB (e.g. via Prisma Studio or a one-off script) for local testing. An invite/registration/password-reset flow is a separate future task.
- **Implemented**: RBAC/authorization middleware lives in `src/middleware/` — see **RBAC Middleware** section below.
- **Tests**: `src/__tests__/routes/auth.test.ts` (Vitest + Supertest, Prisma and `src/lib/password.ts` mocked) covers the timing-normalization call, the DB-side expiry check, the rotation-race rollback, reuse/theft detection, logout idempotency, and email case/whitespace normalization. `src/__tests__/config/env.test.ts` covers `env.ts`'s fail-fast behavior (missing/empty secrets, identical secrets) via `vi.resetModules()` + dynamic re-import per case.

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

Implemented in `apps/backend/src/middleware/audit.ts` (exported as `auditLog` from `src/middleware/index.ts`), wired globally in `src/app.ts` via `app.use(auditLog)` right after `app.use(express.json(...))`, before any router. Tests in `src/__tests__/middleware/audit.test.ts` (Vitest + Supertest, `prisma.auditLog.create` mocked — no running database required).

**How it works:** every `POST`/`PUT`/`PATCH`/`DELETE` request is logged automatically, with no per-route call needed — the middleware hooks `res.on("finish")` early in the chain, then reads `req.auth` (set later by that route's `authenticate`, if any) once the response has actually finished. It writes one `AuditLog` row via:
- `actorId`: `req.auth?.sub ?? null` (matches `User.id`).
- `action`: `CREATE` (POST) / `UPDATE` (PUT, PATCH) / `DELETE` (DELETE).
- `entityType`: inferred from the first path segment (kebab-case → PascalCase, naive trailing-`s` stripped, e.g. `/points-accounts` → `PointsAccount`).
- `entityId`: `req.params.id` if present, else the response body's `id` field, else the literal string `"unknown"` (with a `console.warn`) — a row is always written, never silently dropped for lack of an id.
- `metadata`: `{ method, path, role, requestBody, responseBody }` — both bodies redacted (keys `password`, `passwordHash`, `token`, `accessToken`, `refreshToken`, `tokenHash`, `newAccessToken`, `newRefreshToken`, `secret`, `apiKey`, `authorization` become `"[REDACTED]"`). This is a fixed key-name denylist, not structural — a future route storing a secret under a different field name won't be caught automatically; extend `REDACTED_KEYS` in `audit.ts` when that happens. There's no dedicated `role` column on `AuditLog`, so role rides in `metadata` instead — a deliberate choice, not a schema gap. `redact()` special-cases `Date` values (serializing to ISO strings) before its generic array/object recursion — without that, any `Date` field on a Prisma record echoed back in a response body (nearly every model has `createdAt`/`updatedAt`) would silently collapse to `{}`, since `Object.entries(new Date())` returns no own enumerable properties.

**Only successful mutations are logged** (`res.statusCode < 400`) — a rejected request didn't actually change anything, so it isn't recorded as an audit entry.

**Excluded automatically:** `/auth/*` and `/health`. Auth routes mutate `RefreshToken` rows but that's already self-documented there (`revokedAt`/`replacedByTokenId`); the audit log stays scoped to business-entity mutations.

**To exclude or override a route without touching the middleware:**
- `res.locals.skipAudit = true` — skips audit logging entirely for that route.
- `res.locals.auditEntityType` / `res.locals.auditEntityId` — override automatic inference (needed for non-flat routes, e.g. a future nested resource like `POST /points-accounts/:id/transactions`, where the mutated entity isn't the first path segment).

**Error handling:** the audit write is fired from inside the `finish` handler, after the response has already been sent, and is never awaited by the request — a DB/logging failure cannot block or fail the business response. On failure it's `console.error`'d (never silently swallowed) so a missed log is visible in server logs even though the client never sees it.

**Known limitation:** entity-type/id inference only looks at the first path segment and `req.params.id`, so it silently mislabels nested routes — including CLAUDE.md's own documented RBAC example, `POST /poles/:poleId/todos`, which would get audited as `entityType: "Pole"` instead of `"Todo"`. `audit.test.ts` has a test pinned to this exact scenario (`"KNOWN LIMITATION: mislabels entityType..."`) so the wrong-but-expected behavior is visible and won't silently change — any real route shaped like this **must** set `res.locals.auditEntityType`/`auditEntityId` explicitly (see below). There's also no generic DB "before" snapshot: `metadata.requestBody` is the client's change payload, not a true prior-row read — building one generically would require mapping each inferred `entityType` back to a Prisma delegate, which is unverified against any real route since none exist yet. If a future route needs a real before/after diff, have that handler set `res.locals.auditBefore` before responding and extend the middleware to include it (not currently implemented).

**Coverage right now:** zero live routes actually produce an audit row today — the only mutating routes that exist (`/auth/login`, `/auth/refresh`, `/auth/logout`) are excluded by design above. The middleware applies automatically the moment any future business mutating route is added; no wiring needed per route.

## Security hardening

App assembly lives in `apps/backend/src/app.ts` (`createApp()`, exported for testing — see `src/__tests__/app.test.ts`), imported by `src/index.ts`, which only calls `.listen()` and owns process-level shutdown. `src/app.ts` imports `./config/env.js` as its own first line (not just relying on `index.ts`'s), so the fail-fast secret check can't accidentally run after some other import that itself needs a DB connection.

Cross-cutting, applied globally in `createApp()` (not specific to any one route):
- `helmet()` is applied first, before `express.json()`, for standard security headers (CSP, HSTS, `X-Content-Type-Options`, etc.).
- `express.json({ limit: "100kb" })` — an explicit body-size limit (matches the library's own default; made explicit so it's a deliberate choice, not an implicit one).
- A generic error-handling middleware is registered last (after all routers). It never leaks a stack trace or `err.message` to the client, regardless of `NODE_ENV` (Express's own default handler leaks the stack trace whenever `NODE_ENV !== "production"`, which would otherwise apply to local dev and CI test runs — the Docker runtime image sets `NODE_ENV=production`, but `pnpm dev` and CI don't). It does forward a genuine 4xx status when the error already carries one (`err.status`/`err.statusCode` in the 400-499 range — e.g. `express.json()`'s malformed-JSON `SyntaxError`, or a body exceeding the limit above) as `{ error: "bad request" }`, falling back to `500 { error: "internal server error" }` only for everything else — a client mistake is no longer reported as a server failure.
- `SIGTERM`/`SIGINT` handlers (in `index.ts`) close the HTTP server and call `prisma.$disconnect()` before exiting, instead of leaving Prisma to be torn down mid-request on container stop.
- `/auth/login` has rate limiting (10/15min/IP); `/auth/refresh` and `/auth/logout` share a looser 30/15min/IP limiter — see **Authentication** above. Both limiters are constructed inside `createApp()`, so tests get isolated state per app instance.
- The `apps/backend/Dockerfile`'s `build` stage runs `pnpm --filter @wave/backend run prisma:generate` before compiling — without it, a fresh `docker build` fails the same way a fresh CI checkout used to (see **Known issues / follow-ups**): `@prisma/client`'s postinstall can't find `schema.prisma` at its non-default workspace path and silently no-ops. The runtime image no longer ships devDependencies or compiled test files: a `prod-deps` stage runs `CI=true pnpm -C apps/backend prune --prod` on top of the already-built `build` stage (pruning in place, rather than a second full install, so the already-generated Prisma Client survives — a fresh `--prod`-only install would never regenerate it, since the `prisma` CLI is itself a devDependency); separately, `apps/backend/tsconfig.build.json` (extends `tsconfig.json`, excludes `src/**/__tests__/**`) is what `package.json`'s `build` script actually emits from (`tsc -p tsconfig.json --noEmit && tsc -p tsconfig.build.json` — the first invocation still type-checks tests, the second just doesn't emit them), so `dist/__tests__` no longer exists. Both were verified against a real `docker build` + `docker compose up` boot (not just read): confirmed `require.resolve('vitest')` fails and `require.resolve('express')`/`require.resolve('@prisma/client')` succeed inside the built image, `dist/__tests__` is absent, and `/health` responds `200` end to end against the real Postgres service. Note: `pnpm -C apps/backend prune --prod` (unlike a plain unscoped `pnpm prune --prod`, which reads the *workspace root's* manifest and — verified by testing — deletes prod dependencies too) only removes the per-project symlinks; the underlying pnpm content-addressable store (`node_modules/.pnpm`) still physically retains the pruned packages' files, so this closes the *reachability*/import-surface gap but doesn't meaningfully shrink image size on disk.

**Not done, and deliberately so:**
- `app.set("trust proxy", ...)` is **not** configured. There's no reverse proxy in front of the backend yet (plain Docker Compose, no nginx/Caddy). Enabling `trust proxy` without one would let any client spoof its own IP via `X-Forwarded-For`, which the `auditLog` middleware records — that would make audit IPs *less* trustworthy, not more. Set this only when a real reverse proxy is introduced, pointed at that proxy's actual hop count.
- No outbox/durability mechanism for audit log writes — see **Audit Logging**'s fire-and-forget behavior above. Out of scope without a queue.

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

## Known issues / follow-ups

- **Fixed (2026-09-04):** CI was failing on every fresh checkout (`prisma generate` never ran in CI, so the backend `build` step failed on `@prisma/client` type resolution; CI also never ran the backend test suite). `ci.yml` now runs `prisma generate` → lint → build → test in that order; verified against a genuine fresh-clone simulation, not just read. See `AUDIT-auth-rbac-audit-log.md` for the original findings from the 2026-09-03 audit of auth/RBAC/audit-logging, and this section plus **Authentication**/**Audit Logging**/**Security hardening** above for what was fixed vs. accepted as a documented tradeoff.
- **Not fixed, accepted as-is:** `trust proxy` (see **Security hardening**) and the audit log's fire-and-forget durability (see **Audit Logging**) — both would need infrastructure (a reverse proxy, a queue) that doesn't exist yet.
- **Fixed (2026-09-07):** a follow-up read-only audit of the same auth/RBAC/audit-logging scope re-confirmed CI was green and found no blocking issues, but surfaced 12 should-fix/minor items (the audit log's `redact()` silently turning `Date` values into `{}`; the generic error handler discarding real 4xx status codes; the Dockerfile never running `prisma generate` at all — a latent build failure, not just a hygiene issue; the production image shipping devDependencies and compiled test files; `src/index.ts` having zero test coverage; and several smaller gaps — see **Authentication**/**Audit Logging**/**Security hardening** above for what changed). All 12 were fixed in this pass; see `AUDIT-auth-rbac-audit-log.md` (2026-09-07 revision) for the full per-finding writeup and fix-status annotations. The CI job was also renamed from `lint-and-build` to `build-and-test` to match what it actually runs (no branch protection rule referenced the old name).

## Open questions

These are ambiguous in the current spec and were not guessed silently — resolve with the project owner when relevant:

- **Point-earning methods** beyond event participation: TBD.
- **Pole-specific custom modules**: not yet defined per pole (Communication, Events, Partenariats) — to be specified before Build Order step 4.
- **SumUp Cloud API integration details** (auth flow, device pairing, webhook handling): not yet specified.
- **Log export mechanics** to Google Drive (format, frequency beyond "daily", auth credentials): not yet specified.
- **Initial password / Member creation flow**: no endpoint or seed script sets a `Member`'s first password yet — see **Authentication** gotcha above.

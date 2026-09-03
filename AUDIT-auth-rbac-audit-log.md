# Audit: Auth, RBAC, Audit Logging (2026-09-03)

Read-only audit of the three most recent backend features: JWT + refresh token auth, RBAC middleware (BUREAU / RESPONSABLE_POLE / MEMBRE_POLE), and the generic audit logging middleware. No application code, tests, or CI config were modified.

**Scope reviewed:** `apps/backend/src/routes/auth.ts`, `src/lib/jwt.ts`, `src/lib/password.ts`, `src/lib/prisma.ts`, `src/config/env.ts`, `src/index.ts`, `src/middleware/{authenticate,rbac,audit,index}.ts`, `src/types/express.d.ts`, `src/__tests__/**`, `prisma/schema.prisma`, all 3 migrations, `.github/workflows/ci.yml`, backend/root `package.json`, `pnpm-workspace.yaml`, `Dockerfile`, `.dockerignore`, `.env.example` files. Frontends and `packages/*` were out of scope (no auth/RBAC/audit logic lives there).

**What was actually executed (not just statically reviewed):**
- `gh run list` / `gh run view --log-failed` against the real GitHub Actions history for this repo.
- A fresh `git clone` into a scratch directory, then `pnpm install --frozen-lockfile`, `pnpm run lint`, `pnpm run build` from that clean clone — i.e. a true CI simulation, not just reading `ci.yml`.
- `pnpm --filter @wave/backend test` (28 tests) against the existing Vitest suite.
- Direct `tsx` runs of `src/index.ts` under various env-var combinations to verify fail-fast behavior empirically.

Nothing was out of reach — CI was verified against both the real Actions history and a local fresh-clone reproduction, not guessed at.

---

## Fix status (2026-09-04)

All 16 findings were addressed in this pass. 13 got a code/config fix (verified: full test suite — 40 tests, up from 28 — plus lint/build/test all pass in a fresh-clone simulation of the fixed CI pipeline). 3 were deliberately left as documented, accepted tradeoffs rather than "fixed" — see CLAUDE.md's **Authentication**, **Audit Logging**, and **Security hardening** sections for the reasoning on each. Status is tagged inline on every finding below.

---

## Summary

The auth/RBAC/audit **logic itself** is solid — rotation, reuse-detection, BUREAU bypass, and redaction all work as documented, and all 28 existing unit tests pass. The **critical problem is the pipeline wrapped around it**: CI has been failing on every one of the last three feature commits (verified against actual run history), for a root cause not yet diagnosed anywhere in the repo. That is finding #1 and should be treated as the top priority.

---

## Blocking

### 1. CI build fails on every fresh checkout — confirmed against live run history, root cause is a missing `prisma generate` step
**Status: FIXED** — `ci.yml` now runs `pnpm --filter @wave/backend run prisma:generate` right after install, before lint/build/test. Re-verified via a genuine fresh-clone simulation (build now succeeds).
**Where:** `.github/workflows/ci.yml` (no `prisma generate` step); `@prisma/client` postinstall behavior; `apps/backend/tsconfig.json` build target.

**Evidence, not speculation:**
```
gh run list --limit 10
completed  failure  feat(backend): add generic audit logging middleware   CI  main  push  33809767037  48s
completed  failure  feat(backend): add RBAC middleware ...                CI  main  push  33808872473  49s
completed  failure  feat(backend): add JWT auth with rotating refresh tokens  CI  main  push  33807827079  45s
```
The last **three consecutive CI runs on `main` — exactly the auth, RBAC, and audit-logging commits this audit covers — have all failed.** I reproduced this locally: cloned the repo fresh into a scratch dir (no shared node_modules/build cache) and ran `pnpm install --frozen-lockfile && pnpm run build`, exactly as CI does. Result:
```
apps/backend build: src/lib/jwt.ts(3,15): error TS2305: Module '"@prisma/client"' has no exported member 'MemberRole'.
apps/backend build: src/middleware/audit.ts(19,41): error TS2694: Namespace '...Prisma' has no exported member 'InputJsonValue'.
apps/backend build: src/middleware/rbac.ts(2,15): error TS2305: Module '"@prisma/client"' has no exported member 'MemberRole'.
apps/backend build: src/routes/auth.ts(2,15): error TS2305: Module '"@prisma/client"' has no exported member 'Member'.
apps/backend build: src/routes/auth.ts(2,23): error TS2305: Module '"@prisma/client"' has no exported member 'User'.
apps/backend build: Failed
```
This is byte-for-byte the same failure GitHub Actions logs show.

**Root cause:** `@prisma/client`'s postinstall script does run automatically (it's allow-listed in `pnpm-workspace.yaml`'s `allowBuilds`), but it looks for `schema.prisma` in *default locations relative to the postinstall's working directory* (the workspace root). The actual schema lives at `apps/backend/prisma/schema.prisma`, a non-default location for a monorepo. The postinstall logs (visible when I ran a fresh install) confirm this exactly:
```
@prisma/client postinstall: prisma:warn We could not find your Prisma schema in the default locations
@prisma/client postinstall: If you have a Prisma schema file in a custom path, you will need to run
@prisma/client postinstall: `prisma generate --schema=./path/to/your/schema.prisma` to generate Prisma Client.
```
It exits 0 ("Done") without generating anything — a **silent no-op**, not an install failure, which is why it's easy to miss locally (any dev who ran `prisma migrate dev` or `prisma generate` once, even months ago, has a stale-but-working local client and would never see this). `apps/backend/package.json` even has a `"prisma:generate": "prisma generate"` script — it's just never invoked anywhere in CI.

**Why it matters:** every commit to this repo since JWT auth landed has been shipping on a red pipeline. The "lint + build on push/PR" gate from Phase 0 is not actually gating anything right now, and there's no way to trust future green runs either, once this is fixed, without also fixing #2 below.

**Suggested fix (do not apply):** add a `prisma generate --schema=apps/backend/prisma/schema.prisma` step to `ci.yml` before the build step (and ideally as a `postinstall`/`prepare` script scoped to `apps/backend` so local dev doesn't silently rot the same way).

---

### 2. CI never runs the test suite — 28 passing tests provide zero protection in the pipeline
**Status: FIXED** — added a `Test` step to `ci.yml` (`pnpm run test`) plus a root `"test": "pnpm -r --if-present run test"` script so future packages' tests are picked up automatically.
**Where:** `.github/workflows/ci.yml` (`jobs.lint-and-build.steps` — only `Lint` and `Build`, no `Test` step); root `package.json` (`scripts` — no `test` script at all, only `dev`/`build`/`lint`).

I ran the suite directly (`pnpm --filter @wave/backend test`): all 28 tests across `rbac.test.ts` and `audit.test.ts` pass. That's real, useful coverage of exactly the BUREAU-bypass, cross-pole-grant, and redaction logic this audit was asked to check — but **it never executes in CI**. Even after fixing #1, a change that broke `requirePoleAccess()` or the redaction logic would still merge green.

**Why it matters:** this is the literal "test coverage gap" the audit brief asked about — not missing tests, but missing wiring. The job name itself (`lint-and-build`) telegraphs that testing was never part of the Phase-0 CI design.

**Suggested fix (do not apply):** add a `Test` step (`pnpm --filter @wave/backend test` or a root `test` script that fans out via `pnpm -r run test`) to `ci.yml`, after the build step so it benefits from #1's fix.

---

## Should-fix

### 3. Refresh-token rotation has a TOCTOU race that can silently double-issue sessions
**Status: FIXED** — the revoke is now a conditional `updateMany({ where: { id, revokedAt: null } })` inside the same transaction as the create; a `count === 0` result rolls back the transaction and triggers the same "revoke everything for this user" theft response. Covered by `auth.test.ts`'s "treats a losing rotation race..." and "rotates successfully when no race occurs" tests.
**Where:** `apps/backend/src/routes/auth.ts:92-136` (`/auth/refresh`).

The handler reads `existing` (including `existing.revokedAt`) in a plain `findUnique`, decides the token is still valid, *then* opens a `prisma.$transaction` to create the new token and revoke the old one. The read (revoked-or-not decision) and the write (revoke) are not atomic with each other. If the same refresh token is submitted twice concurrently — a duplicate client retry racing the original request, or literal token theft racing the legitimate user — both requests can pass the `if (existing.revokedAt)` check before either transaction commits. Both then succeed, each minting a fresh access+refresh pair from the same presented token, and reuse-detection (the theft signal this feature exists for) never fires because neither request ever observed `revokedAt` set.

**Why it matters:** this directly undermines the "reuse of an already-rotated token = treat as theft, revoke everything" guarantee documented in CLAUDE.md — under a race, a token can be "reused" once without detection, doubling active sessions silently.

**Suggested fix (do not apply):** make the revoke conditional and check its result inside the transaction, e.g. `tx.refreshToken.updateMany({ where: { id: existing.id, revokedAt: null }, data: {...} })` and abort/treat-as-reuse if `count === 0`, instead of trusting the earlier read.

---

### 4. Login has a timing side-channel that leaks which emails have a `Member` account
**Status: FIXED** — added `verifyDummyPassword` (`password.ts`), a bcrypt compare against a fixed dummy hash, run on the early-return path so it costs the same as a real wrong-password attempt. Covered by `auth.test.ts`'s "still runs the dummy password check..." tests.
**Where:** `apps/backend/src/routes/auth.ts:42-51`.

```ts
if (!user || !user.isActive || !user.passwordHash || !user.member || !user.member.isActive) {
  invalidCredentials();   // returns immediately — no bcrypt call
  return;
}
const passwordValid = await verifyPassword(password, user.passwordHash); // bcrypt.compare, cost 12
```
Both paths return the same generic `401 { error: "invalid credentials" }` body (good — no message-based enumeration), but the *timing* differs by roughly the cost of one bcrypt comparison (tens of milliseconds at cost factor 12). An unregistered/non-Member email returns near-instantly; a registered email with a wrong password takes measurably longer. This lets an attacker enumerate which school emails belong to actual `Member`s (BDE staff) by timing `/auth/login` responses.

**Why it matters:** this is exactly the kind of adversarial-use case the audit brief asked about, and it's a well-known, easily-fixed class of bug.

**Suggested fix (do not apply):** always perform a bcrypt comparison (against the real hash if present, otherwise a fixed dummy hash) before branching, so both paths take comparable time.

---

### 5. RBAC/JWT trust the token's embedded role/pole for up to 15 minutes after it's revoked in the DB
**Status: ACCEPTED (documented, not code-changed)** — project owner's call: this is an intentional stateless-JWT tradeoff given the project's size, not an oversight. Now explicitly documented as such in CLAUDE.md's **Authentication** section rather than an implicit gap. Revisit with a `tokenVersion`-style check only if the window becomes unacceptable.
**Where:** `apps/backend/src/middleware/authenticate.ts`, `src/middleware/rbac.ts`, `src/lib/jwt.ts` (`AccessTokenPayload` carries `role`/`poleId` at issuance time, by design, per CLAUDE.md — "enough for a future RBAC middleware to authorize without a DB hit").

`authenticate` never touches the DB, and `requireRole`/`requirePoleAccess`'s BUREAU-bypass and native-pole paths don't either. If a BUREAU member is demoted, deactivated, or reassigned pole, their **already-issued access token keeps working exactly as before** — including for BUREAU-only routes — until it naturally expires (up to 15 minutes). There is no access-token blocklist/revocation mechanism. (Refresh tokens *are* re-checked against `user.isActive`/`member.isActive` on `/auth/refresh`, but that only stops the *next* refresh, not the currently-valid access token.)

**Why it matters:** directly answers the audit brief's question "can a MEMBRE_POLE reach a BUREAU-only route under any condition" — not as a freshly-issued MEMBRE_POLE, but a **just-demoted former BUREAU member can, for up to 15 minutes.** Given BUREAU is "the only tier that can correct point disputes/errors" (CLAUDE.md), this is a meaningful window for a scenario like "we just fired/demoted someone for a reason."

**Suggested fix (do not apply):** this is an inherent stateless-JWT tradeoff and 15 minutes may be an acceptable risk for this project's size — but it should be a documented, explicit decision rather than an implicit one. If tighter, consider a short-lived access token (e.g. 2-5 min) for BUREAU specifically, or a lightweight revocation check (e.g. a `tokenVersion`/`security_stamp` column bumped on role change, checked cheaply).

---

### 6. Audit entity-type/entity-id inference breaks on nested routes — including the exact route shape CLAUDE.md documents as the standard pattern
**Status: FIXED (as test coverage, not a behavior change)** — the inference logic itself is unchanged (can't safely fix it without knowing real route shapes, which don't exist yet). Added a test in `audit.test.ts` ("KNOWN LIMITATION: mislabels entityType...") that pins the exact `/poles/:poleId/todos` mislabeling so it's visible and documented rather than silently wrong, plus a matching note in CLAUDE.md's **Audit Logging** section.
**Where:** `apps/backend/src/middleware/audit.ts:48-59` (`inferEntityType`) and `:92-99` (entityId fallback chain).

`inferEntityType` takes only the **first** path segment. `entityId` falls back to `req.params.id` specifically (not any other param name). CLAUDE.md's own RBAC documentation gives this as the canonical protected-route pattern:
```ts
router.post("/poles/:poleId/todos", authenticate, requireRole(...), requirePoleAccess(), handler);
```
Under `auditLog`, a `POST` to that route would be logged with `entityType: "Pole"` (wrong — it's creating a `Todo`) and `entityId` would miss `req.params.poleId` entirely (wrong param name) and fall through to the response body's `id`, which happens to be correct only by coincidence (because the created Todo's id is in the response). A `PUT /poles/:poleId/todos/:todoId` update would fare worse: `req.params.id` is `undefined` (the param is `todoId`), so entityId depends entirely on the response body containing an `id` field.

CLAUDE.md already documents the override escape hatch (`res.locals.auditEntityType`/`auditEntityId`) as the intended mitigation, so this isn't an unknown gap — but it's currently **enforced by convention only**: nothing tests, lints, or warns when a future route handler forgets to set the override. Given audit logging is called out as a "hard requirement, not optional," a silent mislabeling (rather than a hard failure) is the worse failure mode.

**Suggested fix (do not apply):** either (a) add a test in `audit.test.ts` covering a nested route exactly like `/poles/:poleId/todos` to make the failure mode visible and documented, or (b) have the middleware `console.warn` (like it already does for missing entityId) whenever it falls back to path-based inference on a route with more than one non-param path segment, as a canary for "did you forget the override."

---

### 7. `RefreshToken.expiresAt` is written but never read anywhere
**Status: FIXED** — `/auth/refresh` now checks `existing.expiresAt <= new Date()` explicitly, independent of the JWT's own `exp`. (Periodic cleanup of expired/revoked rows was left out as a separate, larger job-infrastructure task.)
**Where:** `apps/backend/prisma/schema.prisma:148-161` (`RefreshToken.expiresAt`); `apps/backend/src/routes/auth.ts` (`/auth/refresh` only checks `revokedAt`, never `expiresAt`).

The column is populated correctly on every issuance (`new Date(Date.now() + REFRESH_TOKEN_TTL_MS)`), but no code path ever queries against it. Expiry is currently enforced *only* by the JWT's own `exp` claim (`jwt.verify` throws before the DB is even consulted), which today happens to use the same 30-day constant, so behavior is currently correct — but the DB column is dead weight providing no independent defense-in-depth, and nothing purges expired rows, so `RefreshToken` will grow unbounded forever (one row per login/refresh, never deleted).

**Why it matters:** should-fix rather than blocking — it's not exploitable today since the JWT expiry and the DB column are numerically in sync — but it's a latent trap: if the two constants (`REFRESH_TOKEN_TTL` in `jwt.ts` vs. anything computing `expiresAt`) ever drift, or if the JWT-signing library's expiry is ever bypassed for any reason, there is no DB-side backstop despite the column existing and implying one.

**Suggested fix (do not apply):** either check `existing.expiresAt < new Date()` explicitly in `/auth/refresh` (defense-in-depth, cheap), and/or add a periodic cleanup job for expired/revoked rows past some retention window.

### 8. `jwt.verify` calls don't pin an algorithm allowlist
**Status: FIXED** — both `jwt.sign`/`jwt.verify` call pairs in `jwt.ts` now pass `{ algorithms: ["HS256"] }` explicitly.
**Where:** `apps/backend/src/lib/jwt.ts:22` (`verifyAccessToken`) and `:46` (`verifyRefreshToken`).

Neither call passes `{ algorithms: ["HS256"] }`. Not currently exploitable — both secrets are pure HMAC strings, `jwt.sign` always signs HS256, and there's no RSA/EC public key anywhere in this codebase for a classic alg-confusion attack to target — but it's a standard hardening recommendation (OWASP JWT cheat sheet) and cheap insurance against a future change (e.g., adding an RS256-signed token elsewhere and secrets/keys getting mixed up).

**Suggested fix (do not apply):** add `{ algorithms: ["HS256"] }` to both `jwt.verify` calls.

---

## Minor

### 9. No brute-force protection on `/auth/login`
**Status: FIXED** — added `express-rate-limit`, 10 attempts/15min per IP, in-memory store (fine for the single-instance VPS deployment; revisit if ever horizontally scaled).
No rate limiting, lockout, or CAPTCHA; bcrypt cost-12 provides some inherent throttling (~tens of ms/attempt) but nothing bounds request volume. Reasonable to defer for a small BDE user base, but worth an explicit decision given points balances are real money. No `express-rate-limit` or similar dependency present.

### 10. No security headers middleware (`helmet`)
**Status: FIXED** — `helmet()` added as the first middleware in `index.ts`.
No `helmet` (or equivalent) is installed; only `express.json()` is registered. CORS is already a documented deferred decision — this is the same category (defer, but document).

### 11. `requirePoleAccess()`'s DB-error path can leak a stack trace in non-production
**Status: FIXED** — a generic error-handling middleware is now registered last in `index.ts`; it always responds `500 { error: "internal server error" }` with no stack trace, regardless of `NODE_ENV`.
`rbac.ts:46-48` calls `next(err)` on a Prisma error, and `index.ts` registers no custom error-handling middleware, so Express's built-in default handler takes over. That handler includes the stack trace in the response body when `NODE_ENV !== "production"`. The Docker runtime image sets `NODE_ENV=production` (so prod is safe), but local `pnpm dev` and CI test runs have no `NODE_ENV` set, so a transient DB error during local dev/testing of pole-scoped routes would echo a stack trace to the client. Low impact (non-prod only) but easy to close.

### 12. Audit log writes are fire-and-forget with no durability guarantee
**Status: ACCEPTED (not fixed)** — closing this properly needs an outbox/queue, disproportionate to this pass. Documented explicitly in CLAUDE.md's **Security hardening** section as a known, deliberate gap rather than an unnoticed one.
By design (documented in CLAUDE.md) the `prisma.auditLog.create()` call in `audit.ts:101-120` is never awaited and errors are only `console.error`'d. This is a reasonable choice to avoid blocking the response, but it does mean a process crash/restart in the small window between "response sent" and "audit write resolved" silently drops that log entry, with no outbox/retry mechanism — worth flagging given "every mutating action must be logged... hard requirement" language in CLAUDE.md is otherwise fairly absolute. No live routes are affected yet since nothing currently triggers auditable mutations.

### 13. `redact()` in `audit.ts` is a fixed key denylist, not structural
**Status: FIXED (widened, still a denylist)** — added `newAccessToken`, `newRefreshToken`, `secret`, `apiKey`, `authorization` to `REDACTED_KEYS`. Still a fixed key-name list by nature (documented in CLAUDE.md) — extend it whenever a new route introduces a differently-named secret field.
`REDACTED_KEYS` (`audit.ts:8-15`) only catches exact key names (`password`, `passwordHash`, `token`, `accessToken`, `refreshToken`, `tokenHash`). A future route that stores a secret under a differently-named field (e.g. `newRefreshToken`, `apiKey`, `secret`) would have it logged in plaintext into `AuditLog.metadata`. Not currently exploitable (no live routes), but worth a lint/convention note for future route authors.

### 14. No `req.ip` / `trust proxy` configuration
**Status: ACCEPTED (not fixed, deliberately)** — there's no reverse proxy yet. Enabling `trust proxy` now would let any client spoof its own IP via `X-Forwarded-For`, making audit-log IPs *less* trustworthy, not more. Documented in CLAUDE.md's **Security hardening** section as "set this only when a real reverse proxy is introduced."
`audit.ts:108` records `req.ip`. Express's `trust proxy` setting is never configured in `index.ts`. Once this is deployed behind a reverse proxy (likely, per the VPS/Docker Compose architecture), `req.ip` will report the proxy's address rather than the real client unless `app.set("trust proxy", ...)` is added. Not an issue in the current no-proxy local/Docker-Compose setup.

### 15. `PrismaClient` has no graceful-shutdown wiring
**Status: FIXED** — `SIGTERM`/`SIGINT` handlers in `index.ts` close the HTTP server, then call `prisma.$disconnect()`, before exiting. Verified manually: sending SIGTERM prints "SIGTERM received, shutting down" and exits cleanly.
`apps/backend/src/lib/prisma.ts` exports a bare `new PrismaClient()` with no `process.on("SIGTERM"/"SIGINT")` disconnect handler. Minor for a single-instance VPS deployment; compounds finding #12 slightly (in-flight audit writes could be cut off mid-shutdown).

### 16. `entityType` inference's naive trailing-`s` strip mishandles non-plural words
**Status: ACCEPTED (not fixed)** — CLAUDE.md already documents this as a deliberate simplification, not a bug, and no live route triggers it. Left as-is; revisit only if a real route path collides with it.
`inferEntityType` (`audit.ts:48-59`) strips a trailing `s` unconditionally — already flagged as a known simplification in CLAUDE.md. Confirmed it would mislabel any future resource path that legitimately ends in `s` but isn't a plural (e.g. a hypothetical `/status` or `/access` route → `"Statu"`/`"Acces"`). No live route triggers this today; noting for when routes are added.

---

## CI: explicit answers to the brief's questions

- **Does the pipeline actually run and pass against this new code?** No. Verified against real run history (`gh run list`) — the last 3 pushes (JWT auth, RBAC, audit logging) all show `failure`. Reproduced locally via a genuinely fresh clone + `pnpm install --frozen-lockfile` + `pnpm run build`. Root cause is finding #1.
- **Is there a test coverage gap for what was just built?** The tests exist and are good (28/28 passing when run manually), but CI never invokes them — see finding #2. That is the coverage gap: wiring, not test content. One content-level gap also exists (finding #6's nested-route scenario isn't covered).
- **Any config drift since Phase 0 CI setup (Node/pnpm versions, cache, lint, typecheck)?** None found. `engines.node: ">=22.13"` (root `package.json`) matches CI's `node-version: 22` and the Dockerfile's `node:22-alpine`. `pnpm/action-setup@v4` has no hardcoded version and correctly reads the `packageManager: pnpm@11.18.0` field — confirmed consistent, no drift. `pnpm-workspace.yaml`'s `allowBuilds` correctly allow-lists `@prisma/client`/`prisma`/`esbuild` for postinstall scripts (this is *why* the client generation is attempted at all — the workspace-root-relative schema path is the actual bug, not a missing allow-list entry). Caching (`cache: pnpm` in `setup-node`) is present and fine.

Nothing about the CI investigation was left unverified — every claim above was checked against either the live GitHub Actions API or a genuine fresh-clone reproduction, not inferred from reading `ci.yml` alone.

---

## What was NOT covered

Per the requested scope, frontend apps (`bureau`, `buvette`, `pole-*`, `showcase`) and `packages/*` were not reviewed — no auth/RBAC/audit logic currently lives there. The already-documented "Known gap" (no Member password-creation/reset flow) was intentionally not re-reported as a new finding since CLAUDE.md already tracks it.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Phase 0 (scaffold) is complete. The monorepo is set up as pnpm workspaces with the backend and all 4 frontends scaffolded under `apps/`, shared packages under `packages/`, local Docker/Postgres infra, a root README, and a CI pipeline (lint + build on push/PR).

The backend currently exposes only a `GET /health` route — no auth, RBAC, audit logging, or Prisma schema yet. That's Build Order step 1, not yet started. Frontends are scaffolded shells (Vite/React/TS/Tailwind) with no real UI or routes yet.

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

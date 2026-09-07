# Multi-stage image for @wave/pole-events — a static Vite/React SPA served by
# Caddy. Same shape as apps/backend/Dockerfile (base/deps/build/runtime).
# Build context is the REPO ROOT (pnpm workspace) — see docker-compose.prod.yml.

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

# ---- deps: install only what @wave/pole-events needs from the workspace ----
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile --filter @wave/pole-events...

# ---- build: compile + bundle the static app ----
# VITE_API_URL must be a real process env var (not just an env file) when
# the Vite build runs, so it gets inlined into import.meta.env.VITE_API_URL —
# see apps/pole-events/src/lib/api.ts.
FROM deps AS build
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm --filter @wave/pole-events build

# ---- runtime: Caddy serving the static build, SPA fallback ----
FROM caddy:2-alpine AS runtime
COPY --from=build /repo/apps/pole-events/dist /usr/share/caddy
COPY deploy/frontend.Caddyfile /etc/caddy/Caddyfile

EXPOSE 80

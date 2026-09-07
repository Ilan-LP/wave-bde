# Dev-oriented multi-stage image for @wave/backend.
# Build context is the REPO ROOT (see docker-compose.yml `build.context: .`)
# because this is a pnpm workspace and the backend may depend on packages/*.
#
# Node 22 (not 20, despite engines >=20 in package.json): the workspace pins
# packageManager pnpm@11.18.0 via corepack, which requires Node >=22.13.

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

# ---- deps: install only what @wave/backend needs from the workspace ----
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile --filter @wave/backend...

# ---- build: compile TypeScript to dist ----
FROM deps AS build
RUN pnpm --filter @wave/backend run prisma:generate
RUN pnpm --filter @wave/backend build

# ---- prod-deps: strip devDependencies (vitest, tsx, typescript, the prisma
# CLI, @types/*, ...) from the already-installed node_modules before it ships.
# Pruning in place (rather than a second `--prod` install) is deliberate: a
# fresh --prod-only install would never invoke `prisma generate` again (the
# `prisma` CLI is itself a devDependency, so a --prod install doesn't even
# have it), leaving @prisma/client ungenerated in that tree. Pruning keeps
# the already-generated client from the `build` stage intact and just
# removes the dev-only packages around it. ----
FROM build AS prod-deps
RUN CI=true pnpm -C apps/backend prune --prod

# ---- runtime: minimal image running the compiled backend ----
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build --chown=node:node /repo/apps/backend/package.json ./apps/backend/package.json
COPY --from=build --chown=node:node /repo/apps/backend/dist ./apps/backend/dist
COPY --from=prod-deps --chown=node:node /repo/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /repo/apps/backend/node_modules ./apps/backend/node_modules
WORKDIR /repo/apps/backend
USER node

EXPOSE 3000
CMD ["node", "dist/index.js"]

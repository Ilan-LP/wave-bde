# Deploying Wave (production)

Manual checklist for standing up the full stack (Postgres, backend, all 6
frontends) on the shared, always-on Debian machine that already hosts other
projects (e.g. "dolibarr") behind one edge Caddy instance. This deployment
does not install or run its own reverse proxy or handle TLS/certs — both
are already owned by the existing shared edge Caddy + cloudflared tunnel.
Nothing in this checklist has been run or verified against a real machine —
this is documentation only. Work through it top to bottom; later steps
assume earlier ones are done.

Repo-side config referenced below: `docker-compose.prod.yml`,
`deploy/sites.reference.caddy`, `.env.production.example`. See `CLAUDE.md`'s
**Deployment (production)** section for the full reasoning behind this
shared-machine setup.

**Confirmed about the shared machine's existing setup:** one edge Caddy
instance (Docker container, single Caddyfile, one `.caddy` site file per
hosted project under `/opt/proxy/caddy/sites/`, e.g. `dolibarr.caddy`); TLS
is terminated by an existing cloudflared tunnel in front of that Caddy, not
by DNS-01/ACME inside it; an external Docker network named `edge` that
every reverse-proxied container joins; a backup script at
`/opt/proxy/backup.sh` (outside this repo, not modified here) that expects
the Postgres service it backs up to be named `db`.

## 1. Confirm the shared machine prerequisites

- [ ] Docker Engine + the Compose plugin are already installed (this
      machine already runs other Docker projects).
- [ ] Confirm the external `edge` Docker network already exists:
      `docker network ls | grep edge`. This repo does not create it —
      `docker-compose.prod.yml` only attaches to it as `external: true`,
      and `docker compose up` fails at network-lookup time if it's missing.
- [ ] Confirm the domain `bde-wave.com` (wildcard `*.bde-wave.com`) is
      already routed through the existing cloudflared tunnel, or add the
      new subdomains this deployment needs (see step 3) to that tunnel's
      config — that tunnel is not part of this repo.

## 2. Deploy the repo

- [ ] Clone the repo onto the machine (e.g. into `/opt/wave`).
- [ ] `cp .env.production.example .env.production` and fill in every
      value — see that file's comments for what each one is and how to
      generate it (`openssl rand -hex 32` for the JWT secrets, a Google
      service-account JSON + Drive folder ID only if you want the audit-log
      export enabled — it's optional, see `CLAUDE.md`'s **Audit Log
      Export** section — and the 6 frontend origins for `CORS_ORIGINS`).
- [ ] Double-check `.env.production` is not tracked by git
      (`git status` should not show it — it's git-ignored).

## 3. Add this project's site file(s) to the shared Caddy config

This deployment does not run its own Caddy — it adds site file(s) to the
Caddy instance already running on this machine for other projects.

- [ ] Use `deploy/sites.reference.caddy` as a starting point — it's a
      best-effort sketch (not a verified copy of the real
      `dolibarr.caddy`), so check the actual shared Caddyfile on the
      machine first and adjust the `import` snippet name(s) to match
      whatever shared header/logging config it really defines.
- [ ] Create the real site file(s) under `/opt/proxy/caddy/sites/` (e.g.
      one `wave.caddy` covering `api.bde-wave.com` + the 6 frontend
      subdomains, or split per-service — match whatever convention
      `dolibarr.caddy` already uses there). This is a manual step on the
      machine, not something this repo writes.
- [ ] Each block should plain-`http://` reverse-proxy to the matching
      container name from `docker-compose.prod.yml` (`wave-backend:3000`,
      `wave-showcase:80`, `wave-bureau:80`, `wave-buvette:80`,
      `wave-pole-comm:80`, `wave-pole-events:80`,
      `wave-pole-partenariats:80`) — no TLS/ACME directives needed, that's
      the existing cloudflared tunnel's job.
- [ ] Reload or restart the existing shared Caddy container so the new
      site file(s) take effect (whatever restart mechanism that project's
      compose setup uses, e.g. `docker exec <shared-caddy-container> caddy
      reload --config /etc/caddy/Caddyfile`).

## 4. First boot of the Wave stack

- [ ] `docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build`
      — brings up `db`, then runs `migrate` to completion (applies pending
      Prisma migrations), then starts `backend` and all 6 frontend
      containers. `backend` won't start until `migrate` has exited
      successfully (`depends_on: condition: service_completed_successfully`).
- [ ] Watch the `migrate` service logs first — a failed migration blocks
      `backend` from starting at all, by design.
- [ ] Watch the `backend` service logs to confirm it starts cleanly (fails
      fast and loudly if `JWT_SECRET`/`JWT_REFRESH_SECRET`/`CORS_ORIGINS`
      are missing — see `CLAUDE.md`'s **Authentication** section; the
      Google Drive vars are optional and won't block startup).

## 5. Verify

- [ ] From outside the machine, hit `https://api.bde-wave.com/health` and
      each frontend subdomain, and confirm `200`s with a valid,
      browser-trusted certificate (issued by the existing cloudflared
      tunnel setup — nothing to configure here).
- [ ] Confirm a deep frontend route (e.g. `https://bureau.bde-wave.com/some/route`)
      still returns the app shell instead of a 404 — that's the SPA
      fallback baked into each frontend's Caddy runtime image (see
      `deploy/frontend.Caddyfile`).
- [ ] Confirm a request from one of the deployed frontend origins to the
      backend succeeds (no CORS rejection) and a request from an
      unlisted origin is blocked — sanity-checks `CORS_ORIGINS`.

## 6. Ongoing

- [ ] Confirm the Postgres service/volume naming (`db` / `wave_db` in
      `docker-compose.prod.yml`) is actually what `/opt/proxy/backup.sh`
      expects on this machine — that script is not part of this repo and
      is not modified here; if it matches by something other than the
      service name (e.g. container name or volume name pattern), double
      check `wave-db`/`wave_db` line up with it too.
- [ ] The daily `AuditLog` → Google Drive export (see `CLAUDE.md`, if
      enabled) is a passive backup of audit logs only, **not** a full
      database backup. Confirm `/opt/proxy/backup.sh`'s Postgres backup
      actually covers the `wave_db` volume — if it doesn't, set up a
      separate periodic backup (e.g. `pg_dump` on a cron job).
- [ ] Certificate renewal, DNS, and the tunnel itself are owned entirely by
      the existing shared infrastructure — nothing to maintain here as
      long as that keeps running.

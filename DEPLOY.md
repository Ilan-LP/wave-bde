# Deploying Wave (production)

Manual checklist for standing up the backend + Postgres stack on the
always-on Debian home machine, **integrating with the Caddy instance that
already runs there for another, unrelated project** — this deployment does
not install or run its own reverse proxy. Nothing in this checklist has
been run or verified against a real machine — this is documentation only.
Work through it top to bottom; later steps assume earlier ones are done.

Repo-side config referenced below: `docker-compose.prod.yml`,
`deploy/wave.caddy`, `.env.production.example`. See `CLAUDE.md`'s
**Deployment (production)** section for why Caddy + Cloudflare DNS-01 were
chosen, and why this integrates with the existing instance instead of
running a second one.

**Confirmed about the existing Caddy instance (2026-09-07):** runs as a
Docker container, uses a single Caddyfile (not an import-directory
pattern), and its binary already has the `caddy-dns/cloudflare` module
built in. Re-verify these before proceeding if that Caddy instance has
since been rebuilt or replaced.

## 1. Machine setup

- [ ] Install Docker Engine + the Docker Compose plugin on Debian (follow
      Docker's official Debian install instructions — not `docker.io` from
      Debian's own repos, which tends to lag).
- [ ] `sudo systemctl enable docker` — so the daemon (and therefore the
      stack, via `restart: unless-stopped`) comes back up automatically
      after a reboot or power loss.
- [ ] Set up a basic firewall (e.g. `ufw`) allowing only inbound SSH, 80,
      and 443 — these are likely already open for the existing project's
      Caddy instance; just confirm, don't assume a fresh rule is needed.

## 2. Domain + DNS

- [ ] Register a domain (or pick an existing one) and set its DNS zone to
      be managed by Cloudflare.
- [ ] In the Cloudflare dashboard, create an API token scoped to
      **Zone:DNS:Edit** for that zone only (My Profile → API Tokens →
      Create Token → "Edit zone DNS" template). Do not use the
      account-wide Global API Key.
- [ ] Create the DNS record(s) the deployment will serve (e.g. an `A`
      record for the apex/subdomain pointing at the home connection's
      current public IP — this will be kept current by dynamic DNS, next
      step).

## 3. Dynamic DNS

This is a home connection, not a static-IP VPS — the public IP can change.
Deliberately **not** containerized in this repo (see `CLAUDE.md`); pick one:

- [ ] Router-level DDNS client, if the router supports updating a
      Cloudflare-managed record directly, **or**
- [ ] A DDNS updater running on the Debian host itself (e.g. a small
      cron job or systemd timer hitting Cloudflare's API with the token
      from step 2) to keep the `A` record pointed at the current IP.
- [ ] Confirm the record actually updates after a forced IP change (e.g.
      router reconnect), not just at initial setup.

## 4. Router port forwarding

- [ ] Confirm external TCP 443 → the Debian machine's internal IP:443 is
      forwarded (required to serve HTTPS traffic) — almost certainly
      already done for the existing project's Caddy instance; this
      deployment doesn't add a new listener, it shares that one.
- [ ] Optionally confirm external TCP 80 → :80 as well (only used for a
      plain-HTTP → HTTPS redirect; **not** required for cert issuance,
      since `deploy/wave.caddy` uses the DNS-01 challenge, which only
      needs outbound access from the machine to Cloudflare's API).
- [ ] If the internal IP is DHCP-assigned, confirm the Debian machine has
      a static reservation on the router so the port-forward rule doesn't
      go stale.

## 5. Deploy the repo

- [ ] Clone the repo onto the machine (e.g. into `/opt/wave`).
- [ ] `cp .env.production.example .env.production` and fill in every
      value — see `.env.production.example`'s comments for what each one
      is and how to generate it (`openssl rand -hex 32` for the JWT
      secrets, the Cloudflare token from step 2, the domain from step 2,
      a Google service-account JSON + Drive folder ID for the audit-log
      export — see `CLAUDE.md`'s **Audit Log Export** section).
- [ ] Set `CADDY_EXTERNAL_NETWORK` in `.env.production` to the actual
      Docker network name the existing Caddy container is attached to
      (e.g. `docker inspect <existing-caddy-container> --format '{{json .NetworkSettings.Networks}}'`
      on the machine, or check that other project's own compose file).
      `docker-compose.prod.yml` attaches `backend` to this network as an
      `external: true` network so the existing Caddy can reach it by
      container name (`wave-backend-prod`) — this step fails at
      `docker compose up` time if the network doesn't already exist.
- [ ] Double-check `.env.production` is not tracked by git
      (`git status` should not show it — it's git-ignored).

## 6. Add the site block to the existing Caddy config

This deployment does not run its own Caddy — it adds one site block to the
Caddy instance already running on this machine for another project.

- [ ] Open the existing Caddyfile used by that other project's Caddy
      container.
- [ ] Append the site block from this repo's `deploy/wave.caddy` to the
      end of that file — do **not** replace or reorder anything already
      there, and do not add a second global `{ email ... }` options block
      (that Caddyfile already has one).
- [ ] Resolve `deploy/wave.caddy`'s `{$DOMAIN}`, `{$CF_API_TOKEN}`, and
      `{$BACKEND_PORT}` placeholders: either add those three env vars to
      the *existing* Caddy container's own environment/env file, or
      replace the placeholders in the appended block with literal values
      directly.
- [ ] Reload or restart that existing Caddy container so the new site
      block takes effect (e.g. `docker exec <existing-caddy-container>
      caddy reload --config /etc/caddy/Caddyfile`, or whatever restart
      mechanism that other project's compose setup uses).
- [ ] Watch that Caddy container's logs for the DNS-01 challenge
      completing and the certificate being obtained for the new domain.
      First issuance can take up to a minute or two.

## 7. First boot of the Wave stack

- [ ] `docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build`
      — this only brings up `postgres` and `backend`; the reverse proxy
      step above is separate and against the other project's stack.
- [ ] Watch the `backend` service logs to confirm it starts cleanly (fails
      fast and loudly if any required env var from step 5 is missing —
      see `CLAUDE.md`'s **Authentication** and **Audit Log Export**
      sections for the fail-fast checks).

## 8. Verify

- [ ] From a network outside the home LAN (e.g. mobile data), hit
      `https://<DOMAIN>/health` and confirm a `200` with a valid,
      browser-trusted certificate (not a self-signed warning).
- [ ] Confirm plain `http://<DOMAIN>/` redirects to `https://` if port 80
      was forwarded in step 4.

## 9. Ongoing

- [ ] Certificate renewal is owned entirely by the existing Caddy
      instance (its own data volume, its own Cloudflare token) — nothing
      to maintain on this repo's side, as long as that instance keeps
      running.
- [ ] If the existing Caddy container is ever recreated or rebuilt,
      re-verify: (a) it still has the `caddy-dns/cloudflare` module, (b)
      `CADDY_EXTERNAL_NETWORK` still points at a network it's attached
      to, and (c) the appended site block from step 6 survived.
- [ ] The daily `AuditLog` → Google Drive export (see `CLAUDE.md`) is a
      passive backup of audit logs only, **not** a full database backup.
      Set up a separate periodic backup of the `postgres_data` volume
      (e.g. `pg_dump` on a cron job, copied off-machine) — not currently
      part of this repo's tooling.
- [ ] Periodically confirm the dynamic DNS record (step 3) is still
      current, especially after any router firmware update or reboot.

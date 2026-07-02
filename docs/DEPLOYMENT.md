# Deployment Guide

How to host this service — from a zero-cost managed setup to a fully custom VPS.

The app needs three things at runtime:

| Dependency | Notes |
|---|---|
| **Node 20 runtime** (or the Docker image) | reads `PORT` from the environment; binds `0.0.0.0` |
| **PostgreSQL** | via Prisma; `prisma migrate deploy` runs automatically on container start |
| **Redis** | used by `RedisService` + the readiness check; set `REDIS_TLS=true` for managed providers |

> The repo ships a multi-stage [`Dockerfile`](../Dockerfile) and a [`docker-compose.yml`](../docker-compose.yml) with an opt-in `app` profile, so the same image runs locally, in CI, and in production.

---

## Environment variables (production)

| Variable | Required | Example / note |
|---|---|---|
| `NODE_ENV` | yes | `production` (JSON logs, no pretty printing) |
| `DATABASE_URL` | yes | `postgresql://user:pass@host:5432/db?sslmode=require` |
| `JWT_ACCESS_SECRET` | yes | ≥16 chars — `openssl rand -base64 48` |
| `REDIS_HOST` / `REDIS_PORT` | yes | host + port of your Redis |
| `REDIS_PASSWORD` | if set | managed Redis usually requires it |
| `REDIS_TLS` | for managed Redis | `true` for Upstash / Redis Cloud (they use `rediss://`) |
| `PORT` | usually injected | most PaaS set this; the app honors it (don't hardcode) |
| `CORS_ORIGINS` | recommended | your frontend origin, or `*` |
| `SWAGGER_ENABLED` | optional | `true` to expose `/api/docs` |
| `MAIL_TRANSPORT` | for real email | `smtp` (default `console` logs to stdout) |
| `MAIL_HOST` / `MAIL_PORT` | if smtp | e.g. `smtp.sendgrid.net` / `587`; `MAIL_SECURE=true` for port 465 |
| `MAIL_USER` / `MAIL_PASSWORD` | if smtp | SMTP credentials (provider API key, etc.) |
| `MAIL_FROM` | recommended | the sender address |
| `LOG_LEVEL` | optional | `info` (default) |
| `METRICS_ENABLED` | optional | `true` (default) |

See [`.env.example`](../.env.example) for the full list (security/2FA tunables, upload limits, etc.).

> ⚠️ **First-run tasks:** migrations run automatically; the **seed does not**. Run `npm run db:seed` once to create the admin + roles, then **change the seeded admin password** (`admin@example.com` / `Admin123!ChangeMe`).

---

## Option A — Free managed (recommended): Render

All-free, **zero infrastructure to maintain**. Best for a portfolio/demo.

### A0. One-click Blueprint (easiest)

The repo ships a [`render.yaml`](../render.yaml) Blueprint that provisions the
web service **+ Postgres + Redis** and wires `DATABASE_URL` / `REDIS_URL`
automatically (and generates a strong `JWT_ACCESS_SECRET`):

1. Render dashboard → **New → Blueprint** → select this repo → **Apply**.
2. Wait for the three resources to go live (the Docker image builds, then
   `prisma migrate deploy` runs on start).
3. Seed once: service → **Shell** → `npm run db:seed`.
4. Open `https://<svc>.onrender.com/api/docs`.

> Render's *free* Postgres is removed after ~30 days. For a **permanent** free
> DB, remove the `databases:` block from `render.yaml` (or just override the var
> in the dashboard) and set `DATABASE_URL` to a [Neon](https://neon.tech) string.
> Managed Redis is wired via `REDIS_URL` (its connection string carries the
> password; use a `rediss://` URL for TLS).

The manual, fully-explained path is below if you'd rather click through it.

### A1. Manual: Render + Neon + Render Key Value

**1. Postgres — [Neon](https://neon.tech)** (permanent free tier). Create a project, copy the **direct** connection string (not the `-pooler` one, so migrations run cleanly):
```
postgresql://USER:PASSWORD@ep-xxxx.eu-central-1.aws.neon.tech/neondb?sslmode=require
```

**2. Redis — Render Key Value.** Render dashboard → **New → Key Value** → Free plan, same region as the app. Copy its **Internal** host/port/password (internal connections are non-TLS, so leave `REDIS_TLS=false`).

**3. App — Render Web Service.** **New → Web Service** → connect this GitHub repo → Render detects the **Dockerfile** → Instance type **Free**. Set the env vars above (`DATABASE_URL`, `REDIS_*`, `JWT_ACCESS_SECRET`, `NODE_ENV=production`, …). Do **not** set `PORT` — Render injects it.

**4. Seed once** — service → **Shell** → `npm run db:seed`.

**5. Verify:**
```
https://<svc>.onrender.com/api/v1/health            → ok
https://<svc>.onrender.com/api/v1/health/readiness  → database + redis up
https://<svc>.onrender.com/api/docs                 → Swagger
https://<svc>.onrender.com/metrics                  → Prometheus text
```

> Free web services sleep after ~15 min idle → first request has a ~30–60s cold start. Fine for demos.

### Variant — Upstash Redis (works from any host)

[Upstash](https://upstash.com) has a generous serverless free tier but requires TLS. Thanks to the `REDIS_TLS` flag you can use it with no code change: set `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD` from the Upstash console and **`REDIS_TLS=true`**.

### Other free PaaS (same env vars)

| Host | Notes |
|---|---|
| **Koyeb** | Free web service from the Dockerfile; pair with Neon + Upstash (`REDIS_TLS=true`). |
| **Fly.io** | `fly launch` detects the Dockerfile; Fly Postgres + Upstash Redis. Requires a card. |
| **Railway** | Easiest one-click (Postgres + Redis plugins), but the free tier is a trial → ~$5/mo after. |

---

## Option B — Custom VPS with Docker Compose (recommended for full control)

Best when you want it **always-on** (no cold starts), a real domain, and everything on one box. You pay only for the VPS (e.g. Hetzner CX22 ~€4/mo, DigitalOcean/Vultr ~$5/mo).

**1. Provision** an Ubuntu 22.04 server and install Docker:
```bash
curl -fsSL https://get.docker.com | sh
```

**2. Get the code + configure:**
```bash
git clone https://github.com/bhaskarreddygurram/-nestjs-enterprise-starter.git app && cd app
cp .env.example .env
# edit .env: NODE_ENV=production, a strong JWT_ACCESS_SECRET, CORS_ORIGINS, etc.
```

**3. Run the whole stack** (app + Postgres + Redis) via the bundled compose profile:
```bash
docker compose --profile app up -d --build
docker compose exec app npm run db:seed     # one-time
```
The app listens on port 8000 (Postgres + Redis stay on the internal compose network).

**4. Put HTTPS in front with a reverse proxy.** Easiest is **Caddy** (automatic Let's Encrypt). `/etc/caddy/Caddyfile`:
```
api.yourdomain.com {
    reverse_proxy 127.0.0.1:8000
}
```
```bash
apt install -y caddy && systemctl reload caddy
```
That's it — Caddy fetches + renews the TLS cert automatically. (Nginx + `certbot` works too if you prefer.)

> Production hardening: bind the app port to localhost only (`ports: ['127.0.0.1:8000:8000']` in compose) so only the proxy is public, set up Postgres volume backups, and keep `.env` out of git (it already is).

---

## Option C — CloudPanel on a VPS

[CloudPanel](https://www.cloudpanel.io) is a **free, modern server control panel** (a lighter alternative to cPanel/Plesk). Note what it is and isn't:

- **It's a control panel, not a host** — you install it on your own VPS (Hetzner, DO, Vultr…). The panel is free; you still pay for the server.
- It gives a **GUI for Nginx reverse-proxy + Let's Encrypt SSL + site users + cron + firewall**, and a **Node.js site** type.
- Its built-in **database manager is MySQL/MariaDB** — it does **not** manage PostgreSQL. So for this app's Postgres you'd either `apt install postgresql` on the box yourself, or point `DATABASE_URL` at **Neon**. Redis you'd `apt install redis` (or use Upstash with `REDIS_TLS=true`).

**When to pick it:** you want a friendly GUI to manage one or several sites/domains, SSL and Nginx without editing configs by hand, and you're comfortable installing Postgres/Redis (or outsourcing them).

**Sketch:**
1. Install CloudPanel on a fresh Ubuntu/Debian VPS (their one-line installer).
2. **Sites → Add Site → Node.js**, set the app port to `8000` and your domain → CloudPanel provisions the Nginx reverse proxy + SSL + a site user.
3. As that site user: clone the repo, `cp .env.example .env` (production values), `npm ci`, `npx prisma generate`, `npx prisma migrate deploy`, `npm run build`, `npm run db:seed`.
4. Run the app under a process manager (PM2: `pm2 start dist/main.js --name api && pm2 save && pm2 startup`), listening on 8000 so CloudPanel's proxy forwards to it.
5. Install Postgres + Redis on the box (or use Neon/Upstash) and set the env accordingly.

> **Honest take:** because this project is already Dockerized, **Option B (Docker Compose + Caddy) is usually simpler** than fitting it into CloudPanel's Node-site model. Choose CloudPanel mainly if you specifically want its multi-site GUI and centralized SSL/Nginx management.

---

## Option D — Bare/native install (no Docker)

Maximum control, most manual. On Ubuntu 22.04:

```bash
# runtimes
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs
sudo apt install -y postgresql redis nginx

# database
sudo -u postgres createdb enterprise_db
# (create a role/password, then build DATABASE_URL from it)

# app
git clone https://github.com/bhaskarreddygurram/-nestjs-enterprise-starter.git app && cd app
cp .env.example .env            # set production values
npm ci
npx prisma generate
npx prisma migrate deploy
npm run build
npm run db:seed                 # one-time
```

Run it as a service with **systemd** (`/etc/systemd/system/enterprise-api.service`):
```ini
[Unit]
Description=Enterprise NestJS API
After=network.target postgresql.service redis.service

[Service]
WorkingDirectory=/home/deploy/app
EnvironmentFile=/home/deploy/app/.env
ExecStart=/usr/bin/node dist/main.js
Restart=always
User=deploy

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl enable --now enterprise-api
```
Then front it with Nginx + `certbot` (or Caddy) for TLS, reverse-proxying `:443 → 127.0.0.1:8000`. (PM2 is a fine alternative to systemd.)

---

## Logs in production

The app logs **structured JSON** (one object per line) via Pino. By default everything goes to **stdout/stderr** — the standard, recommended approach: the platform captures it for you.

**Where to read them:**
| Platform | How |
|---|---|
| Render | service → **Logs** tab (live tail + search) |
| Docker Compose (VPS) | `docker compose logs -f app` |
| systemd (native) | `journalctl -u enterprise-api -f` |
| PM2 (native) | `pm2 logs api` |

Each line includes a `reqId` (the same `x-request-id` returned to the client and used in the response envelope + audit trail), so you can trace one request across every log line it produced:
```bash
docker compose logs app | grep '"reqId":"<the-id>"'
```
Pretty-print JSON logs locally for reading: `... | npx pino-pretty`.

**Writing logs to files (a folder on disk).** Set `LOG_TO_FILE=true` (optionally `LOG_DIR`, default `./logs`). The app then writes the same JSON lines to **`<LOG_DIR>/app.log`** *in addition to* stdout.

```env
LOG_TO_FILE=true
LOG_DIR=/var/log/enterprise
```

Important caveats:
- **PaaS (Render/Koyeb/Fly):** the container filesystem is **ephemeral** — files are lost on every restart/redeploy and aren't easy to download. On these platforms, **keep `LOG_TO_FILE=false`** and use the platform's log viewer (or ship stdout to a log service). File logging is meant for **VPS/self-hosted**.
- **VPS:** point `LOG_DIR` at a real path (e.g. `/var/log/enterprise`) — with Docker, mount it as a volume (`-v /var/log/enterprise:/var/log/enterprise`) so logs survive container recreation.
- **Rotation:** the file grows unbounded; rotate it with the OS **logrotate** (recommended) — e.g. `/etc/logrotate.d/enterprise`:
  ```
  /var/log/enterprise/app.log {
      daily
      rotate 14
      compress
      missingok
      copytruncate
  }
  ```
- **Don't commit logs:** `logs` / `*.log` are already git-ignored.

> For real observability at scale, ship the JSON stdout to a log backend (Grafana Loki, ELK/OpenSearch, Datadog, Better Stack…) rather than scraping files — JSON + `reqId` makes those searchable out of the box.

## Production checklist

- [ ] `NODE_ENV=production`, a unique strong `JWT_ACCESS_SECRET`
- [ ] `DATABASE_URL` with TLS (`sslmode=require` for managed Postgres)
- [ ] `REDIS_TLS=true` for managed Redis (Upstash/Redis Cloud)
- [ ] `CORS_ORIGINS` set to your real frontend origin (not `*`)
- [ ] Migrations applied (`prisma migrate deploy` — automatic in the Docker image)
- [ ] Seeded once, then **admin password changed**
- [ ] Real SMTP wired up if you rely on password-reset emails — set `MAIL_TRANSPORT=smtp` + `MAIL_HOST`/`MAIL_PORT`/`MAIL_USER`/`MAIL_PASSWORD`/`MAIL_FROM` (works with SendGrid, Mailgun, Postmark, Brevo, Amazon SES, Gmail, …). Default `console` just logs.
- [ ] Postgres backups / persistent volume configured
- [ ] Logs: rely on the platform's stdout capture (PaaS) **or** `LOG_TO_FILE=true` + a mounted `LOG_DIR` + logrotate (VPS)
- [ ] `/metrics` reachable only by your scraper (network rule) if you consider it sensitive
- [ ] HTTPS terminated by a reverse proxy (Caddy/Nginx) or the platform

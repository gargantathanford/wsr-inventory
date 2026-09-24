# Deployment Guide

Written for whoever is standing this up on the host — expected to be a Linux server (Ubuntu/Debian
assumed below; adjust package manager commands if different) that will serve this at a subdomain of
`warpspeedracing.com`.

---

## 0. Before you start

- **DNS**: an A/AAAA record (or CNAME, if this host sits behind another proxy) for the chosen
  subdomain — e.g. `dashboard.warpspeedracing.com` — needs to point at this server. That's done
  wherever `warpspeedracing.com`'s DNS is managed (not on this server), by whoever holds that access.
  Do this first — TLS certificate issuance in step 5 will fail until DNS resolves correctly.
- **Node.js 22+** on the host. Check with `node -v`; install via [nodesource](https://github.com/nodesource/distributions)
  or your distro's package manager if missing.
- A non-root user to run the app as (referred to below as `wsr-app`). Never run this as root.

```bash
sudo useradd -r -m -d /opt/wsr-inventory -s /usr/sbin/nologin wsr-app
```

---

## 1. Get the code onto the server

Unzip the delivered package to `/opt/wsr-inventory/current` (owned by `wsr-app`):

```bash
sudo mkdir -p /opt/wsr-inventory
sudo unzip warp-speed-racing-inventory.zip -d /opt/wsr-inventory/
sudo mv /opt/wsr-inventory/wsr-inventory /opt/wsr-inventory/current
sudo chown -R wsr-app:wsr-app /opt/wsr-inventory
```

## 2. Install dependencies and build

Run as `wsr-app` (or `sudo -u wsr-app -i` first):

```bash
cd /opt/wsr-inventory/current
npm ci
```

**Generate a real session secret now** — this is required, the app will not start without it:

```bash
openssl rand -base64 48
```

Create `/opt/wsr-inventory/.env` (outside the app directory, so it survives future deploys/updates
cleanly) with:

```
SESSION_SECRET=<paste the generated value here>
NODE_ENV=production
PORT=3000
```

Now build:

```bash
cd /opt/wsr-inventory/current
export $(grep -v '^#' /opt/wsr-inventory/.env | xargs)
npm run build
```

This produces `.next/standalone/` — a self-contained copy of the app (verified during development to
correctly include the native SQLite binding). It needs two things copied into it that the build
doesn't do automatically:

```bash
cp -r .next/static .next/standalone/.next/static
mkdir -p .next/standalone/data
```

## 3. Initialize the production database

**Do this once, on a fresh install only.** This creates the real subsystem list and exactly one real
admin account — it does NOT include any of the demo data (fake teammates, fake parts, fake purchase
orders) used for local development. Running it against a database that already has users in it is a
no-op that refuses and exits — safe to attempt by accident, but don't rely on that as your workflow.

```bash
cd /opt/wsr-inventory/current
ADMIN_EMAIL="you@warpspeedracing.org" ADMIN_NAME="Your Name" npx tsx scripts/seed-production.ts
```

This prints a generated password **once**. Copy it immediately — it is not recoverable afterward
(only its hash is stored). Copy the resulting `data/wsr.db` into the standalone runtime directory:

```bash
cp data/wsr.db .next/standalone/data/wsr.db
```

## 4. Process supervision (systemd)

```bash
sudo cp deploy/wsr-inventory.service /etc/systemd/system/
```

Open `/etc/systemd/system/wsr-inventory.service` and confirm the paths match where you actually put
things (the file assumes `/opt/wsr-inventory/current/.next/standalone` and user `wsr-app` — edit if
different).

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now wsr-inventory
sudo systemctl status wsr-inventory
```

If it fails to start, check `sudo journalctl -u wsr-inventory -n 50`. The most common failure at this
stage is a missing or invalid `SESSION_SECRET` — the app deliberately refuses to boot in that case
(verified during development: it exits immediately with a clear `FATAL:` message rather than starting
in a broken state).

Confirm it's actually serving:

```bash
curl http://localhost:3000/api/health
# {"status":"ok","db":"ok","time":"..."}
```

## 5. Reverse proxy + HTTPS

Pick whichever matches what's already running on this host.

**Caddy (recommended — handles TLS automatically):**
```bash
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
# edit the hostname inside to the real subdomain first
sudo systemctl reload caddy   # or: sudo systemctl enable --now caddy
```

**nginx (if that's the existing stack):** see `deploy/nginx.conf` — it includes the certbot
command to run first, since nginx doesn't obtain certificates on its own the way Caddy does.

Once this is up, `https://dashboard.warpspeedracing.com/api/health` (using the real subdomain) should
return the same JSON as the localhost check above.

## 6. Backups

```bash
sudo cp deploy/wsr-inventory-backup.service deploy/wsr-inventory-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now wsr-inventory-backup.timer
systemctl list-timers | grep wsr-inventory
```

This backs up the database (using SQLite's online-backup API — safe to run while the app is live) and
any uploaded files, nightly at 3:15am, keeping the last 14 by default. Backups land in
`/opt/wsr-inventory/current/backups/`. **Copy these off-host periodically** (rsync to another
machine, or sync to cloud storage) — a backup that lives on the same disk as the thing it's backing up
doesn't protect against that disk failing.

To restore: stop the service, run `npx tsx scripts/restore.ts <timestamp>` (run with no argument to
list available backups), then start the service again.

## 7. First login and immediate next steps

1. Log in at the new subdomain with the admin email/password from step 3.
2. **Change that password immediately** (Settings → User Management), or create your real personal
   account there and deactivate the initial one.
3. Create accounts for the rest of the team, assign Team Leader roles and teams as appropriate.
4. Read `ARCHITECTURE_REVIEW.md` for the full security assessment — what's protected, what isn't, and
   why — before treating this as "done."

## Alternative: Docker

If Red Ridge Digital's infrastructure is container-based, `Dockerfile` and `docker-compose.yml` are
included as an alternative to steps 1–4 above (steps 5–7 — reverse proxy/TLS and backups — are
unchanged either way; the container replaces the systemd-managed Node process, not the whole stack).

```bash
cp .env.example .env   # set a real SESSION_SECRET — same rule as above, still enforced at boot
ADMIN_EMAIL="you@warpspeedracing.org" ADMIN_NAME="Your Name" docker compose run --rm seed
docker compose up -d app
curl http://localhost:3000/api/health
```

**Important caveat**: the Dockerfile follows Next.js's standard `output: standalone` container pattern
and was built carefully — multi-stage build, native `better-sqlite3` compilation handled explicitly,
a non-root user, a healthcheck — but **Docker itself was not available in the environment this was
built in, so `docker build`/`docker run` could not actually be executed and verified** the way every
other claim in this repo was (by running it and checking). What *was* verified from the same
environment: a clean `npm ci` compiles `better-sqlite3`'s native binding successfully, and `next build`
with `output: standalone` correctly includes that compiled binding in the output the Dockerfile copies
into the final image. That's a meaningfully weaker claim than "this container has been run" — treat the
first `docker compose up` as the actual first test, and if `better-sqlite3` fails to load inside the
container, it's almost always a native-module/platform mismatch (e.g. building on one CPU
architecture and running on another) — rebuild directly on the target host/architecture rather than
copying an image built elsewhere.

## 8. Updating the app later

```bash
cd /opt/wsr-inventory/current
git pull   # or however the new code arrives
npm ci
npm run build
cp -r .next/static .next/standalone/.next/static
sudo systemctl restart wsr-inventory
```

The database and uploads live in `data/` inside the standalone directory and are untouched by a
rebuild — back up first anyway (`npx tsx scripts/backup.ts`) before any update that changes
`lib/schema.sql`.

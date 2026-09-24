# Running This in Docker

Everything needed to stand up the Warp Speed Racing dashboard as a container. Written for whoever
receives this package — assumes Docker and Docker Compose v2 are installed, nothing else.

---

## Read this first

**The package contains no database and no accounts.** `data/` is empty by design. Step 3 below
creates the database with the 20 real FSAE subsystems and exactly one admin account. Every other
record — people, parts, tools, tasks, purchase orders — gets created through the app's UI by the
team. There is no sample/mock data anywhere in what you were sent.

**Docker was not available in the environment this was authored in, so `docker build` and
`docker run` could not be executed and verified here.** Everything else in this package was verified
by running it (see `ARCHITECTURE_REVIEW.md`); the container layer is the one part that hasn't been.
What *was* verified: `npm ci` compiles `better-sqlite3`'s native addon successfully, `next build`
with `output: standalone` includes that compiled addon in exactly the directory the Dockerfile
copies, and the resulting server boots, serves, authenticates, and creates accounts correctly when
run directly with `node server.js` — which is precisely the command the container runs. Treat your
first `docker compose build` as the real first test. See "If the build fails" at the bottom.

---

## 1. Set the session secret

```bash
cp .env.example .env
openssl rand -base64 48       # copy the output
```

Edit `.env` and set `SESSION_SECRET` to that value.

This is not optional and not a formality — the app **refuses to start** in production if this is
unset, still the placeholder value from `.env.example`, or shorter than 32 characters. That check is
in `instrumentation.ts` and was verified to actually exit the process (code 1, port never bound),
not just log a warning. If the container exits immediately on first run, this is almost always why —
check `docker compose logs app` for a line beginning `FATAL:`.

## 2. Build the image

```bash
docker compose build
```

Multi-stage: a `deps` stage installs dependencies and compiles the native SQLite module (needs
`python3`/`make`/`g++`, installed in that stage only), a `builder` stage runs `next build`, and the
final `runner` stage carries only the standalone output, running as a non-root user (`wsrapp`, uid
1001). Build tools don't ship in the final image.

## 3. Create the database — first run only

**If this has ever been run on this machine before**, wipe the old containers and data volume
first so you start from a genuinely empty database. This permanently deletes the old database
and uploads — only do it before go-live:

```bash
docker compose down -v --remove-orphans     # -v deletes the wsr-data volume (./backups on the host is untouched)
docker volume ls | grep wsr                 # should print nothing
```

```bash
ADMIN_EMAIL="you@warpspeedracing.org" ADMIN_NAME="Your Name" docker compose run --rm seed
```

This prints a generated admin password **once**. Copy it immediately — only its bcrypt hash is
stored, so it cannot be recovered afterward. (Set `ADMIN_PASSWORD=...` alongside the other two vars
if you'd rather choose it yourself.)

The `seed` service intentionally builds from the `builder` stage rather than the slim runtime image,
because the runtime image has no devDependencies and therefore no `tsx` to execute the TypeScript
seed script. It writes into the same named volume the app uses.

Running this twice is safe — the script refuses to proceed if the database already has users, rather
than duplicating or overwriting anything.

## 4. Start it

```bash
docker compose up -d app
docker compose logs -f app        # watch for "Ready" and the boot validation line
curl http://localhost:3000/api/health
# expected: {"status":"ok","db":"ok","time":"..."}
```

Log in at http://localhost:3000 with the admin email and the password from step 3.

## 5. Create the rest of the team

Settings → User Management → **+ New user**. Roles available: Admin, Chief Engineer, Team Leader
(which reveals a "Team Led" dropdown for assigning their subsystem), and Team Member.

This flow was verified end-to-end against a freshly-seeded empty database: all three non-admin roles
created successfully, the Team Leader's subsystem assignment persisted correctly, and all three new
accounts were confirmed able to log in. Also verified that non-admins receive `403 Admin only.` when
attempting to create or list users, that duplicate emails are rejected with `409`, and that passwords
under 6 characters are rejected.

## 6. TLS / public hostname

The container serves plain HTTP on port 3000 and is meant to sit behind a reverse proxy that
terminates TLS — `deploy/Caddyfile` (automatic Let's Encrypt) or `deploy/nginx.conf` (certbot).
Point it at `localhost:3000` and set the hostname to the intended subdomain.

Do not expose port 3000 directly to the internet: the session cookie is marked `secure` in
production, which means browsers won't send it over plain HTTP, so login will silently fail.

## 7. Backups

The named volume `wsr-data` holds the database and all uploaded files. Nothing else in the container
is stateful — the image can be rebuilt and replaced freely.

Backups go to `./backups` on the host (bind-mounted at `/app/backups`, git- and docker-ignored).
Each run writes `wsr-<timestamp>.db` (plus `uploads-<timestamp>.tar.gz` if there are uploads) and
keeps the newest `BACKUP_RETAIN_COUNT` sets (default 14). Files are created by uid 1001.

```bash
# take a backup (safe while the app is live — SQLite online-backup API, integrity-checked)
docker compose run --rm backup

# list available backups, then restore one — the app MUST be stopped first
docker compose stop app
docker compose run --rm restore                 # lists timestamps
docker compose run --rm restore <timestamp>
docker compose start app
```

Restore refuses a backup that fails `PRAGMA integrity_check`, and saves the current database to
`./backups/pre-restore-<timestamp>.db` before replacing it (never rotated — delete by hand).

For a scheduled job, a host cron entry running `docker compose run --rm backup` nightly (from this
directory) is the simplest approach; `deploy/wsr-inventory-backup.timer` is the equivalent for the
non-Docker systemd deployment. Copy `./backups` off-host too — a backup on the same disk as the thing
it backs up protects against very little.

Older setups wrote backups into a `wsr-backups` named volume. To pull those into `./backups` once:

```bash
docker run --rm -v wsr-inventory_wsr-backups:/b -v "$PWD/backups":/out alpine \
  sh -c 'cp -a /b/. /out/ && chown -R 1001:1001 /out'
```

(The volume name assumes Compose's default project-name prefix — check `docker volume ls`.)

---


## Volume permissions — handled automatically

Named Docker volumes are created root-owned. On Docker Desktop for Mac the VM's
file-sharing layer does not give a non-root container user write access to them, which
surfaces as SQLite `attempt to write a readonly database` and blocks the seed entirely.

`docker-entrypoint.sh` handles this: every container starts as root, fixes ownership of
`/app/data` and `/app/backups`, then drops to uid 1001 via `gosu` before running the app.
The app itself never runs as root. The same image and compose file therefore work
unchanged on both Docker Desktop and a Linux host — there is no Mac-specific config to
remember to undo before deploying.

The chown is skipped when ownership is already correct, so it costs nothing on restart.

## If the build fails

- **`better-sqlite3` fails to compile** — the `deps` stage installs `python3`, `make`, and `g++` for
  exactly this. If it still fails, check whether your Docker daemon has enough memory allocated
  (native compilation is the most memory-hungry step in the whole build).
- **`better-sqlite3` compiles but throws at runtime** (`invalid ELF header`, `wrong ELF class`, or a
  `NODE_MODULE_VERSION` mismatch) — this is a native-addon architecture mismatch, e.g. an image built
  on an arm64 Mac being run on an amd64 server. **Build the image on the same architecture that will
  run it**, or use `docker buildx --platform linux/amd64`. Don't copy a prebuilt image across
  architectures.
- **Container exits immediately with no obvious error** — check `docker compose logs app` for
  `FATAL: SESSION_SECRET ...`. See step 1.
- **App starts but every page redirects to login and login never sticks** — you're on plain HTTP with
  `NODE_ENV=production`. The secure-cookie behavior described in step 6 is the cause. Put it behind
  the reverse proxy with real TLS.

## Non-Docker alternative

`DEPLOYMENT.md` covers the same deployment via systemd + Node directly on the host, if containers
turn out not to be the right fit. Same app, same data layout, same reverse-proxy step.

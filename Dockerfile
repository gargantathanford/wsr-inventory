# syntax=docker/dockerfile:1

# ---------- deps: install dependencies, compile native modules (better-sqlite3) ----------
FROM node:22-slim AS deps
WORKDIR /app

# better-sqlite3 compiles a native addon on install — these are the build tools it needs.
# Using node:22-slim (Debian/glibc) rather than an alpine/musl base specifically to avoid
# native-module ABI mismatches that alpine sometimes introduces for packages like this one.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci

# ---------- builder: compile the Next.js app ----------
FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# The same uid/gid the runtime stage uses. The `seed` service in docker-compose.yml
# builds from THIS stage (it needs devDependencies — tsx — which the slim runtime
# image doesn't carry), and it writes the database into the shared data volume. If it
# wrote as root, the runtime container (which runs as uid 1001) would then be unable to
# write to its own database — SQLite in WAL mode needs write access to both the file and
# its directory. Creating the user here and pre-owning data/ keeps the volume's
# ownership correct regardless of which service mounts it first.
RUN groupadd --system --gid 1001 wsrapp \
    && useradd --system --uid 1001 --gid wsrapp wsrapp \
    && mkdir -p /app/data \
    && chown -R wsrapp:wsrapp /app/data

# No SESSION_SECRET is needed here — verified during development that `next build`
# only compiles the app; instrumentation.ts's secret check runs at server *start*,
# not at build time. The real secret is supplied as a runtime env var (see
# docker-compose.yml / `docker run -e SESSION_SECRET=...`), never baked into the image.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# seed/maint run from this stage and mount the same data volume, so they need the
# identical ownership-fixing entrypoint the runner stage uses.
RUN apt-get update && apt-get install -y --no-install-recommends gosu \
    && rm -rf /var/lib/apt/lists/*
COPY --chmod=0755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# ---------- runner: minimal image that actually ships ----------
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN groupadd --system --gid 1001 wsrapp \
    && useradd --system --uid 1001 --gid wsrapp wsrapp

# Standalone output already contains node_modules pruned to production-only deps
# (including the compiled better-sqlite3 addon) plus a minimal server.js — see
# next.config.mjs's `output: "standalone"`.
COPY --from=builder --chown=wsrapp:wsrapp /app/.next/standalone ./
COPY --from=builder --chown=wsrapp:wsrapp /app/.next/static ./.next/static
# public/ is NOT part of the standalone bundle — verified: .next/standalone
# contains only server.js, package.json, node_modules, lib and data. Next
# serves /wsr-logo.png straight off disk from public/, so without this COPY
# every brand asset 404s in the image while working perfectly under `next dev`
# from the repo. Same reason .next/static is copied on the line above.
COPY --from=builder --chown=wsrapp:wsrapp /app/public ./public
# Fail the BUILD rather than ship a container that 404s its own logo. Cheap,
# and the failure names the file instead of showing up as a broken image on the
# login page, which is where this one was found.
RUN test -f ./public/wsr-logo.png \
    && test -f ./public/icon.png \
    && test -f ./public/apple-icon.png \
    || (echo "FATAL: brand assets missing from public/ — the login page will render a broken image" && exit 1)
# lib/db.ts reads this at runtime via path.join(process.cwd(), "lib", "schema.sql") —
# a filesystem read, not an import, so copy it explicitly rather than relying on
# Next's output file tracing to pick it up.
COPY --from=builder --chown=wsrapp:wsrapp /app/lib/schema.sql ./lib/schema.sql

# data/ holds wsr.db and uploads/ — mount a volume here (see docker-compose.yml) so
# the database and uploaded files survive container restarts/rebuilds.
RUN mkdir -p /app/data /app/backups && chown -R wsrapp:wsrapp /app/data /app/backups

# gosu: minimal, well-established setuid helper for dropping privileges cleanly
# in an entrypoint. Needed because the container must start as root to fix
# volume ownership, then run the app unprivileged.
RUN apt-get update && apt-get install -y --no-install-recommends gosu \
    && rm -rf /var/lib/apt/lists/*

COPY --chmod=0755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]

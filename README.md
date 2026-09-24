# Warp Speed Racing — Powertrain Inventory & Procurement System

Full-stack inventory, procurement, tools, and technical-documentation system for an FSAE team.

## Deploying this for real

**This is now packaged for real deployment**, not just local dev. See
[`DEPLOYMENT.md`](./DEPLOYMENT.md) for the full step-by-step (systemd, Caddy/nginx + TLS, backups,
production database setup) and [`ARCHITECTURE_REVIEW.md`](./ARCHITECTURE_REVIEW.md) for the security
assessment behind it — what's been verified, what's genuinely still open, and why.

## Iteration 2

Purchase Requests/Orders, expanded task management (priority/subteams/dependencies/team-scoped
assignment), a Calendar with the same completion-accountability pattern as Tasks, a lightweight
floating messaging widget, tool creation from the Tools page, the Ergonomics subsystem, a subsystem
navigation/breadcrumb fix, and a security-hardening pass (rate limiting, CSRF origin checks, upload
allowlisting, security headers, expanded audit logging, boot-time secret validation, real backups,
TLS/reverse-proxy configs, process supervision, and a dependency-vulnerability review).

## Stack
- Next.js 14 (App Router, TypeScript)
- SQLite via `better-sqlite3` (file-based, zero external services — no cloud DB to provision)
- Auth: signed JWT session cookie (`jose` + `bcryptjs`), custom RBAC (Admin / Team Leader / Team Member)
- Tailwind CSS, hand-built components (no external UI kit)
- Recharts for the status breakdown chart

Supabase/Postgres was the stack requested in the brief. This build uses SQLite plus a custom auth
layer instead, because the environment this was built in has no network access to provision a live
Supabase project or download Prisma's binary engine. The schema, RBAC model, and API surface are
structured so migrating to Postgres/Supabase later is a swap of `lib/db.ts` and `lib/schema.sql`,
not a rewrite.

## Setup

**This package ships with no database and no accounts.** There is no mock or demo data anywhere
in it. The database is created on first setup with the 20 FSAE subsystems and exactly **one** admin
account; every user, part, tool, and task is created through the UI.

See [`DOCKER.md`](./DOCKER.md) for the complete walkthrough. Short version:

```bash
cp .env.example .env          # then set a real SESSION_SECRET
docker compose build
ADMIN_EMAIL="you@warpspeedracing.org" ADMIN_NAME="Your Name" docker compose run --rm seed
docker compose up -d app
```

The seed prints the admin password **once** — copy it immediately.

## Section renames (applied consistently: nav, headers, buttons, notifications, DB tables)
- Procurement → **Shopping List** (`/shopping-list`, `parts.purchase_status` / `parts.approval_status` / `parts.requested_by`)
- Instructions → **Procedures** (`procedures` / `procedure_steps` tables, `/procedures`)

## What's implemented (this pass)
- **User Management**: full edit (name, email is immutable by design — change via delete/recreate,
  phone number, role including new **Chief Engineer** role, password reset, activate/deactivate).
  "Team Lead" now shows as `Role: Team Leader · Team: Suspension`, driven by a **Team Led** dropdown
  that appears when Team Leader is selected.
- **Parts List**: Category field removed from the UI (kept in the schema for internal use, per the brief).
- **Procedures**: structured `+ Add Procedure` form (title, category, description, purpose, applicable
  team(s), required documentation, supporting links, safety warning, revision, ordered steps) — not a
  free-text box. Draft → Pending Approval → Approved/Rejected workflow gated to the procedure's team
  lead / Chief Engineer / Admin.
- **Shopping List**: Requested By, Responsible Team, Approval Status (Pending/Approved/Rejected), and
  Purchase Status (Needed/Researching/Awaiting Approval/Approved/Ordered/Received/No Longer Needed)
  tracked as first-class fields, editable inline from the list.
- **Task completion accountability**: a task cannot go straight to Completed. "Mark complete" opens a
  form requiring a real written summary (20+ characters enforced server-side, not just client-side) and
  accepts optional images/files and links. This flips the task to **Submitted for Review**.
- **Task completion notifications**: submitting for review notifies Admins, Chief Engineer, and the
  relevant Team Lead(s) — computed live and scoped per recipient (a Team Leader only sees their own
  teams' reviews; Admin/Chief Engineer see everything). Returning a task notifies the original assignee
  directly with the reason.
- **Approval workflow**: Open → In Progress → Submitted for Review → Completed. Leadership can Approve
  (→ Completed, recorded with reviewer + timestamp) or Return for additional work (→ back to In
  Progress with a visible reason banner, re-notifying the assignee).
- **Teams page**: reorganized around each team's Lead first, with a collapsible "N Team Members"
  section per team (name, email, phone, live presence, active task count).
- **Live online counter**: top bar shows "● N members online", polling every 20s with no page refresh.
  Presence (online/away/offline) is derived from `users.last_active`, which is touched on every
  authenticated request — visible per-user in Teams and User Management.
- **Chief Engineer role**: full edit access across all engineering teams/parts/tools/procedures/tasks
  and review authority everywhere, but — like Team Leaders — no access to User Management or System
  Settings (Admin only), matching the requested permission table.

## Known simplification: live presence is polling, not push
"Real-time" here means a 20-second client poll against `users.last_active`, not a WebSocket/SSE
connection — this environment has no persistent-connection infrastructure set up. Good enough for a
handful of team members glancing at a dashboard; would need a real push channel (e.g. Supabase
Realtime, Pusher, or a WS server) to feel instant at larger scale.

## Base layer (from the previous build pass, still intact)
- 19 default FSAE subsystems, dynamically addable via the `subsystems` table
- Parts database: full CRUD, ownership tracking, multi-supplier options, dependencies, cost/lead-time/procurement fields
- Automatic procurement priority scoring (`lib/scoring.ts`): importance × lead-time factor × dependency factor
- Dashboard: project readiness %, KPI cards, status breakdown chart, subsystems furthest behind,
  top procurement risks, blocking-component detection, missing-tool warnings
- Procurement dashboard: sortable, high-lead-time risk flagging
- Inventory visualization by subsystem
- Tool database with availability status and part/subsystem associations
- Documentation and procedures databases, with **real file uploads** (PDF, images, CAD,
  etc. saved to `data/uploads` and served through `/api/files/[id]`) alongside link-based docs
- Global search across parts, tools, docs, procedures, subsystems
- Tasks with status tracking
- **BOM export** to CSV and native `.xlsx` (via SheetJS), respecting active subsystem/status/importance
  filters, plus a print view — `/parts` → Export CSV / Export Excel / Print
- **Dependency graph visualization** — SVG requires/blocks graph per part (`/parts/[id]` and the
  dedicated `/dependencies` overview), backed by an editable `part_dependencies` graph (add/remove
  edges from the UI, RBAC-gated to subsystem leaders/admin)
- **In-app notification delivery** — a bell in the top bar (live unread/critical count) plus a full
  `/notifications` page, computed live from part importance, lead time, inventory gaps, and tool
  availability. No configuration needed; there's nothing stored to go stale.
- **Admin user management** (`/settings/users`) — create accounts, change roles, activate/deactivate,
  reset passwords, and assign/remove subsystem leadership, all enforced server-side (an admin can't
  demote, deactivate, or delete their own account; deactivated accounts are locked out immediately,
  not just at next login)

## What's still stubbed
- Outbound notification delivery (email/SMS/Slack) — the in-app center covers "delivery" without
  needing credentials this environment doesn't have; wiring a provider is a matter of calling
  `generateNotifications()` from a cron/webhook and piping it to that provider.
- Visual dependency graph currently lays out in two columns (requires / blocks) per part rather than
  a single force-directed whole-vehicle graph — accurate and useful, but not a single all-parts canvas.

## Project structure
- `lib/schema.sql` — full relational schema
- `lib/db.ts` — SQLite connection singleton
- `lib/auth.ts` — session signing/verification, RBAC helpers
- `lib/scoring.ts` — procurement priority formula, ownership %, status labels
- `lib/queries.ts` — all data-access functions (stats, readiness, search, etc.)
- `scripts/seed-production.ts` — creates a fresh production database (subsystems + one admin)
- `scripts/backup.ts` / `scripts/restore.ts` — online SQLite backup and restore
- `app/(app)/*` — authenticated pages (dashboard, subsystems, parts, inventory, procurement, tools, documentation, instructions, tasks, team, settings)
- `app/api/*` — REST endpoints backing the above

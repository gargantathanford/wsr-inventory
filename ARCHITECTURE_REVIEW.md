# Iteration 2 — Technical Summary

Written as the closing deliverable requested for this iteration: what was built, what changed
architecturally, an honest security assessment, realistic hosting/resource guidance, and what's
deliberately deferred.

---

## 1. Implemented Features

**Tools**
- "+ Add Tool" modal on `/tools`, full field set (serial/asset number, description, storage area,
  responsible team, condition, cost, replacement cost, date acquired). New statuses: In Use, Under
  Maintenance, Retired.

**Shopping List → Purchasing pipeline**
- Full lifecycle built as real structured records, not text fields: **Purchase Requests**
  (`/purchase-requests`) with a ticket-style detail page — status history, comments, "request info",
  approve/reject/cancel, convert-to-PO — and **Purchase Orders** (`/purchase-orders`) with multi-line
  items, auto-computed totals, a receiving workflow that logs condition/location per receipt and
  auto-rolls the PO to Partially Received / Received, and atomically-generated `WSR-PO-YYYY-####`
  numbers enforced unique by a database constraint.

**Task management expansion**
- Priority, due time, estimated hours, subteams (`Suspension → Design/Manufacturing/Testing/...`),
  linked procedure, and task dependencies ("Blocked By"), with blocked tasks visibly flagged.
- Assignment now distinguishes **Assigned To** (person) from **Responsible Team/Subsystem** (scope) —
  a task can be assigned to a specific person or opened to an entire team/subsystem.
- New-task notifications: the assignee (or every member of the assigned team/subsystem) sees "New task
  assigned" the next time they check notifications.

**Calendar**
- `/calendar`: deadlines/milestones/reviews/competition/manufacturing/testing/meetings, with
  responsible user/team, priority, and configurable reminder intervals (30/14/7/3/1 day, or day-of).
- Actionable deadlines follow the same accountability pattern as tasks: Upcoming → In Progress →
  Submitted for Review → Completed, and completion requires a real written summary (20+ characters,
  enforced server-side) plus optional images/files — clicking "Complete" with nothing written is not
  possible.
- Notification scope is configurable per event: Everyone, Team, Subsystem, Assigned User, Team Leads,
  or Admins.

**Subsystem navigation fix**
- Added a `Breadcrumbs` component (every level clickable) plus an explicit "← All subsystems" button
  on the subsystem detail page — this was the literal page with no way back, now fixed with two
  independent methods per the brief's requirement of "at least one."

**Messaging (prototype, deliberately minimal)**
- Floating widget, bottom-right, minimizable, matches the dashboard's visual language. Team channels
  (one per subsystem) and direct messages, unread badge, timestamps, sender name. No channels beyond
  team/DM, no reactions, no file sharing, no voice/video — exactly the scope the brief asked for and
  no further.
- Polling-based: 15s for the unread badge, 5s for an open conversation, and only while the widget is
  open. This was a deliberate architecture choice — see §6.

**Ergonomics subsystem**
- Added to the seeded subsystem list. Because every part of this app already reads subsystems from
  the database rather than a hardcoded list (parts, tools, tasks, procedures, shopping list, purchase
  requests/orders, calendar, notifications, team page, nav, dependency graph — all of it), this was a
  one-line addition, not a search-and-patch job. That's the payoff of not hardcoding it the first time.

**Security hardening** (see §3 for full assessment)
- Rate limiting on login (10 attempts / 5 min / IP), origin-checked CSRF backstop on all mutating API
  calls, security response headers, an allowlisted file-upload extension check (rejects `.exe` and
  everything else not explicitly permitted), and a fuller audit log with its own admin-only viewer.

**Audit logging**
- Expanded to cover PR/PO creation and decisions, receiving, calendar events, task submit/approve/
  return, tool deletion, login events (IP recorded) — viewable and filterable at `/settings/audit-log`,
  admin-only, no update/delete route exists for the log itself.

---

## 2. Architecture Changes

**Database** — `lib/schema.sql` grew from 16 tables to 30: `subteams`, `task_assignees`,
`task_dependencies`, `purchase_requests` + `purchase_request_events`, `purchase_orders` +
`po_line_items` + `po_receipts`, `calendar_events` + `calendar_reminder_log`, `messages` +
`message_reads`. Every new table uses real foreign keys back to `users`/`subsystems`/`parts`, and
`purchase_orders.po_number` / `purchase_requests.request_number` carry `UNIQUE` constraints as a
database-level backstop, not just application logic.

**Backend** — new query modules (`lib/numbering.ts`, `lib/messaging.ts`, `lib/presence.ts` already
existed and now backs both online-status and messaging), a `lib/rateLimit.ts` in-memory limiter, and
roughly 20 new API route files following the same pattern as the rest of the app: zod-validated input,
role/subsystem-scoped authorization via `canReviewSubsystem`/`canEditSubsystem`, and an activity-log
write on every state-changing action.

**Frontend** — no changes to the design system; new pages/components (Calendar, Purchase
Requests/Orders, Tool creation, Breadcrumbs, Messaging widget) all reuse the existing panel/badge/
button vocabulary rather than introducing a second visual language.

**Auth** — unchanged in shape (JWT session cookie, bcrypt), but the login route now rate-limits and
audit-logs, and the middleware now adds security headers and a same-origin check on every mutating API
request.

**Hosting readiness** — no change in kind (still a single Node process + SQLite file), but see §5 for
what that actually means in practice now that the feature set is larger.

---

## 3. Security Assessment

### Production-readiness pass (this update)

The prior version of this document listed four items as launch blockers before this went to a real
host. All four are now closed, and — per how this whole project has been built — closed means
verified against a running instance, not asserted from reading the code:

- **`SESSION_SECRET` can no longer silently default.** `instrumentation.ts` runs once at server boot
  and refuses to start in production if the secret is missing, is the known publicly-visible dev
  placeholder, or is under 32 characters — verified all three failure cases actually exit the process
  (code 1, no port bound, clear `FATAL:` message) and that a real secret boots cleanly. This needed a
  fix mid-verification: the first version logged the error but kept the HTTP server listening and
  500-ing every request forever, which is a worse operational signal than a clean crash — found by
  actually curling it, not by reading the code back.
- **Real backups exist.** `scripts/backup.ts` uses SQLite's official online-backup API (safe against a
  live, WAL-mode database — not a raw file copy, which can capture a torn snapshot mid-write), produces
  one self-contained file per run, and rotates old ones. `scripts/restore.ts` restores by timestamp
  with a safety copy of whatever's currently live before overwriting it. Verified: ran a backup, opened
  the result independently and got correct row counts back, ran a full restore, confirmed the data was
  intact. Also caught a real bug here during verification — the first version left orphaned
  `-wal`/`-shm` sidecar files behind on rotation; fixed by checkpointing into a single file per backup.
- **TLS termination and a reverse proxy are now provided** (`deploy/Caddyfile`, `deploy/nginx.conf`),
  for the subdomain this will actually be hosted at.
- **Process supervision** (`deploy/wsr-inventory.service`) restarts the app on crash and starts it on
  boot, instead of it silently staying down until someone notices.
- **The demo data problem** — worth stating plainly since it's the kind of thing that's easy to ship
  by accident: the original seed script fills the app with realistic-*looking* but entirely fictional
  people, parts, and purchase orders, meant for local development and demos. Deploying that to Red
  Ridge Digital would mean the real team's first login sees a fake roster. `scripts/seed-production.ts`
  is the actual production path — schema plus the real subsystem list plus exactly one real admin
  account, and it refuses to run a second time against a database that already has users. Verified: ran
  it, then logged in through the real built app with the account it created.

### Dependency vulnerabilities (`npm audit`) — closed, mitigated, or scoped, item by item

Running `npm audit` for the first time surfaced findings. Rather than either ignore them or make a
change that isn't actually verified, each was investigated individually:

- **`xlsx` (SheetJS) — high, no fix published to npm.** The two advisories (prototype pollution, ReDoS)
  are both triggered by *parsing* a malicious spreadsheet. Grepped the codebase to confirm: this app
  only ever calls `json_to_sheet`, `book_new`, `write`, and `sheet_to_csv` — generating a file from our
  own trusted database rows for the BOM export. There is no `XLSX.read`/`readFile` call anywhere, so the
  vulnerable code path (parsing untrusted input) is not reachable. Considered switching libraries
  (`exceljs`) instead of accepting this — tested it, and it net-worsened the audit (introduced its own
  moderate `uuid` finding, went from 4 vulnerabilities to 7), so reverted. Accepted as a scoped,
  contained risk rather than "fixed" — flagged here for whoever touches this code next: if a future
  change ever adds spreadsheet *upload/import*, this analysis no longer holds and needs revisiting.
- **`next` — critical, per `npm audit`.** Investigated rather than either upgrading blindly or
  dismissing it. The advisories rolled into this one critical rating are only actually fixed in the
  Next.js 15.x line (`<15.0.8` through `<15.5.24` depending on the specific CVE) — there is no patched
  14.x release, so a same-minor-line bump can't close this, and a major-version migration is not
  something to do casually under a deployment deadline without dedicated regression testing across all
  46 routes. Instead, each advisory was checked against what this app actually does:
  - *Server Actions DoS/SSRF (several advisories):* not applicable — grepped for `"use server"`, there
    are none. This app uses only traditional Route Handlers; no Server Action endpoints exist in the
    build.
  - *Middleware/i18n bypass:* not applicable — no `i18n` config exists in `next.config.mjs`.
  - *Rewrites SSRF / request smuggling:* not applicable — no `rewrites()` defined.
  - *WebSocket upgrade SSRF:* not applicable — messaging is deliberately HTTP polling (§6), no
    WebSocket upgrade handling exists.
  - *RSC/fetch cache poisoning (several advisories):* significantly reduced exposure — nearly every
    route in this app reads `cookies()` via `getSession()`, which forces dynamic rendering; confirmed
    in the build output, almost every route is `ƒ` (server-rendered per request), not `○` (statically
    cached) — there's very little of Next's route/fetch cache layer in play for an attacker to poison.
  - *Image Optimization API (moderate DoS, critical unauthenticated RCE via AVIF):* this was the one
    finding that couldn't be ruled out by "we don't use this feature" alone, since the underlying route
    exists in every Next.js server regardless of whether `next/image` appears in the app's own code.
    Closed with two verified layers: `images: { unoptimized: true }` in `next.config.mjs` — confirmed by
    directly curling `/_next/image` against the built app, it now returns 404 at the application layer,
    not just "unused" — plus a matching block rule in both `deploy/Caddyfile` and `deploy/nginx.conf` as
    defense in depth at the reverse proxy, in case that config is ever removed without someone noticing.
  - What's left after that accounting is the residual "keep this dependency reasonably current" risk of
    running Next 14.2.35 rather than the latest major version — a real, ongoing maintenance item, not
    something this pass can close outright, and noted as such rather than papered over.
- **`nanoid` — high.** The advisories require *custom* generators or negative/zero/non-integer size
  arguments. Grepped every call site in this codebase: all of them are the plain default
  `nanoid(12)` with a positive integer literal. Not reachable.
- **`postcss`, `tsx`, `esbuild` — high/moderate, build-time and dev-only.** Confirmed none of these
  three packages exist in the actual shipped artifact (`.next/standalone/node_modules`) — they're used
  only by the Tailwind build pipeline and by `tsx` for running `scripts/*.ts` locally, never by the
  running production server. `npm audit`'s default scan includes devDependencies; `npm audit --omit=dev`
  gives the picture that actually matters for what's deployed.

**Bottom line on dependencies**: after this pass, every `npm audit` finding is either closed with a
verified fix, or has a specific, checked reason it doesn't apply to how this app is built and
configured — not a blanket "probably fine." The one open item worth tracking is Next.js's major-version
currency; that's a deliberate, planned upgrade for later, not an oversight.

### Carried over from the prior pass (unchanged, still accurate)

- Passwords hashed with bcrypt (cost 10), never returned in any API response.
- All database access goes through parameterized prepared statements — no string-concatenated SQL
  anywhere, so standard SQL injection is not applicable to this app as written.
- Session cookie is `httpOnly`, `SameSite=lax`, and `secure` when `NODE_ENV=production`.
- Every role/subsystem authorization boundary is enforced server-side, not just hidden in the UI.
- Login rate limiting (10 attempts / 5 min / IP), a same-origin CSRF backstop on mutating requests, an
  upload extension allowlist, a generic login error that doesn't leak which emails have accounts, and
  security response headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`,
  `Permissions-Policy`) — all previously verified and unchanged by this pass.

### Still open — genuinely, not just for completeness

- **No independent penetration test.** Every claim above was verified by deliberately trying to break
  one specific thing and confirming it failed correctly — that is a meaningfully different, weaker
  claim than an outside security review, and should not be conflated with one before this handles real
  financial data at any real scale.
- **Rate limiting is per-process, in-memory.** Resets on restart, doesn't survive multiple app
  instances, and doesn't distinguish users behind a shared IP from each other. Fine for this team's
  scale; not a WAF.
- **No encryption at rest** for the SQLite file or uploaded documents. Defensible for a university
  team's parts/budget data today; would not be for personal financial or health information.
- **Next.js major-version currency**, as covered above — a planned future upgrade, tracked rather than
  silently deferred.

### Closed in this follow-up pass

- **File upload content-sniffing.** Uploads were previously validated by extension only. Added
  magic-byte signature verification for every binary format in the allowlist (PDF, PNG/JPEG/GIF/WEBP,
  ZIP-based Office formats, legacy OLE Office formats) — the actual file header now has to match what
  the extension claims, or the upload is rejected. Verified: a `.txt` file's content renamed to a
  `.pdf` extension was rejected with a clear reason; a real PDF was accepted.
- **Stored XSS via SVG upload — found and fixed, not just theoretical.** SVG is XML and can carry a
  `<script>` tag; serving an uploaded SVG back with `Content-Disposition: inline` means that script
  executes in the app's own origin if a browser renders it directly — a genuine stored-XSS path that
  magic-byte checking alone doesn't touch, since a malicious SVG is still a syntactically valid SVG.
  Fixed at the serving layer (`app/api/files/[id]/route.ts`): SVGs are now always sent with
  `Content-Disposition: attachment` and `Content-Type: application/octet-stream`, forcing a download
  instead of inline rendering, plus `X-Content-Type-Options: nosniff` on every file response as a
  second layer. Verified end-to-end with an actual malicious payload
  (`<svg><script>alert('xss')</script></svg>`) — confirmed the response forces download rather than
  inline render, while the file's bytes are still served correctly and intact. Also verified no
  regression: a real PNG still serves `inline` with its correct image content-type.

**Local hosting (a laptop/desktop on the team's network)** — works today with zero changes. This is
the lowest-friction option and what the app already assumes.

## 4. Infrastructure Assessment

**Raspberry Pi**

| Component | Pi 4 (4GB) | Pi 5 (8GB) |
|---|---|---|
| Next.js app + SQLite | ✅ Comfortable for <20 concurrent users | ✅ Comfortable for 20–40 |
| File uploads (local disk) | ✅ Fine, watch SD card wear — use a USB SSD, not the SD card, for `data/` | ✅ Same advice |
| Messaging (polling) | ✅ Fine — see §6, this was specifically designed for this constraint | ✅ Fine |
| Notifications (computed on request) | ✅ Fine — no background jobs, no cron load | ✅ Fine |
| Concurrent users | Realistic ceiling ~15–20 active | ~30–40 |

**Suitable for Raspberry Pi**: everything currently in this app. There is no component that requires
a GPU, no background worker process, no message queue, no external service call on the hot path.

**Not suitable for Raspberry Pi, if these ever get added**: real-time push (WebSocket/SSE) messaging
at a scale beyond ~20 concurrent connections; a managed relational database if the team ever outgrows
SQLite's single-writer model; email/SMS deadline delivery (needs an external provider anyway, so it's
"not on the Pi" by definition, not "the Pi can't handle it"); any video/image processing.

**Cloud hosting** — a $5–6/mo VPS (or the free tier of Fly.io/Railway) handles this application
comfortably and removes the SD-card-wear and home-network-uptime concerns of a Pi, at the cost of
actual money and one more thing to maintain credentials for. For a team that already has free
university hosting or a spare Pi sitting around, the Pi is the more sensible choice.

**Database hosting** — SQLite-on-disk is the right choice at this team's scale (see §5). If the team
ever needs multiple app instances behind a load balancer, that decision point requires *first* moving
to Postgres — not a bigger Pi. There is no incremental step between "single SQLite file" and "real
concurrent-writer database"; don't try to build one.

---

## 5. Resource Usage

Rough estimates for a Next.js/SQLite app of this size, single process, on the seeded demo dataset (a
few dozen parts/tasks, handful of users):

- **CPU**: idle most of the time; page renders and API calls are sub-50ms on a Pi 4. Spikes only
  during `npm run build` (a few minutes, one-time or on each deploy) — this is the single heaviest
  operation the app ever performs, heavier than any runtime request.
- **RAM**: ~150–250MB for the Node process at idle, growing modestly with concurrent connections.
  Comfortable within a Pi 4's 4GB, trivial on 8GB.
- **Storage**: the SQLite file itself will stay in the tens of MB range for years at this team's data
  volume. Uploaded files (photos, datasheets, CAD) are the real long-term storage driver — budget for
  gigabytes, not megabytes, once the team is actually attaching build photos to every completed task.
  Use a USB SSD for `/data`, not the Pi's SD card, if going that route.
- **Network**: negligible — this is a LAN/campus-network tool, not serving public traffic.

**Expected performance limitations**: SQLite's single-writer model means write-heavy concurrent usage
(many people editing parts simultaneously) will serialize, not parallelize — invisible at this team's
scale (a few dozen active users, bursty usage), and the first thing that would need to change if the
team ever became much larger.

---

## 6. Why Messaging and Presence Are Polling, Not Push

This is worth stating plainly rather than burying in code comments: the brief asked to "evaluate
whether real-time messaging is technically appropriate for the hosting architecture," and the honest
answer is *not yet, and not without a reason to*. A persistent WebSocket/SSE connection per active user
is a fundamentally different resource profile (long-lived connections, not request/response) than the
rest of this app, and Next.js's standard deployment model doesn't give you a always-on WS server for
free the way a dedicated Node/Socket.io process would. For a team of a few dozen people, a 15-second
poll for unread counts and a 5-second poll only while a conversation is actually open is imperceptible
to the user and costs nothing worth optimizing on a Pi. If this ever needs to feel truly instant at
much larger scale, that's a deliberate infrastructure decision (a small dedicated WS service, or a
managed realtime provider) — not a bug to fix in the current code.

---

## 7. Deferred Features

Explicitly not built, and why:

- **Outbound email/SMS notifications.** The in-app notification center covers "delivery" without
  needing third-party credentials this environment doesn't have. Wiring a provider (SendGrid, Twilio,
  etc.) later is additive, not a rewrite — `generateNotifications()` and `getDueReminders()` already
  produce exactly the payload an email job would need.
- **`calendar_reminder_log` is schema-only, not wired up.** Reminders are currently computed live on
  every request (matches "days until deadline" against the configured intervals) rather than tracked
  as "sent" — correct for in-app display, but the moment reminders go out over email, you need the log
  to avoid re-sending the same reminder every time someone loads the page. The table exists for exactly
  that future use.
- **Multi-user task assignment has no UI**, though the backend (`task_assignees`) supports it. The
  creation form currently exposes single-user, whole-team, or whole-subsystem assignment, which covers
  the common cases; a picker for "these three specific people" was cut for time, not difficulty.
- **Spreadsheet sync/embedding.** Per the brief's own recommendation ("prioritize simple linking over
  complex spreadsheet synchronization"), this is implemented as exactly that: a `SPREADSHEET` document
  type alongside the existing link/upload system on Procedures and Documentation, pointing at wherever
  the team already keeps Budget/Mass/Geometry/Tire-data spreadsheets (Google Sheets, OneDrive, etc.).
  Live embedding or two-way sync was deliberately not attempted — it's a materially larger integration
  problem than this iteration's time budget, and the brief flagged it as something to evaluate, not
  necessarily build.
- **A single force-directed whole-vehicle dependency graph.** Still per-part requires/blocks columns,
  not one canvas of every part. Noted as a gap in the prior iteration and still true.
- **`npm audit` / dependency scanning** was not run as part of this pass — flagged in §3, not silently
  skipped.
- **Encryption at rest** for the SQLite file and uploaded documents — reasonable for this team's data
  sensitivity today, flagged as a real gap if that ever changes (§3).

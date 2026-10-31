# Runbook — start it up and check it works

Covers the `feat/account-security` branch. It was branched from
`feat/xp-gamification`, which was branched from `feat/v2-manual-entry`, so it
contains every commit from all three. Deploy that one branch — merging the
others as well is redundant.

Every command here runs from the repo root, the folder holding
`docker-compose.yml`.

## The one rule about `docker compose run`

Two forms exist and they are **not** interchangeable:

```bash
# CORRECT — the command passes through docker-entrypoint.sh, which fixes
# volume ownership and then drops to uid 1001 before running it.
docker compose run --rm maint npx tsx scripts/migrate-v2.ts

# WRONG for anything that writes — --entrypoint replaces the entrypoint, so
# this runs as root and leaves root-owned wsr.db-wal files in the volume. The
# app runs as uid 1001 and then cannot write: "attempt to write a readonly
# database". Recovering means deleting those files and starting over.
docker compose run --rm --entrypoint sh maint -c "npx tsx scripts/migrate-v2.ts"
```

`--entrypoint sh` is only safe for read-only inspection. Prefer the first form
always; it works for reads too.

---

## 1. Get the current code

```bash
git checkout feat/account-security
git pull
git log --oneline -1
```

## 2. Check which volume you are about to use

The compose project name is pinned to `wsr`, so the volume is `wsr_wsr-data`.

```bash
docker volume ls | grep wsr
docker run --rm -v wsr_wsr-data:/v alpine ls -la /v
```

**Expect** `wsr.db` with a non-trivial size. If the volume is empty but
`wsr-inventory_wsr-data` has a `wsr.db`, your data is in the pre-rename volume:

```bash
docker compose down
docker run --rm -v wsr-inventory_wsr-data:/from -v wsr_wsr-data:/to alpine \
  sh -c "cp -a /from/wsr.db /from/wsr.db-wal /to/ && ls -la /to"
```

Copy `wsr.db-wal` too — it holds committed transactions not yet folded into the
main file. Skip `-shm`; SQLite rebuilds it and a stale one confuses recovery.

## 3. Back up before changing anything

```bash
docker compose run --rm backup
ls -la backups/
```

**Expect** a `wsr-<timestamp>.db` and an `uploads-<timestamp>.tar.gz` in
`./backups/` on the host. The backup service has the right entrypoint already,
so no override is needed. If it prints "Refusing to run as root", something
overrode the entrypoint.

This step is not optional. Steps 4 and 5 change the schema.

## 3a. Build the maintenance image — once

```bash
docker compose build maint
```

Needed the first time, and after any change to `package.json` or the
Dockerfile. **Not** after an ordinary `git pull`: `maint`, `backup` and
`restore` bind-mount `./scripts` and `./lib` read-only from the working tree,
so a pulled script runs immediately.

That mount exists because the previous arrangement bit twice, both times with:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/scripts/<name>.ts'
```

which reads as a broken script and is actually an image older than the code.

The `app` service deliberately does NOT get that mount — it runs the built
output and is rebuilt with `--build`.

## 3b. Write down what is in there now

```bash
docker compose run --rm maint npx tsx scripts/status.ts
```

Opens the database read-only, so it cannot change anything. Prints row counts
and which migrations have run. A table that does not exist yet reports `-`
rather than failing — that is the normal state of `xp_events` before step 6.

Keep this output. You compare against it after step 10: `users` and `parts` must
not have dropped.

## 4. Schema migration

Dry run first. It writes nothing.

```bash
docker compose run --rm maint npx tsx scripts/migrate-v2.ts
```

**Expect** `19 total, 0 already applied, 19 pending` on a database that has not
been migrated, and a list of the columns and tables it will add.

If you ran an earlier version of this migration, re-run it anyway — it reports
`18 already applied, 1 pending` and adds the ruleset tables, which shipped in
schema.sql without a migration and so never reached an existing database. Each
step is checked independently, so a re-run only applies what is genuinely
missing.

Then apply:

```bash
docker compose run --rm maint npx tsx scripts/migrate-v2.ts --commit
```

**Expect** `schema steps applied : 19`, `subsystem codes backfilled : 10`,
`vehicle targets seeded : 10`. It will also warn that no subsystem exists for
workbook tab `WHE` — step 5 fixes that.

## 5. Taxonomy migration

```bash
docker compose run --rm maint npx tsx scripts/migrate-taxonomy.ts
```

**Expect** a plan: Electronics merging into Electrical, Wheels & Tires being
created, and Engine / Intake / Fuel System / Cooling / Exhaust becoming subteams
of Powertrain, with a row count for each. Read the row counts — they tell you
how much real data is about to move.

```bash
docker compose run --rm maint npx tsx scripts/migrate-taxonomy.ts --commit
```

**Expect** `workbook tab coverage: 11/11 — complete` and a final list of 15
subsystems. Nothing is deleted until its rows have been repointed; the script
refuses to remove a subsystem anything still references.

## 6. XP and shop-time tables

```bash
docker compose run --rm maint npx tsx scripts/migrate-xp.ts
docker compose run --rm maint npx tsx scripts/migrate-xp.ts --commit
```

**Expect** `3 to create` then `tables created : 3` — `xp_events`,
`shop_sessions`, `shop_heartbeats`. Additive; no existing row is touched.

Skip this and the app still boots, but the XP badge, the ledger drawer and
shop check-in all fail at runtime because their tables do not exist.

## 7. Account security tables

```bash
docker compose run --rm maint npx tsx scripts/migrate-security.ts
docker compose run --rm maint npx tsx scripts/migrate-security.ts --commit
```

**Expect** `2 pending` then `steps applied : 2` — the `users.password_changed_at`
column and the `account_setup_tokens` table.

`password_changed_at` is left NULL for everyone, which reads as "no password
change recorded", so existing sessions stay valid rather than signing the whole
team out the moment this lands.

Skip this and sign-in still works, but issuing setup links and the
change-password page both fail at runtime.

## 6b. XP ranks, achievements and multiplier windows

`migrate-xp.ts` gained a fourth table after it first shipped. Re-run it — each
table is checked independently, so it reports the three you already have as
present and adds only the new one.

```bash
docker compose run --rm maint npx tsx scripts/migrate-xp.ts
docker compose run --rm maint npx tsx scripts/migrate-xp.ts --commit
```

**Expect** `4 total, 3 present, 1 to create` on a database that already ran the
first version, and `xp_multiplier_windows` as the one being added.

Ranks and achievements need no migration — both are derived from the ledger
every time the drawer opens, so nothing is stored that can drift out of step
with the events it came from.

To open a double-XP window, POST to `/api/xp/windows` as Chief or Admin. The
limits are refused with an explanation rather than a number: 2x ceiling, 14
hours maximum, no overlaps, and **the daily cap still applies afterwards** — a
window is not a way around it.

## 7a. Mass: units, budgets and the freeze gate

```bash
docker compose run --rm maint npx tsx scripts/migrate-mass.ts
docker compose run --rm maint npx tsx scripts/migrate-mass.ts --commit
```

**Expect** `3 pending` — `parts.mass_unit`, `parts.mass_not_applicable`,
`subsystems.mass_budget_kg` — and a proposed budget split printed before it
writes anything.

The split is seeded from `target_vehicle_mass_lb` (500 lb = 226.8 kg) using the
workbook's shares. It is a STARTING POINT. Every value is editable on the
subsystem page, and **re-running never overwrites an edited one**.

What changes for the team:

- Masses can be entered in **kg, g, lb or oz**. Storage is always kilograms;
  the unit only controls how the number is shown back. Switching the dropdown
  converts what is already typed rather than reinterpreting it.
- A part cannot be marked **FROZEN** without a mass — measured, allocated, or
  an explicit "mass not applicable" for fasteners and consumables. The same
  rule gates the subsystem's Design frozen gate.
- A subsystem over its mass budget is **capped at 92%** however many gates are
  closed.

## 7b. Gate-based completeness

```bash
docker compose run --rm maint npx tsx scripts/migrate-readiness.ts
docker compose run --rm maint npx tsx scripts/migrate-readiness.ts --commit
```

**Expect** `7 pending` then `steps applied : 7` — `subsystem_gates`,
`subsystem_gate_log`, `subsystems.part_list_declared_complete` and four
`interfaces.agreed_*` columns.

**Tell the team before they see it.** Every subsystem will read **0%** the
morning this lands, including ones with parts bought and fitted. That is
correct: completeness is now eight gates signed off by people, and nothing is
seeded as passed, because the dashboard asserting something no person has said
is the defect this replaces. The old number counted owned parts, so a subsystem
with one owned part read 100%.

The climb back up is: a lead ticks "the part list is complete" on the subsystem
page, endorses each gate as its data supports it, and the Chief Engineer or an
Admin approves. Only approval counts.

Two things that cap a subsystem regardless of gates:

- a **P1 interface** not agreed by BOTH leads caps it at 84%
- a closed gate whose data has since changed is flagged **stale** — it warns
  loudly and does not lower the number

Skip this and the app still boots, but every subsystem page and the dashboard
headline fail at runtime because `subsystem_gates` does not exist.

## 8. Reference data — FSAE deadlines and the how-to procedure

```bash
docker compose run --rm maint npx tsx scripts/seed-reference-data.ts
```

The deadline dates come from the parts workbook, which Jonathan confirmed was
built from the SAE calendar. The ruleset itself publishes no dates — Table PS-1
lists formats and penalty groups only — so the script will not write them
without an explicit flag:

```bash
docker compose run --rm maint npx tsx scripts/seed-reference-data.ts --commit --dates-verified
```

**Expect** `calendar events added : 10` and `procedure added : yes, 14 steps`.

Keep that flag in mind for the 2028 ruleset: re-check the dates then rather
than assuming they carried over. `--commit --skip-deadlines` seeds only the
procedure if you ever want the how-to without the calendar.

## 9. The FSAE ruleset

Convert the PDF to text on the host first. The importer takes text, not PDF, so
no PDF parser runs inside the app.

```bash
# brew install poppler   # if pdftotext is missing
pdftotext -layout FSAE_Rules_2027_V1.pdf rules-2027.txt
wc -l rules-2027.txt
```

**Expect** roughly 5850 lines and about 300 KB.

**The text file must exist before the next command.** The import bind-mounts
`$PWD/rules-2027.txt`, and Docker creates a host path that does not exist as an
empty **directory** rather than failing. You then get a confusing error, and a
stray `rules-2027.txt/` directory sitting in the repo that the next download
refuses to overwrite. If that has already happened:

```bash
rmdir rules-2027.txt     # refuses if anything is inside
```

The importer now detects both this and a truncated file, and says which it is.

Then import:

```bash
docker compose run --rm -v "$PWD/rules-2027.txt:/app/rules-2027.txt:ro" maint \
  npx tsx scripts/import-ruleset.ts rules-2027.txt --year 2027 --version 1.0 --commit --activate
```

**Expect** `imported 1825 clauses`, twelve sections listed, and a reconciliation
report. If it reports fewer than 200 clauses it refuses — the text extraction
failed and `-layout` was probably missing.

## 10. Start it

```bash
docker compose up -d --build app
docker compose ps
curl -i localhost:3000/api/health
```

**Expect** `running (healthy)` and a health body with counts:

```json
{"status":"ok","db":"ok","users":2,"subsystems":15,"parts":0,...}
```

Then compare against step 3b:

```bash
docker compose run --rm maint npx tsx scripts/status.ts
```

`users` and `parts` must match step 3b exactly. `rules` should now be non-zero
if step 9 ran, and the XP and security tables should no longer read `-`.

- `"subsystems":15` confirms the taxonomy migration took.
- `"db":"empty"` with HTTP 503 means the app is on a volume with no users —
  back to step 2.
- No counts at all means an old image is still running; rebuild.

## 10a. If the app shows "a server-side exception has occurred"

A digest and nothing else means a MIGRATION is outstanding, nine times in ten.

```bash
docker compose logs app --tail 40
```

The log now opens with a block naming the exact script to run. `schema.sql`
creates new TABLES on boot but cannot add a COLUMN to a table that already
exists, so the app can start with every table present and still throw on the
first page that selects a missing column.

`curl -s localhost:3000/api/health` reports the same thing as
`migrationsPending`, and `"ok"` is false while any migration is outstanding.

Your data is not affected by this. Run the named migration and restart.

## 11. Log in

```bash
docker compose run --rm maint npx tsx scripts/reset-password.ts --list
```

Pick the admin account, then:

```bash
docker compose run --rm maint npx tsx scripts/reset-password.ts --email <that address>
```

The password prints once. Copy it before the terminal scrolls.

The CLI is the right tool for the FIRST admin specifically — there is nobody
else who could send them a link. Everyone after that gets a setup link instead
(step 12), so nobody but the owner ever knows their password.

Open `http://localhost:3000`, log in, then go to **Settings → Users** and fix
that account's name and email if they are still placeholders. Then change your
own password at **/account** — the CLI printed it to a terminal, which is one
more place it has existed than necessary.

---

## 12. Checks, in order

Each one has a specific pass condition. "The page loads" is not one.

**Subsystems** (`/subsystems`) — exactly **15**. `Wheels & Tires` present.
`Electronics` gone. No `Engine`, `Intake`, `Fuel System`, `Cooling` or `Exhaust`
at the top level.

**New part** (`/parts/new`) — the most-changed screen:

- Sections collapse and expand: Design maturity, Cost, Mass, Buying it, Status.
- Help text under every field.
- Choose Powertrain → a Subteam dropdown appears offering the five demoted areas.
- **The gate:** set Design status to `Selected` and leave Acceptance criterion
  empty. The submit button must go disabled with the reason shown inline. Add a
  sentence and a rule, and it enables.
- **Line cost:** quantity `25`, cost low `7`, cost high `10` → reads
  `line total: $175 – $250`. If it shows `$7 – $10`, the per-unit fix is missing.

**Part detail** (`/parts/<id>`) — create that part, open it. A "Governing rules"
panel appears. Type `scatter shield`. **Expect** `T.5.2.7 Chain Drive — Scatter
shields for chains must:` among the results. Click to attach, click the heading
to read the clause text. An empty list means step 9 did not run.

**Shopping list** (`/shopping-list`) — priority shows a band word
(NORMAL / HIGH / URGENT) under the number; cost shows the line total with the
range beneath it.

**Dashboard** (`/dashboard`) — the headline is the mean of subsystem gate
percentages, with a line beneath saying how many subsystems are fully signed
off, how many are capped by an open critical interface, and how many closed
gates no longer match their data.

**Mass panel** (any subsystem page) — committed mass against budget, split
into weighed and still-estimated. Create a part with mass in **lb** and confirm
the panel shows the converted kg. Set the budget below the committed mass and
the subsystem should cap at 92%.

**Completeness panel** (any subsystem page) — eight gates, each with a state
and a sentence saying what it is waiting on. Checks:

- Every gate below `Scoped` reads `BLOCKED — Waiting on Scoped` until Scoped is
  approved. Nothing below an unscoped list means anything.
- Tick "the part list for this subsystem is complete" and `Scoped` moves to
  `READY`, not `PASSED`. Endorse it as a lead and it moves to `ENDORSED`.
  Approve as Chief/Admin and it reads `CLOSED`.
- As a TEAM_LEADER, try to approve your own endorsement. It must refuse with
  "Only the Chief Engineer or an Admin can approve a gate — endorse it instead".
- Endorse `Rules checked` with nothing written. It must refuse and ask for
  evidence.
- Mark a gate out of scope with a one-word reason. It must refuse and ask for a
  few words. `Scoped` can never be marked out of scope.
- The `Tested` gate cannot be approved by whoever endorsed it, Chief included.

**The car** (`/dashboard`) — click any region and it opens that subsystem.
Point at a wheel and the readout says Wheels & Tires, not Brakes. Amber means
the subsystem is held by an open critical interface rather than by its own work.

**The car** (`/dashboard`, panel "The car, as it stands") — a top-down schematic
draws itself in. With no parts entered every region is dim; that is correct, not
a broken render. Enter a part and own it, reload, and that region turns orange.
Point at a region: the rest dim and the readout below names the subsystem and
its counts. Click the name to land on that subsystem. On a phone, tap works the
same way — the readout is below the drawing rather than a tooltip for exactly
that reason.

**Calendar** (`/calendar`) — the ten FSAE 2027 deadlines, the grounds-for-removal
ones marked critical.

**Procedures** (`/procedures`) — "How to add a part", 14 steps.

**Interfaces** (`/interfaces`) — empty on a fresh database, with an explanation
of what an interface is. Raise one between two subsystems: the reference number
is generated from their codes. Agree it as one lead and the row should say
WAITING ON THE OTHER LEAD rather than showing AGREED. Agree the second side and
it flips. A P1 left half-agreed caps both of its subsystems at 84%.

**XP badge** (top bar) — a small lime figure next to the check-in button.
Click it: the ledger drawer opens and says there is nothing yet. Approve a task
with evidence and it should jump to 20 with a toast and a confetti burst. A
blank badge usually means step 6 was skipped.

**Shop time** (`/shop`) — check in from the nav. The button turns green and
counts elapsed minutes. Check out and the session appears in the table as
`settled`. Hours are recorded; shop time awards no XP yet by design.

**Login page** — the logo must render. If you see a broken image, the brand
assets are not reaching the browser; they are allow-listed in `middleware.ts`
under `PUBLIC_ASSETS`.

**Setup links** (`/settings/users`) — the create form has no password field.
Create a throwaway account and the link appears once with a copy button. Open
it in a private window: it should greet that person by name and refuse a weak
password with a specific reason. Set one, sign in as them, then open the SAME
link again — it must say "already been used". If it works twice, stop and tell
me; single use is the whole point.

**Your account** (`/account`, or your name in the top bar) — change your
password with the wrong current password and it must refuse. Change it
correctly and you stay signed in here while any other browser you were signed
in on gets bounced to the login screen. That is `password_changed_at` doing
its job.

---

## 13. Persistence check

Create a part named `PERSISTENCE TEST`, then escalate. Each step destroys more
than the last. **Note there is no `-v` anywhere** — that flag deletes the volume.

```bash
docker compose restart app                 # process restart
docker compose down && docker compose up -d app   # container destroyed and recreated
docker compose up -d --build app           # image rebuilt from scratch
docker kill $(docker compose ps -q app) && docker compose up -d app   # ungraceful kill
```

Reload the browser after each. The part survives all four, or something is
wrong.

## 14. Schedule backups on the VM

Only needed on the real server, not for local testing.

```bash
# edit WorkingDirectory and User= in the .service file first
sudo cp deploy/wsr-docker-backup.service deploy/wsr-docker-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now wsr-docker-backup.timer
systemctl list-timers | grep wsr-docker-backup

# prove it works rather than trusting the schedule
sudo systemctl start wsr-docker-backup.service
journalctl -u wsr-docker-backup.service -n 30
```

Then get `./backups/` off the machine — rsync to another host or sync to
whatever storage the sponsor provides. A backup on the same disk dies with the
disk.

---

## If something breaks

```bash
docker compose logs app --tail 50
docker compose ps
```

**"attempt to write a readonly database"** — something wrote to the volume as
root. Check for root-owned files and fix ownership:

```bash
docker run --rm -v wsr_wsr-data:/v alpine ls -la /v        # look for 0:0
docker compose run --rm maint sh -c "ls -la /app/data"     # entrypoint fixes it
```

**Restoring a backup:**

```bash
docker compose run --rm restore --list
docker compose stop app
docker compose run --rm restore <timestamp>
docker compose up -d app
```

Restore saves the current database to `backups/pre-restore-<timestamp>.db`
first, so a mistaken restore is itself recoverable.

/**
 * Reference data — facts that do not depend on the team's own plans.
 *
 *   - The FSAE 2027 pre-competition submission deadlines — BUT ONLY ONCE
 *     SOMEBODY HAS CONFIRMED THEM. See the warning below.
 *   - A "How to add a part" procedure, so the dashboard explains itself to the
 *     team rather than relying on somebody being shown once.
 *
 * Usage (from the project root):
 *   npx tsx scripts/seed-reference-data.ts
 *   npx tsx scripts/seed-reference-data.ts --commit
 *
 * Safe to run repeatedly: every row is matched before it is inserted and
 * nothing already present is modified.
 *
 * ---------------------------------------------------------------------------
 * THE DATES BELOW ARE UNVERIFIED. READ THIS BEFORE USING --commit.
 *
 * The FSAE 2027 ruleset contains NO submission dates. Table PS-1 lists each
 * submission with its rule reference, required format and penalty group, and
 * nothing else; the only date in the whole document is its own publication
 * date. PS.3.1 refers to a "Due Date" and a "Cancellation Date" without ever
 * stating them — those live on the FSAE Event Website.
 *
 * The dates in this file were transcribed from a planning spreadsheet whose own
 * README describes its contents as estimates. They could be wrong by days or
 * entirely invented.
 *
 * A wrong date here is worse than no date. These events render as CRITICAL with
 * "GROUNDS FOR REMOVAL if missed", which is maximum authority — a team that
 * trusts a fabricated SES deadline can lose its entry.
 *
 * So committing them requires --dates-verified, which you pass only after
 * checking every date against fsaeonline.com or the Event Website for your
 * competition. Each seeded event still carries a note saying where its date
 * came from, so anyone reading the calendar can tell.
 * ---------------------------------------------------------------------------
 */
import path from "path";
import fs from "fs";
import Database from "better-sqlite3";
import { nanoid } from "nanoid";

const DB_PATH = process.env.WSR_DB_PATH || path.join(process.cwd(), "data", "wsr.db");

type Deadline = {
  title: string;
  date: string;
  time: string;
  gfr: boolean;
  note?: string;
};

const DEADLINES: Deadline[] = [
  { title: "2027 Tech — ETC Notice of Intent", date: "2026-11-09", time: "11:59", gfr: false },
  {
    title: "2027 Presentation Event — Round 1 — Presentation Concept RFP Submission",
    date: "2026-12-16",
    time: "23:59",
    gfr: true,
    note: "Cancelation date 2026-12-17."
  },
  { title: "2027 Tech — SES (Structural Equivalency Spreadsheet)", date: "2027-01-11", time: "11:59", gfr: true },
  { title: "2027 Tech — ETC Review Form", date: "2027-02-01", time: "11:59", gfr: false },
  { title: "2027 Fuel Order — Fuel Type Selection", date: "2027-03-01", time: "11:59", gfr: false },
  {
    title: "2027 Presentation Event — Round 2 — Virtual Presentation Presenter Form",
    date: "2027-03-08",
    time: "23:59",
    gfr: false
  },
  { title: "2027 Design Event — Design 3-View Drawings", date: "2027-03-29", time: "23:59", gfr: true },
  { title: "2027 Design Event — Design Briefing", date: "2027-03-29", time: "23:59", gfr: true },
  { title: "2027 Design Event — Design Spec Sheet", date: "2027-03-29", time: "23:59", gfr: true },
  { title: "2027 Cost Event — Cost Scenario RFQ", date: "2027-04-19", time: "11:59", gfr: true }
];

const ADD_PART_STEPS: string[] = [
  "Search before you add. Type the part name into the global search. Two people adding the same part under two names is the most common way this database goes wrong.",
  "Name it for what it is, not what it does. 'Rear upright', not 'the thing that holds the hub'. If the team already has a name for it, use that name — consistency beats precision here.",
  "Pick the subsystem that OWNS the part, not every subsystem that touches it. Ownership decides who can edit it. Boundaries between subsystems are recorded as interfaces, not by filing the part in two places.",
  "Set quantity required to what the CAR needs. Spares go on their own line with their own quantity, so spare mass does not count against the vehicle.",
  "Set the unit. '25' means nothing on a line of square tubing until it says whether that is 25 feet or 25 sticks.",
  "Fill in quantity owned honestly, including zero. Every readiness number on the dashboard is built from this field. A part nobody has counted is worth less than a part counted as zero.",
  "Choose the design status that is actually true today. Placeholder means you know you need something but have not found it. Candidate means you have named a specific part. Quoted means a vendor has confirmed price and mass IN WRITING. Selected means the decision is made. Frozen means it is locked and changing it needs a change record.",
  "Enter cost as a range, low and high, per unit. Leave both equal once you have a real quote. The dashboard multiplies by quantity for you — do not pre-multiply, or the line total will be wrong by a factor of the quantity.",
  "Set the sponsor ask. Cash means asking a sponsor to fund it, in-kind means asking for the part itself, discount means asking for team pricing, buy means the team pays retail. This field is what sponsor outreach is built from, so an unset value means the part is invisible to that work.",
  "Give it a mass allocation before you have a part, and a measured mass once you do. Weigh it. Datasheet masses are optimistic and the vehicle mass budget is not.",
  "Write an acceptance criterion: how will you know this part is correct once it arrives? A test, a measurement, a dimension that has to fit. 'Works properly' is not an acceptance criterion. A part cannot reach Selected without one.",
  "Cite the governing FSAE rule from the part's page once it is saved. Type what the rule covers — 'scatter shield' — and pick the clause. Tech inspection checks the car against the rules, so a part with a rule and no citation is a part nobody has checked.",
  "Add the lead time and the needed-by date. The dashboard works out the order-by date from those two. A part with no lead time looks like it can be ordered the day before, which is how parts arrive late.",
  "Save, then attach what you have: the datasheet, the quote, the drawing. A part record with no supporting document is a claim, not a record."
];

function main() {
  const commit = process.argv.includes("--commit");
  const datesVerified = process.argv.includes("--dates-verified");
  const skipDeadlines = process.argv.includes("--skip-deadlines");
  if (!fs.existsSync(DB_PATH)) {
    console.error(`No database at ${DB_PATH}.`);
    process.exit(1);
  }

  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");

  const admin = db.prepare(`SELECT id, name FROM users WHERE role = 'ADMIN' ORDER BY created_at LIMIT 1`).get() as
    | { id: string; name: string }
    | undefined;

  const findEvent = db.prepare(`SELECT id FROM calendar_events WHERE title = ? AND deadline_date = ?`);
  const pendingEvents = DEADLINES.filter((d) => !findEvent.get(d.title, d.date));

  const procTitle = "How to add a part";
  const existingProc = db.prepare(`SELECT id FROM procedures WHERE title = ?`).get(procTitle) as
    | { id: string }
    | undefined;

  console.log(`database : ${DB_PATH}`);
  console.log(`mode     : ${commit ? "COMMIT" : "DRY RUN (nothing written)"}`);
  console.log(`admin    : ${admin ? `${admin.name}` : "none found — procedure will have no author"}`);
  console.log(`\ncompetition deadlines : ${pendingEvents.length} to add, ${DEADLINES.length - pendingEvents.length} already present`);
  for (const d of pendingEvents) {
    console.log(`  ${d.date} ${d.time}  ${d.gfr ? "CRITICAL" : "HIGH    "}  ${d.title.slice(0, 58)}`);
  }
  console.log(`\nprocedure "${procTitle}" : ${existingProc ? "already present, leaving it alone" : `to add, ${ADD_PART_STEPS.length} steps`}`);

  console.log(
    `\nThe dates above are UNVERIFIED. The 2027 ruleset contains no submission dates at all —\n` +
      `Table PS-1 lists formats and penalty groups only, and PS.3.1 points at the Event Website.\n` +
      `These were transcribed from a planning spreadsheet and may be wrong or invented.`
  );

  if (!commit) {
    console.log(`\nDry run complete.`);
    console.log(`To write: check every date against fsaeonline.com, then re-run with`);
    console.log(`  --commit --dates-verified`);
    db.close();
    return;
  }

  // Only gate when deadlines are actually about to be written.
  if (pendingEvents.length > 0 && !datesVerified && !skipDeadlines) {
    console.error(
      `\nRefusing to write ${pendingEvents.length} deadline(s) without --dates-verified.\n` +
        `These render as CRITICAL with "GROUNDS FOR REMOVAL if missed". A fabricated deadline\n` +
        `presented that way can cost the team its entry, so confirm each date first.\n\n` +
        `To seed ONLY the procedure and skip the deadlines entirely:\n` +
        `  --commit --skip-deadlines`
    );
    db.close();
    process.exit(1);
  }

  const insEvent = db.prepare(
    `INSERT INTO calendar_events (id, title, description, event_type, deadline_date, deadline_time,
       priority, is_actionable, status, reminder_intervals, notify_scope, created_by)
     VALUES (@id, @title, @description, 'DEADLINE', @date, @time, @priority, 1, 'UPCOMING',
       @reminders, 'EVERYONE', @created_by)`
  );

  let events = 0;
  db.transaction(() => {
    for (const d of skipDeadlines ? [] : pendingEvents) {
      insEvent.run({
        id: `cal_${nanoid(12)}`,
        title: d.title,
        description: [
          "Formula SAE 2027 pre-competition submission.",
          d.gfr ? "GROUNDS FOR REMOVAL if missed." : "Late submission accrues penalty points.",
          d.note ?? null,
          "Date transcribed from a team planning spreadsheet and confirmed by whoever ran the " +
            "seed — the ruleset itself publishes no dates. Re-check on the Event Website."
        ]
          .filter(Boolean)
          .join(" "),
        date: d.date,
        time: d.time,
        priority: d.gfr ? "CRITICAL" : "HIGH",
        reminders: JSON.stringify(d.gfr ? [30, 14, 7, 3, 1, 0] : [14, 7, 1]),
        created_by: admin?.id ?? null
      });
      events++;
    }
  })();

  let steps = 0;
  if (!existingProc) {
    const procId = `proc_${nanoid(12)}`;
    const insStep = db.prepare(
      `INSERT INTO procedure_steps (id, procedure_id, step_number, content) VALUES (?, ?, ?, ?)`
    );
    db.transaction(() => {
      db.prepare(
        `INSERT INTO procedures (id, title, category, description, purpose, applicable_teams,
           required_documentation, revision_number, author_id, approval_status)
         VALUES (@id, @title, 'DASHBOARD_USAGE', @description, @purpose, 'All Teams',
           @required_documentation, '1.0', @author_id, 'APPROVED')`
      ).run({
        id: procId,
        title: procTitle,
        description:
          "What to fill in when adding a part to the dashboard, and why each field matters. Read this once before " +
          "adding your subsystem's parts.",
        purpose:
          "Parts are entered by hand so that the person entering them has looked at them. That only works if " +
          "everyone enters them the same way. This procedure is the shared standard.",
        required_documentation:
          "A datasheet, quote, or drawing attached to the part record. A part with no supporting document is a " +
          "claim, not a record.",
        author_id: admin?.id ?? null
      });
      ADD_PART_STEPS.forEach((content, i) => {
        insStep.run(`pstep_${nanoid(12)}`, procId, i + 1, content);
        steps++;
      });
    })();
  }

  console.log(`\ncalendar events added : ${events}`);
  console.log(`procedure added       : ${existingProc ? "no (already present)" : `yes, ${steps} steps`}`);
  console.log(`\nDone. Verify the deadline dates against the current SAE calendar.`);
  db.close();
}

main();

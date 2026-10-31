/**
 * Readiness migration — gate sign-offs and both-sides interface agreement.
 *
 * Usage (from the project root):
 *   npx tsx scripts/migrate-readiness.ts            # report what would change
 *   npx tsx scripts/migrate-readiness.ts --commit   # apply
 *
 * In Docker, pass the command THROUGH the entrypoint so it runs as uid 1001:
 *   docker compose run --rm maint npx tsx scripts/migrate-readiness.ts --commit
 * Never with --entrypoint sh; that runs as root and leaves root-owned files in
 * the volume. See RUNBOOK.md.
 *
 * Additive. Creates two tables and five columns, writes no gate rows, and
 * touches no existing row. Safe to run twice: every step is checked
 * independently, so a partial earlier run completes rather than failing.
 *
 * NO GATES ARE SEEDED, deliberately. Seeding SCOPED as passed for existing
 * subsystems would be the dashboard asserting something no person has said —
 * which is the entire defect this migration exists to fix. Every subsystem
 * starts at 0% and climbs as leads endorse and the Chief approves. That is the
 * honest starting position, and it will look alarming on the first morning;
 * tell the team why before they see it.
 */
import path from "path";
import fs from "fs";
import Database from "better-sqlite3";

const DB_PATH = process.env.WSR_DB_PATH || path.join(process.cwd(), "data", "wsr.db");
const commit = process.argv.includes("--commit");

if (!fs.existsSync(DB_PATH)) {
  console.error(`No database at ${DB_PATH}.`);
  process.exit(1);
}

const db = new Database(DB_PATH);
db.pragma("foreign_keys = ON");

function tableExists(name: string): boolean {
  return !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name);
}
function columnExists(table: string, column: string): boolean {
  if (!tableExists(table)) return false;
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(
    (c) => c.name === column
  );
}

interface Step {
  name: string;
  applied: () => boolean;
  sql: string[];
}

const STEPS: Step[] = [
  {
    name: "subsystem_gates table",
    applied: () => tableExists("subsystem_gates"),
    sql: [
      `CREATE TABLE IF NOT EXISTS subsystem_gates (
        id TEXT PRIMARY KEY,
        subsystem_id TEXT NOT NULL REFERENCES subsystems(id) ON DELETE CASCADE,
        gate TEXT NOT NULL CHECK (gate IN (
          'SCOPED','DESIGN_FROZEN','RULES_CHECKED','INTERFACES_AGREED',
          'PROCURED','MANUFACTURED','INSTALLED','TESTED'
        )),
        decision TEXT NOT NULL CHECK (decision IN ('PASSED','NOT_APPLICABLE')),
        reason TEXT,
        endorsed_by TEXT REFERENCES users(id),
        endorsed_at TEXT,
        approved_by TEXT REFERENCES users(id),
        approved_at TEXT,
        evidence_document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
        evidence_note TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (subsystem_id, gate)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_subsystem_gates_subsystem ON subsystem_gates(subsystem_id)`
    ]
  },
  {
    name: "subsystem_gate_log table",
    applied: () => tableExists("subsystem_gate_log"),
    sql: [
      `CREATE TABLE IF NOT EXISTS subsystem_gate_log (
        id TEXT PRIMARY KEY,
        subsystem_id TEXT NOT NULL REFERENCES subsystems(id) ON DELETE CASCADE,
        gate TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('ENDORSED','APPROVED','REOPENED','MARKED_NA','BACK_IN_SCOPE')),
        actor_id TEXT NOT NULL REFERENCES users(id),
        note TEXT,
        at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_gate_log_subsystem ON subsystem_gate_log(subsystem_id, at)`
    ]
  },
  {
    name: "subsystems.part_list_declared_complete",
    applied: () => columnExists("subsystems", "part_list_declared_complete"),
    sql: [`ALTER TABLE subsystems ADD COLUMN part_list_declared_complete INTEGER NOT NULL DEFAULT 0`]
  },
  {
    name: "interfaces.agreed_by_a",
    applied: () => columnExists("interfaces", "agreed_by_a"),
    sql: [`ALTER TABLE interfaces ADD COLUMN agreed_by_a TEXT REFERENCES users(id)`]
  },
  {
    name: "interfaces.agreed_a_at",
    applied: () => columnExists("interfaces", "agreed_a_at"),
    sql: [`ALTER TABLE interfaces ADD COLUMN agreed_a_at TEXT`]
  },
  {
    name: "interfaces.agreed_by_b",
    applied: () => columnExists("interfaces", "agreed_by_b"),
    sql: [`ALTER TABLE interfaces ADD COLUMN agreed_by_b TEXT REFERENCES users(id)`]
  },
  {
    name: "interfaces.agreed_b_at",
    applied: () => columnExists("interfaces", "agreed_b_at"),
    sql: [`ALTER TABLE interfaces ADD COLUMN agreed_b_at TEXT`]
  }
];

const pending = STEPS.filter((s) => !s.applied());

console.log(`database : ${DB_PATH}`);
console.log(`mode     : ${commit ? "COMMIT" : "DRY RUN (nothing written)"}`);
console.log(`steps    : ${STEPS.length} total, ${STEPS.length - pending.length} already applied, ${pending.length} pending`);
for (const s of pending) console.log(`  + ${s.name}`);

if (!tableExists("interfaces")) {
  console.log("\nNOTE: no `interfaces` table — run scripts/migrate-v2.ts first.");
}

const subsystems = tableExists("subsystems")
  ? (db.prepare(`SELECT COUNT(*) n FROM subsystems`).get() as { n: number }).n
  : 0;
console.log(
  `\n${subsystems} subsystem${subsystems === 1 ? "" : "s"} will start at 0% with no gates signed. ` +
    `Nothing is seeded as passed:\nthe dashboard must not assert something no person has said — ` +
    `that is the defect being fixed.`
);

if (!commit) {
  console.log("\nDry run complete. Re-run with --commit to apply.");
  process.exit(0);
}

if (pending.length === 0) {
  console.log("\nNothing to do.");
  process.exit(0);
}

const run = db.transaction(() => {
  for (const s of pending) {
    for (const sql of s.sql) db.exec(sql);
  }
});
run();

console.log(`\nsteps applied : ${pending.length}`);
console.log("gate rows written : 0 (by design)");
console.log("\nDone. Readiness now reads from gates; the old part-count number is gone.");
db.close();

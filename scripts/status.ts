/**
 * Read-only snapshot of what is in the database.
 *
 * Usage (from the project root):
 *   npx tsx scripts/status.ts
 *   npx tsx scripts/status.ts --json
 *
 * In Docker, pass the command THROUGH the entrypoint:
 *   docker compose run --rm maint npx tsx scripts/status.ts
 * Never with --entrypoint sh; that runs as root and leaves root-owned files in
 * the volume. See RUNBOOK.md.
 *
 * Opens the database READ-ONLY, so it cannot alter anything even by accident —
 * the whole point is to run it before and after a migration and compare.
 *
 * A table that does not exist yet reports as "-" rather than crashing: that is
 * the normal state of xp_events before migrate-xp, and of rules before the
 * ruleset import, and it is more useful to see the rest of the counts than to
 * die on the first missing table.
 */
import path from "path";
import fs from "fs";
import Database from "better-sqlite3";

const DB_PATH = process.env.WSR_DB_PATH || path.join(process.cwd(), "data", "wsr.db");
const asJson = process.argv.includes("--json");

if (!fs.existsSync(DB_PATH)) {
  console.error(`No database at ${DB_PATH}.`);
  process.exit(1);
}

const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

function tableExists(name: string): boolean {
  return !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name);
}

/** Returns null — rendered as "-" — when the table has not been created yet. */
function count(table: string, where?: string): number | null {
  if (!tableExists(table)) return null;
  const sql = `SELECT COUNT(*) AS n FROM ${table}${where ? ` WHERE ${where}` : ""}`;
  return (db.prepare(sql).get() as { n: number }).n;
}

function columnExists(table: string, column: string): boolean {
  if (!tableExists(table)) return false;
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return cols.some((c) => c.name === column);
}

const stats: Record<string, number | null> = {
  // Core content. These are the numbers that must not drop across a migration.
  users: count("users"),
  subsystems: count("subsystems"),
  subteams: count("subteams"),
  parts: count("parts"),
  tasks: count("tasks"),
  tools: count("tools"),
  documents: count("documents"),

  // Reference data, seeded rather than entered.
  calendar_events: count("calendar_events"),
  procedures: count("procedures"),
  vehicle_targets: count("vehicle_targets"),

  // Ruleset — 0 until import-ruleset runs, "-" until migrate-v2 step 19 runs.
  rulesets: count("rulesets"),
  rules: count("rules"),
  rule_citations: count("rule_citations"),

  // XP — "-" until migrate-xp runs.
  xp_events: count("xp_events"),
  shop_sessions: count("shop_sessions"),

  // Security — "-" until migrate-security runs.
  setup_tokens: count("account_setup_tokens")
};

// Migration markers: cheaper and less ambiguous than inferring from counts.
const markers = {
  "subsystem codes backfilled": columnExists("subsystems", "code")
    ? `${count("subsystems", "code IS NOT NULL")} of ${stats.subsystems}`
    : "column missing — migrate-v2 not run",
  "v2 part columns": columnExists("parts", "governing_rule") ? "present" : "missing — migrate-v2 not run",
  "password_changed_at": columnExists("users", "password_changed_at")
    ? "present"
    : "missing — migrate-security not run",
  "accounts awaiting setup": columnExists("users", "password_hash")
    ? String(count("users", "password_hash = ''"))
    : "-",
  "active ruleset": tableExists("rulesets")
    ? ((db.prepare(`SELECT year || ' v' || version AS v FROM rulesets WHERE is_active = 1`).get() as
        | { v: string }
        | undefined)?.v ?? "none activated")
    : "-"
};

const dbSize = fs.statSync(DB_PATH).size;
const walPath = DB_PATH + "-wal";
const walSize = fs.existsSync(walPath) ? fs.statSync(walPath).size : 0;

db.close();

if (asJson) {
  console.log(JSON.stringify({ path: DB_PATH, dbSize, walSize, stats, markers }, null, 2));
} else {
  const width = Math.max(...Object.keys(stats).map((k) => k.length), ...Object.keys(markers).map((k) => k.length));
  console.log(`\n${DB_PATH}`);
  console.log(`  ${(dbSize / 1024).toFixed(0)} KB + ${(walSize / 1024).toFixed(0)} KB WAL\n`);
  console.log("ROW COUNTS");
  for (const [k, v] of Object.entries(stats)) {
    console.log(`  ${k.padEnd(width)}  ${v === null ? "-  (table does not exist yet)" : v}`);
  }
  console.log("\nMIGRATION STATE");
  for (const [k, v] of Object.entries(markers)) {
    console.log(`  ${k.padEnd(width)}  ${v}`);
  }
  console.log("");
}

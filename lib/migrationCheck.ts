import type Database from "better-sqlite3";

/**
 * Is the database actually migrated far enough to run this build?
 *
 * WHY THIS EXISTS. schema.sql is exec'd on every connection and uses
 * CREATE TABLE IF NOT EXISTS, so a new TABLE appears on an existing database
 * all by itself. A new COLUMN does not — SQLite has no "ADD COLUMN IF NOT
 * EXISTS", and adding one to schema.sql only affects databases created from
 * scratch. So a build can be half-ready: its new tables exist, its new columns
 * do not, and the first page that selects one throws.
 *
 * That is exactly what happened on Jonathan's first run of the readiness
 * build. `subsystem_gates` was there, `subsystems.part_list_declared_complete`
 * was not, and the dashboard answered with "Application error: a server-side
 * exception has occurred. Digest: 1434883904" — which tells him nothing, does
 * not say which migration is missing, and looks exactly like data loss.
 *
 * The check runs at boot and on /api/health. A missing migration should name
 * the script that fixes it, in the first ten seconds, not send somebody reading
 * container logs for a digest.
 */

export interface MigrationGap {
  /** The script to run, e.g. "migrate-readiness.ts". */
  script: string;
  /** What is missing, in the form a person can verify themselves. */
  missing: string[];
}

/** column -> table pairs each migration is responsible for adding. */
const REQUIRED: Array<{ script: string; table: string; column: string }> = [
  { script: "migrate-v2.ts", table: "parts", column: "governing_rule" },
  { script: "migrate-v2.ts", table: "parts", column: "design_status" },
  { script: "migrate-v2.ts", table: "subsystems", column: "code" },
  { script: "migrate-security.ts", table: "users", column: "password_changed_at" },
  { script: "migrate-readiness.ts", table: "subsystems", column: "part_list_declared_complete" },
  { script: "migrate-readiness.ts", table: "interfaces", column: "agreed_by_a" },
  { script: "migrate-readiness.ts", table: "interfaces", column: "agreed_by_b" }
];

/**
 * Tables are NOT checked here, deliberately. schema.sql creates them on every
 * boot, so a missing table means something far stranger than a skipped
 * migration and a misleading "run migrate-x" would send somebody the wrong way.
 */
export function findMigrationGaps(db: Database.Database): MigrationGap[] {
  const byScript = new Map<string, string[]>();

  for (const req of REQUIRED) {
    const tableExists = db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`)
      .get(req.table);
    if (!tableExists) continue;

    const cols = db.prepare(`PRAGMA table_info(${req.table})`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === req.column)) {
      const list = byScript.get(req.script) ?? [];
      list.push(`${req.table}.${req.column}`);
      byScript.set(req.script, list);
    }
  }

  return [...byScript.entries()].map(([script, missing]) => ({ script, missing }));
}

/** The message a person should see, with the commands to run. */
export function describeGaps(gaps: MigrationGap[]): string {
  const lines = [
    "This database is not migrated far enough for the code that is running.",
    "",
    "Nothing is lost — some columns this build needs have not been added yet.",
    "schema.sql creates new TABLES on boot but cannot add a COLUMN to a table",
    "that already exists, so a migration still has to be run by hand.",
    "",
    "Run, from the folder holding docker-compose.yml:"
  ];
  for (const g of gaps) {
    lines.push("", `  docker compose run --rm maint npx tsx scripts/${g.script} --commit`);
    lines.push(`      adds: ${g.missing.join(", ")}`);
  }
  lines.push("", "Then:  docker compose restart app");
  return lines.join("\n");
}

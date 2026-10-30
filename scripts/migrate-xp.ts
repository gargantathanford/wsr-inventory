/**
 * XP migration — adds the ledger and shop-presence tables to an existing
 * database.
 *
 * Usage (from the project root):
 *   npx tsx scripts/migrate-xp.ts            # report what would change
 *   npx tsx scripts/migrate-xp.ts --commit   # apply
 *
 * In Docker, pass the command THROUGH the entrypoint so it runs as uid 1001:
 *   docker compose run --rm maint npx tsx scripts/migrate-xp.ts --commit
 * Never with --entrypoint sh; that runs as root and leaves root-owned files in
 * the volume. See RUNBOOK.md.
 *
 * Additive only. Creates tables and indexes, touches no existing row, and is
 * safe to run twice.
 */
import path from "path";
import fs from "fs";
import Database from "better-sqlite3";

const DB_PATH = process.env.WSR_DB_PATH || path.join(process.cwd(), "data", "wsr.db");

const TABLES: Array<{ name: string; sql: string[] }> = [
  {
    name: "xp_events",
    sql: [
      `CREATE TABLE IF NOT EXISTS xp_events (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        points INTEGER NOT NULL CHECK (points >= 0),
        awarded_at TEXT NOT NULL DEFAULT (datetime('now')),
        subsystem_id TEXT REFERENCES subsystems(id) ON DELETE SET NULL,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        transition TEXT NOT NULL,
        self_verified INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'AWARDED' CHECK (status IN ('PENDING','AWARDED','REVERSED','VOID')),
        approved_by TEXT REFERENCES users(id),
        approved_at TEXT,
        reverses TEXT REFERENCES xp_events(id),
        note TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_xp_user ON xp_events(user_id, awarded_at)`,
      `CREATE INDEX IF NOT EXISTS idx_xp_status ON xp_events(status)`,
      `CREATE INDEX IF NOT EXISTS idx_xp_source ON xp_events(source_type, source_id)`,
      `CREATE INDEX IF NOT EXISTS idx_xp_reverses ON xp_events(reverses)`
    ]
  },
  {
    name: "shop_sessions",
    sql: [
      `CREATE TABLE IF NOT EXISTS shop_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        opened_at TEXT NOT NULL,
        closed_at TEXT,
        open_factors TEXT NOT NULL DEFAULT '[]',
        close_method TEXT CHECK (close_method IS NULL OR close_method IN ('geofence','manual','auto','manual-late')),
        verified_minutes INTEGER NOT NULL DEFAULT 0,
        unverified_minutes INTEGER NOT NULL DEFAULT 0,
        state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','settled','void')),
        witness_user_id TEXT REFERENCES users(id),
        corrected_by TEXT REFERENCES users(id),
        correction_note TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_shop_user ON shop_sessions(user_id, opened_at)`,
      `CREATE INDEX IF NOT EXISTS idx_shop_state ON shop_sessions(state)`
    ]
  },
  {
    name: "shop_heartbeats",
    sql: [
      // Deliberately holds no raw coordinates — only whether a heartbeat was
      // inside the geofence, how accurate it was, and when. If someone later
      // asks for the coordinates, the schema does not have them.
      `CREATE TABLE IF NOT EXISTS shop_heartbeats (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES shop_sessions(id) ON DELETE CASCADE,
        inside_geofence INTEGER NOT NULL,
        accuracy REAL,
        at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_heartbeat_session ON shop_heartbeats(session_id, at)`
    ]
  }
];

function main() {
  const commit = process.argv.includes("--commit");
  if (!fs.existsSync(DB_PATH)) {
    console.error(`No database at ${DB_PATH}.`);
    process.exit(1);
  }

  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");

  const exists = (t: string) =>
    !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).get(t);

  const pending = TABLES.filter((t) => !exists(t.name));

  console.log(`database : ${DB_PATH}`);
  console.log(`mode     : ${commit ? "COMMIT" : "DRY RUN (nothing written)"}`);
  console.log(`tables   : ${TABLES.length} total, ${TABLES.length - pending.length} present, ${pending.length} to create`);
  for (const t of pending) console.log(`  + ${t.name}`);

  if (!commit) {
    console.log(`\nDry run complete. Re-run with --commit to apply.`);
    db.close();
    return;
  }

  let created = 0;
  db.transaction(() => {
    for (const t of pending) {
      for (const sql of t.sql) db.exec(sql);
      created++;
      console.log(`  created ${t.name}`);
    }
    // Indexes are IF NOT EXISTS, so re-apply them for tables that already
    // existed without them.
    for (const t of TABLES) for (const sql of t.sql.slice(1)) db.exec(sql);
  })();

  console.log(`\ntables created : ${created}`);
  console.log(`xp_events rows : ${(db.prepare(`SELECT COUNT(*) c FROM xp_events`).get() as any).c}`);
  console.log(`\nMigration complete. No existing row was modified.`);
  db.close();
}

main();

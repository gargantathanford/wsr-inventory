/**
 * Security migration — password_changed_at, and the setup-token table.
 *
 *   npx tsx scripts/migrate-security.ts
 *   npx tsx scripts/migrate-security.ts --commit
 *
 * In Docker, pass the command THROUGH the entrypoint so it runs as uid 1001:
 *   docker compose run --rm maint npx tsx scripts/migrate-security.ts --commit
 * Never with --entrypoint sh. See RUNBOOK.md.
 *
 * Additive only. Existing rows are untouched, and password_changed_at is left
 * NULL for everyone — a NULL means "no password change recorded", which keeps
 * every current session valid rather than signing the whole team out the
 * moment this lands.
 */
import path from "path";
import fs from "fs";
import Database from "better-sqlite3";

const DB_PATH = process.env.WSR_DB_PATH || path.join(process.cwd(), "data", "wsr.db");

function main() {
  const commit = process.argv.includes("--commit");
  if (!fs.existsSync(DB_PATH)) {
    console.error(`No database at ${DB_PATH}.`);
    process.exit(1);
  }
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");

  const hasColumn = (t: string, c: string) =>
    (db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).some((x) => x.name === c);
  const hasTable = (t: string) =>
    !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).get(t);

  const steps: Array<{ label: string; done: boolean; sql: string[] }> = [
    {
      label: "users.password_changed_at",
      done: hasColumn("users", "password_changed_at"),
      sql: [`ALTER TABLE users ADD COLUMN password_changed_at TEXT`]
    },
    {
      label: "table: account_setup_tokens",
      done: hasTable("account_setup_tokens"),
      sql: [
        // Only the HASH of the token is stored. A leaked database backup must
        // not hand somebody a working set of account-takeover links.
        `CREATE TABLE IF NOT EXISTS account_setup_tokens (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL UNIQUE,
          purpose TEXT NOT NULL DEFAULT 'SETUP' CHECK (purpose IN ('SETUP','RESET')),
          expires_at TEXT NOT NULL,
          used_at TEXT,
          created_by TEXT REFERENCES users(id),
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`,
        `CREATE INDEX IF NOT EXISTS idx_setup_tokens_user ON account_setup_tokens(user_id, used_at)`
      ]
    }
  ];

  const pending = steps.filter((s) => !s.done);
  console.log(`database : ${DB_PATH}`);
  console.log(`mode     : ${commit ? "COMMIT" : "DRY RUN (nothing written)"}`);
  console.log(`steps    : ${steps.length} total, ${steps.length - pending.length} applied, ${pending.length} pending`);
  for (const s of pending) console.log(`  + ${s.label}`);

  if (!commit) {
    console.log(`\nDry run complete. Re-run with --commit to apply.`);
    db.close();
    return;
  }

  db.transaction(() => {
    for (const s of pending) {
      for (const sql of s.sql) db.exec(sql);
      console.log(`  applied ${s.label}`);
    }
  })();

  const users = (db.prepare(`SELECT COUNT(*) c FROM users`).get() as any).c;
  const noPassword = (db.prepare(`SELECT COUNT(*) c FROM users WHERE password_hash = ''`).get() as any).c;
  console.log(`\nsteps applied : ${pending.length}`);
  console.log(`users         : ${users} (${noPassword} awaiting a setup link)`);
  console.log(`\npassword_changed_at left NULL for everyone, so current sessions stay valid.`);
  db.close();
}

main();

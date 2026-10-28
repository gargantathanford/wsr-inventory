import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_PATH = path.join(process.cwd(), "data", "wsr.db");
const SCHEMA_PATH = path.join(process.cwd(), "lib", "schema.sql");

declare global {
  // eslint-disable-next-line no-var
  var __wsrDb: Database.Database | undefined;
}

function createConnection(): Database.Database {
  // `new Database(path)` CREATES the file when it is missing, and the schema
  // uses CREATE TABLE IF NOT EXISTS, so an empty data volume silently produces
  // a complete, zero-row database. Every table exists, every query succeeds,
  // and the only symptom is that nobody can log in. In production that is
  // almost always a destroyed or re-pointed volume, not a first run — so say
  // so, loudly, instead of papering over it with a fresh empty database.
  const existedBefore = fs.existsSync(DB_PATH);
  if (!existedBefore && process.env.NODE_ENV === "production" && process.env.WSR_ALLOW_DB_CREATE !== "1") {
    throw new Error(
      `No database at ${DB_PATH} and NODE_ENV=production.\n` +
        `Refusing to create an empty one — this usually means the data volume is ` +
        `missing, was destroyed (docker compose down -v), or the compose project ` +
        `name changed so a different volume got mounted.\n` +
        `  - Restore a backup:  npx tsx scripts/restore.ts <timestamp>\n` +
        `  - Or, if this really is a first run, initialize it:  npm run seed:prod\n` +
        `  - To override deliberately, set WSR_ALLOW_DB_CREATE=1`
    );
  }

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const schema = fs.readFileSync(SCHEMA_PATH, "utf-8");
  db.exec(schema);
  return db;
}

/**
 * Health detail for /api/health. A database that answers SELECT 1 is not
 * necessarily a database anyone can use: an empty one answers it happily. The
 * user count is the cheapest signal that distinguishes "running" from
 * "running against the wrong volume".
 */
export function getDbHealth(): { ok: boolean; users: number; subsystems: number; parts: number } {
  const db = getDb();
  const one = (sql: string): number => (db.prepare(sql).get() as { c: number }).c;
  const users = one(`SELECT COUNT(*) c FROM users`);
  return {
    // Zero users means nobody can sign in. That is not healthy, whatever
    // SELECT 1 says, so the endpoint reports it as a failure.
    ok: users > 0,
    users,
    subsystems: one(`SELECT COUNT(*) c FROM subsystems`),
    parts: one(`SELECT COUNT(*) c FROM parts`)
  };
}

export function getDb(): Database.Database {
  if (!global.__wsrDb) {
    global.__wsrDb = createConnection();
  }
  return global.__wsrDb;
}

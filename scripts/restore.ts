import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

// The app MUST be stopped before running this (Docker: `docker compose stop app`;
// systemd: `sudo systemctl stop wsr-inventory`). Swapping the file under a live
// process that still has the old database open can corrupt it.

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "wsr.db");
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(process.cwd(), "backups");

function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith("wsr-") && f.endsWith(".db"))
    .sort()
    .reverse();
}

async function main() {
  if (process.getuid?.() === 0) {
    console.error("Refusing to run as root — the restored database must be owned by the app user (uid 1001).");
    process.exit(1);
  }

  const arg = process.argv[2];
  if (!arg || arg === "--list") {
    const available = listBackups();
    console.log("Usage: npx tsx scripts/restore.ts <timestamp>");
    console.log("Available backups (newest first):");
    for (const f of available) console.log(`  ${f.slice(4, -3)}`);
    process.exit(available.length ? 0 : 1);
  }

  const dbBackup = path.join(BACKUP_DIR, `wsr-${arg}.db`);
  const uploadsBackup = path.join(BACKUP_DIR, `uploads-${arg}.tar.gz`);

  if (!fs.existsSync(dbBackup)) {
    console.error(`No backup found at ${dbBackup}`);
    process.exit(1);
  }

  // Validate before touching the live database.
  const check = new Database(dbBackup, { readonly: true, fileMustExist: true });
  let integrity: unknown;
  try {
    integrity = check.pragma("integrity_check", { simple: true });
  } finally {
    check.close();
  }
  if (integrity !== "ok") {
    console.error(`Backup ${dbBackup} failed integrity_check: ${String(integrity)} — aborting, nothing changed.`);
    process.exit(1);
  }

  if (fs.existsSync(DB_PATH)) {
    // Online backup rather than a file copy, so any committed data still sitting
    // in wsr.db-wal is included. Saved next to the other backups (host-visible in
    // Docker) under a prefix that rotation never deletes.
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const safetyCopy = path.join(BACKUP_DIR, `pre-restore-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
    const current = new Database(DB_PATH, { fileMustExist: true });
    try {
      await current.backup(safetyCopy);
    } finally {
      current.close();
    }
    const safetyDb = new Database(safetyCopy);
    safetyDb.pragma("journal_mode = DELETE");
    safetyDb.close();
    console.log(`Existing database saved to ${safetyCopy} before overwriting.`);
  }

  // Stage the copy in the same directory so the final rename is atomic, and drop
  // the old -wal/-shm first — a stale WAL must never be replayed onto the restored file.
  const staged = `${DB_PATH}.restoring`;
  fs.copyFileSync(dbBackup, staged);
  for (const ext of ["-wal", "-shm"]) {
    const p = DB_PATH + ext;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  fs.renameSync(staged, DB_PATH);
  console.log(`Database restored from ${dbBackup}.`);

  if (fs.existsSync(uploadsBackup)) {
    execSync(`tar -xzf "${uploadsBackup}" -C "${DATA_DIR}"`);
    console.log(`Uploads restored from ${uploadsBackup}.`);
  } else {
    console.log("No matching uploads archive found for this timestamp — uploads left as-is.");
  }

  console.log("Restore complete. Start the app again now.");
}

main().catch((err) => {
  console.error("Restore failed:", err);
  process.exit(1);
});

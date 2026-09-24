import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

/**
 * Uses better-sqlite3's built-in .backup() API, which performs SQLite's
 * official online backup — safe to run against a live database (including
 * one in WAL mode with concurrent readers/writers), unlike a plain file copy
 * which can capture a torn/inconsistent snapshot mid-write.
 */

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "wsr.db");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(process.cwd(), "backups");
const KEEP_LAST_N = Number(process.env.BACKUP_RETAIN_COUNT || 14);

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function main() {
  // Backups must be owned by the app user (uid 1001 in Docker, via
  // docker-entrypoint.sh). Running as root would leave root-owned files the
  // app user can't later rotate or restore from.
  if (process.getuid?.() === 0) {
    console.error("Refusing to run as root — run via docker-entrypoint.sh (see docker-compose.yml `backup`).");
    process.exit(1);
  }
  if (!fs.existsSync(DB_PATH)) {
    console.error(`No database found at ${DB_PATH} — nothing to back up.`);
    process.exit(1);
  }
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const ts = timestamp();
  const dbBackupPath = path.join(BACKUP_DIR, `wsr-${ts}.db`);
  // Written under a name rotation/restore ignore, and renamed only once it has
  // passed an integrity check — an interrupted run never looks like a real backup.
  const partialPath = path.join(BACKUP_DIR, `.wsr-${ts}.db.partial`);

  console.log(`Backing up database to ${dbBackupPath} ...`);
  const db = new Database(DB_PATH, { readonly: true });
  try {
    await db.backup(partialPath);
  } finally {
    db.close();
  }

  // The backup can land in WAL mode with its own -wal/-shm sidecars. Checkpoint
  // and switch it to a single self-contained file so the backup artifact is
  // exactly one file per snapshot — no sidecar to lose track of during rotation
  // or when copying backups off-host.
  const backupDb = new Database(partialPath);
  let integrity: unknown;
  try {
    backupDb.pragma("journal_mode = DELETE");
    integrity = backupDb.pragma("integrity_check", { simple: true });
  } finally {
    backupDb.close();
  }
  for (const ext of ["-wal", "-shm"]) {
    const sidecar = partialPath + ext;
    if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
  }
  if (integrity !== "ok") {
    fs.unlinkSync(partialPath);
    throw new Error(`integrity_check on the backup failed: ${String(integrity)}`);
  }
  fs.renameSync(partialPath, dbBackupPath);
  console.log("Database backup complete (single-file, WAL checkpointed, integrity_check ok).");

  if (fs.existsSync(UPLOADS_DIR) && fs.readdirSync(UPLOADS_DIR).length > 0) {
    const uploadsArchivePath = path.join(BACKUP_DIR, `uploads-${ts}.tar.gz`);
    console.log(`Archiving uploads to ${uploadsArchivePath} ...`);
    execSync(`tar -czf "${uploadsArchivePath}" -C "${DATA_DIR}" uploads`);
    console.log("Uploads archive complete.");
  } else {
    console.log("No uploads to archive.");
  }

  rotateOldBackups();
  console.log(`Backup finished. Retaining the ${KEEP_LAST_N} most recent backup sets.`);
}

function rotateOldBackups() {
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith("wsr-") && f.endsWith(".db"))
    .sort()
    .reverse(); // newest first (ISO timestamps sort lexicographically)

  const toDelete = files.slice(KEEP_LAST_N);
  for (const file of toDelete) {
    fs.unlinkSync(path.join(BACKUP_DIR, file));
    const ts = file.slice(4, -3);
    const matchingArchive = path.join(BACKUP_DIR, `uploads-${ts}.tar.gz`);
    if (fs.existsSync(matchingArchive)) fs.unlinkSync(matchingArchive);
    console.log(`Rotated out old backup: ${file}`);
  }
}

main().catch((err) => {
  console.error("Backup failed:", err);
  process.exit(1);
});

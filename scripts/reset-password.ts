/**
 * Set a user's password from the command line.
 *
 * Passwords are stored only as bcrypt hashes, so a forgotten one cannot be
 * recovered — it can only be replaced. The in-app routes that change a password
 * require an active session, which is no help when nobody can log in, so this
 * exists for exactly that situation: the first admin's password was lost, or a
 * fresh database needs its admin made usable.
 *
 * Usage (from the project root):
 *   npx tsx scripts/reset-password.ts --list
 *   npx tsx scripts/reset-password.ts --email you@example.org
 *   npx tsx scripts/reset-password.ts --email you@example.org --password 'the new one'
 *
 * With no --password, a strong one is generated and printed ONCE. Nothing
 * recoverable is stored — only the bcrypt hash goes into the database.
 *
 * Prefer letting it generate the password. A password typed on the command line
 * is saved in your shell history; if you must pass one, clear the history
 * afterwards, or put a space before the command when the shell is configured to
 * skip those.
 *
 * This writes to the database directly, so it needs filesystem access to it —
 * which is the access control. Anyone who can run this could read the database
 * anyway.
 */
import path from "path";
import fs from "fs";
import crypto from "crypto";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";

const DB_PATH = process.env.WSR_DB_PATH || path.join(process.cwd(), "data", "wsr.db");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function generatePassword(): string {
  // 20 random bytes, base64url: long enough to be a fine permanent password,
  // short enough to read out once over a phone.
  return crypto.randomBytes(20).toString("base64url");
}

function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`No database at ${DB_PATH}.`);
    process.exit(1);
  }

  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");

  const users = db
    .prepare(`SELECT id, name, email, role, is_active, created_at FROM users ORDER BY created_at`)
    .all() as Array<{
    id: string;
    name: string;
    email: string;
    role: string;
    is_active: number;
    created_at: string;
  }>;

  if (users.length === 0) {
    console.error(
      `This database has no user accounts at all.\n` +
        `That usually means it is a fresh or empty database rather than the one with your data.\n` +
        `  - Check which volume is mounted:   docker volume ls | grep wsr\n` +
        `  - Restore a backup:                npx tsx scripts/restore.ts --list\n` +
        `  - Or initialize it:                ADMIN_EMAIL=you@example.org ADMIN_NAME="Your Name" npm run seed:prod`
    );
    db.close();
    process.exit(1);
  }

  const email = (arg("email") || "").trim().toLowerCase();

  if (process.argv.includes("--list") || !email) {
    console.log(`database : ${DB_PATH}`);
    console.log(`accounts : ${users.length}\n`);
    for (const u of users) {
      console.log(
        `  ${u.email.padEnd(34)} ${u.role.padEnd(15)} ${u.is_active ? "active  " : "DISABLED"} ${u.name}`
      );
    }
    if (!email) {
      console.log(`\nTo set a password:\n  npx tsx scripts/reset-password.ts --email ${users[0].email}`);
    }
    db.close();
    return;
  }

  const user = users.find((u) => u.email.toLowerCase() === email);
  if (!user) {
    console.error(`No account with email "${email}".`);
    console.error(`Known: ${users.map((u) => u.email).join(", ")}`);
    db.close();
    process.exit(1);
  }

  const supplied = arg("password");
  if (supplied != null && supplied.length < 12) {
    console.error(`That password is ${supplied.length} characters. Use at least 12.`);
    db.close();
    process.exit(1);
  }
  const password = supplied ?? generatePassword();

  db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(bcrypt.hashSync(password, 10), user.id);

  // Recorded in the append-only log: an out-of-band password change is exactly
  // the kind of event that should leave a trace.
  db.prepare(
    `INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, details)
     VALUES (?, ?, 'PASSWORD_RESET', 'USER', ?, 'Reset from the command line')`
  ).run(`log_${nanoid(12)}`, user.id, user.id);

  if (!user.is_active) {
    console.log(`\nNote: this account is DISABLED, so the new password will not get them in.`);
    console.log(`Re-enable it in Settings -> Users, or run:`);
    console.log(`  UPDATE users SET is_active = 1 WHERE email = '${user.email}';`);
  }

  console.log(`\n----------------------------------------`);
  console.log(`Password set for ${user.email} (${user.role})`);
  if (supplied == null) {
    console.log(`\n  ${password}\n`);
    console.log(`Shown once. Copy it now — only its hash is stored.`);
  } else {
    console.log(`Used the password you supplied.`);
  }
  console.log(`----------------------------------------`);

  db.close();
}

main();

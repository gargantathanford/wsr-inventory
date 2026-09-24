/**
 * Production seed. Sets up ONLY:
 *   - the database schema
 *   - the real subsystem list (including Ergonomics)
 *   - exactly one admin account, so the real team can log in and take it from there
 *
 * Run this ONCE against a fresh, empty database before the team's first
 * real login. The schema uses CREATE TABLE IF NOT EXISTS, so it will not
 * wipe existing data if run a second time by mistake — but the script itself
 * refuses to proceed if any users already exist, as a second safety net.
 *
 * Usage:
 *   ADMIN_EMAIL=you@warpspeedracing.org ADMIN_NAME="Your Name" npx tsx scripts/seed-production.ts
 *
 * If ADMIN_PASSWORD is not set, a strong random one is generated and printed
 * ONCE to the console — copy it immediately, it is not stored anywhere in
 * recoverable form (only its bcrypt hash goes into the database).
 */
import path from "path";
import fs from "fs";
import crypto from "crypto";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";

const DB_PATH = path.join(process.cwd(), "data", "wsr.db");
const SCHEMA_PATH = path.join(process.cwd(), "lib", "schema.sql");

const id = (prefix: string) => `${prefix}_${nanoid(12)}`;

function generatePassword(): string {
  // 20 random bytes, base64url — long enough to be a fine permanent password,
  // short enough to type once when handing it to the admin out-of-band.
  return crypto.randomBytes(20).toString("base64url");
}

async function main() {
  const adminEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const adminName = (process.env.ADMIN_NAME || "").trim();
  // docker-compose.yml passes these as ${VAR:-} (a required-var check there would
  // break every other compose command), so an empty value is caught here instead.
  const missing = [!adminEmail && "ADMIN_EMAIL", !adminName && "ADMIN_NAME"].filter(Boolean);
  if (missing.length > 0) {
    console.error(
      `\nFATAL: ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not set or empty.\n` +
        "Both are required to create the initial admin account. Run one of:\n" +
        '  ADMIN_EMAIL=you@warpspeedracing.org ADMIN_NAME="Your Name" docker compose run --rm seed\n' +
        '  ADMIN_EMAIL=you@warpspeedracing.org ADMIN_NAME="Your Name" npx tsx scripts/seed-production.ts\n'
    );
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const dbAlreadyExisted = fs.existsSync(DB_PATH);

  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(SCHEMA_PATH, "utf-8"));

  if (dbAlreadyExisted) {
    const existingUserCount = (db.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number }).c;
    if (existingUserCount > 0) {
      console.error(
        `\nRefusing to continue: ${DB_PATH} already has ${existingUserCount} user(s).\n` +
          "This script is only for the very first setup of a fresh database. If you meant\n" +
          "to add another admin, use the app's Settings > User Management once you can log in.\n"
      );
      db.close();
      process.exit(1);
    }
  }

  const subsystemNames = [
    "Powertrain", "Engine", "Intake", "Fuel System", "Cooling", "Exhaust",
    "Drivetrain", "Electrical", "Electronics", "Chassis", "Suspension",
    "Steering", "Brakes", "Aerodynamics", "Vehicle Dynamics", "Ergonomics",
    "Manufacturing", "Testing", "Business", "Sponsorship"
  ];
  const insertSubsystem = db.prepare(
    `INSERT INTO subsystems (id, name, slug, description) VALUES (?, ?, ?, ?)`
  );
  for (const name of subsystemNames) {
    const slug = name.toLowerCase().replace(/\s+/g, "-");
    insertSubsystem.run(id("sub"), name, slug, `${name} subsystem.`);
  }
  console.log(`Created ${subsystemNames.length} subsystems.`);

  const password = process.env.ADMIN_PASSWORD || generatePassword();
  const adminId = id("usr");
  db.prepare(
    `INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, 'ADMIN')`
  ).run(adminId, adminName, adminEmail, bcrypt.hashSync(password, 10));

  db.close();

  console.log("\n----------------------------------------");
  console.log("Production database initialized.");
  console.log(`Admin account: ${adminEmail}`);
  if (!process.env.ADMIN_PASSWORD) {
    console.log(`Password (shown once — copy it now): ${password}`);
  } else {
    console.log("Password: (set via ADMIN_PASSWORD env var)");
  }
  console.log("Log in immediately and change this password, or create your real");
  console.log("account and deactivate this one, via Settings > User Management.");
  console.log("----------------------------------------\n");
}

main();

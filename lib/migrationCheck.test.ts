/**
 * The point of this check is that a half-migrated database says so, in words,
 * instead of answering every page with "Digest: 1434883904".
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { findMigrationGaps, describeGaps } from "./migrationCheck";

const SCHEMA = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");

/** A database built from the current schema, optionally missing some columns. */
function makeDb(strip: Array<[string, RegExp]> = []): Database.Database {
  let sql = SCHEMA;
  for (const [, re] of strip) sql = sql.replace(re, "");
  const db = new Database(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wsr-mc-")), "t.db"));
  db.exec(sql);
  return db;
}

describe("a fully migrated database", () => {
  test("reports no gaps", () => {
    const db = makeDb();
    assert.deepEqual(findMigrationGaps(db), []);
    db.close();
  });
});

describe("the exact failure Jonathan hit", () => {
  test("a missing readiness column is caught and named", () => {
    const db = makeDb([["", /  part_list_declared_complete INTEGER NOT NULL DEFAULT 0,\n/]]);
    const gaps = findMigrationGaps(db);
    db.close();
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].script, "migrate-readiness.ts");
    assert.deepEqual(gaps[0].missing, ["subsystems.part_list_declared_complete"]);
  });

  test("the message names the command, not just the problem", () => {
    const db = makeDb([["", /  part_list_declared_complete INTEGER NOT NULL DEFAULT 0,\n/]]);
    const msg = describeGaps(findMigrationGaps(db));
    db.close();
    assert.match(msg, /docker compose run --rm maint npx tsx scripts\/migrate-readiness\.ts --commit/);
    assert.match(msg, /docker compose restart app/);
    assert.match(msg, /Nothing is lost/, "the first thing to say is that the data is fine");
  });

  test("several missing columns from one migration are grouped into one command", () => {
    const db = makeDb([
      ["", /  part_list_declared_complete INTEGER NOT NULL DEFAULT 0,\n/],
      ["", /  agreed_by_a TEXT REFERENCES users\(id\),\n/],
      ["", /  agreed_by_b TEXT REFERENCES users\(id\),\n/]
    ]);
    const gaps = findMigrationGaps(db);
    db.close();
    assert.equal(gaps.length, 1, "one script, not three lines telling you to run it three times");
    assert.equal(gaps[0].missing.length, 3);
  });

  test("gaps from different migrations are listed separately", () => {
    let sql = SCHEMA
      .replace(/  part_list_declared_complete INTEGER NOT NULL DEFAULT 0,\n/, "")
      // password_changed_at is the LAST column in users, so its preceding
      // comma goes with it or the CREATE TABLE is malformed.
      .replace(/,\n  password_changed_at TEXT\n/, "\n");
    const db = new Database(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wsr-mc-")), "t.db"));
    db.exec(sql);
    const gaps = findMigrationGaps(db);
    db.close();
    assert.equal(gaps.length, 2);
    assert.deepEqual(gaps.map((g) => g.script).sort(), ["migrate-readiness.ts", "migrate-security.ts"]);
  });
});

describe("what the check deliberately does NOT do", () => {
  test("a missing TABLE is not reported as a missing migration", () => {
    // schema.sql creates tables on every boot, so a missing table means
    // something far stranger than a skipped migration — and telling somebody
    // to run migrate-x would send them the wrong way entirely.
    const db = makeDb();
    db.exec(`DROP TABLE interfaces`);
    const gaps = findMigrationGaps(db);
    db.close();
    assert.deepEqual(gaps, [], "absent table is skipped, not blamed on a migration");
  });
});

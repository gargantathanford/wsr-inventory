/**
 * Deletability, against a real database.
 *
 * The important case is the one that used to produce a bodiless 500: a user who
 * has done something. The check must find the references through
 * PRAGMA foreign_key_list rather than a hardcoded list, so a table added later
 * is covered without anyone remembering.
 */
import { test, describe, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "wsr-users-"));
fs.mkdirSync(path.join(WORK, "data"), { recursive: true });
fs.mkdirSync(path.join(WORK, "lib"), { recursive: true });
fs.copyFileSync(path.join(process.cwd(), "lib", "schema.sql"), path.join(WORK, "lib", "schema.sql"));
process.chdir(WORK);

const DB_FILE = path.join(WORK, "data", "wsr.db");
let mod: typeof import("./users");

function seed() {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(DB_FILE + s, { force: true });
  const db = new Database(DB_FILE);
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(WORK, "lib", "schema.sql"), "utf-8"));
  const u = db.prepare(`INSERT INTO users (id,name,email,password_hash,role) VALUES (?,?,?,'h',?)`);
  u.run("u_clean", "Never Used", "clean@x.org", "TEAM_MEMBER");
  u.run("u_busy", "Did Things", "busy@x.org", "TEAM_MEMBER");
  u.run("u_admin", "Admin", "admin@x.org", "ADMIN");
  db.prepare(`INSERT INTO subsystems (id,name,slug) VALUES ('s1','Chassis','chassis')`).run();
  db.close();
  (globalThis as any).__wsrDb = undefined;
}

before(async () => { mod = await import("./users"); });
beforeEach(() => seed());

function write(sql: string, ...args: any[]) {
  const db = new Database(DB_FILE);
  db.pragma("foreign_keys = ON");
  db.prepare(sql).run(...args);
  db.close();
  (globalThis as any).__wsrDb = undefined;
}

describe("a never-used account", () => {
  test("has no references and is deletable", () => {
    const v = mod.canDeleteUser("u_clean");
    assert.equal(v.deletable, true);
    assert.equal(v.reason, null);
    assert.equal(v.references.length, 0);
  });

  test("actually deletes, with foreign keys on", () => {
    const db = new Database(DB_FILE);
    db.pragma("foreign_keys = ON");
    db.prepare(`DELETE FROM users WHERE id = 'u_clean'`).run();
    assert.equal((db.prepare(`SELECT COUNT(*) c FROM users`).get() as any).c, 2);
    db.close();
  });
});

describe("an account that has done something", () => {
  test("a part they entered blocks the delete and is named", () => {
    write(
      `INSERT INTO parts (id,part_name,subsystem_id,quantity_required,quantity_owned,owner_user_id)
       VALUES ('p1','Main hoop','s1',1,0,?)`,
      "u_busy"
    );
    const v = mod.canDeleteUser("u_busy");
    assert.equal(v.deletable, false);
    assert.match(v.reason!, /1 part/);
    assert.match(v.reason!, /Deactivate the account instead/);
  });

  test("the message pluralises and names the biggest attachments", () => {
    for (let i = 0; i < 3; i++) {
      write(
        `INSERT INTO parts (id,part_name,subsystem_id,quantity_required,quantity_owned,owner_user_id)
         VALUES (?,?,?,1,0,?)`,
        "p" + i, "Part " + i, "s1", "u_busy"
      );
    }
    assert.match(mod.canDeleteUser("u_busy").reason!, /3 parts/);
  });

  test("a message they sent blocks it too", () => {
    write(
      `INSERT INTO messages (id,sender_id,channel_type,channel_key,body) VALUES ('m1',?,'DIRECT','u_busy:u_admin','hi')`,
      "u_busy"
    );
    const v = mod.canDeleteUser("u_busy");
    assert.equal(v.deletable, false);
    assert.match(v.reason!, /message/);
  });

  test("the attempted delete would genuinely fail, which is why we check first", () => {
    write(
      `INSERT INTO messages (id,sender_id,channel_type,channel_key,body) VALUES ('m1',?,'DIRECT','u_busy:u_admin','hi')`,
      "u_busy"
    );
    const db = new Database(DB_FILE);
    db.pragma("foreign_keys = ON");
    assert.throws(
      () => db.prepare(`DELETE FROM users WHERE id = 'u_busy'`).run(),
      /FOREIGN KEY constraint failed/
    );
    db.close();
  });
});

describe("references that clean up after themselves are not obstacles", () => {
  test("an ON DELETE CASCADE row does not block the delete", () => {
    // account_setup_tokens.user_id is ON DELETE CASCADE, so an outstanding
    // setup link must not make a never-used invite undeletable — that is the
    // single most likely account anyone ever wants to remove.
    write(
      `INSERT INTO account_setup_tokens (id,user_id,token_hash,expires_at) VALUES ('t1',?,'hash','2030-01-01')`,
      "u_clean"
    );
    const v = mod.canDeleteUser("u_clean");
    assert.equal(v.deletable, true, "a pending invite is not work done");
  });
});

describe("the scan is discovered, not hardcoded", () => {
  test("a brand new table referencing users is covered automatically", () => {
    const db = new Database(DB_FILE);
    db.pragma("foreign_keys = ON");
    db.exec(`CREATE TABLE invented_later (
      id TEXT PRIMARY KEY, author_id TEXT REFERENCES users(id)
    )`);
    db.prepare(`INSERT INTO invented_later (id, author_id) VALUES ('x', 'u_clean')`).run();
    db.close();
    (globalThis as any).__wsrDb = undefined;

    const v = mod.canDeleteUser("u_clean");
    assert.equal(v.deletable, false, "nobody had to add this table to a list");
    assert.ok(v.references.some((r) => r.table === "invented_later"));
  });
});

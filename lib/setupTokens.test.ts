/**
 * Setup-token tests, against a real database built from the real schema.
 *
 * The cases that matter are the ones where a token should STOP working:
 * reused, expired, revoked by reissue, or raced by two concurrent submissions.
 */
import { test, describe, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import Database from "better-sqlite3";

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "wsr-sut-"));
fs.mkdirSync(path.join(WORK, "data"), { recursive: true });
fs.mkdirSync(path.join(WORK, "lib"), { recursive: true });
fs.copyFileSync(path.join(process.cwd(), "lib", "schema.sql"), path.join(WORK, "lib", "schema.sql"));
process.chdir(WORK);

const DB_FILE = path.join(WORK, "data", "wsr.db");
let mod: typeof import("./setupTokens");

function seed() {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(DB_FILE + s, { force: true });
  const db = new Database(DB_FILE);
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(WORK, "lib", "schema.sql"), "utf-8"));
  // password_hash '' means "created, awaiting setup" — not "blank password".
  db.prepare(`INSERT INTO users (id,name,email,password_hash,role) VALUES ('u_new','Harper','harper@x.org','','TEAM_MEMBER')`).run();
  db.prepare(`INSERT INTO users (id,name,email,password_hash,role) VALUES ('u_admin','Jonathan','j@x.org','hash','ADMIN')`).run();
  db.close();
  (globalThis as any).__wsrDb = undefined;
}

before(async () => {
  mod = await import("./setupTokens");
});
beforeEach(() => seed());

describe("issuing", () => {
  test("returns a raw token and a link path", () => {
    const t = mod.issueSetupToken("u_new", "u_admin");
    assert.ok(t.token.length >= 40, "256 bits base64url");
    assert.equal(t.path, `/setup/${t.token}`);
    assert.ok(new Date(t.expiresAt).getTime() > Date.now());
  });

  test("stores only the hash, never the token", () => {
    const t = mod.issueSetupToken("u_new", "u_admin");
    const db = new Database(DB_FILE, { readonly: true });
    const row = db.prepare(`SELECT token_hash FROM account_setup_tokens`).get() as { token_hash: string };
    db.close();
    assert.notEqual(row.token_hash, t.token, "the raw token must not be in the database");
    assert.equal(row.token_hash, crypto.createHash("sha256").update(t.token).digest("hex"));
  });

  test("reissuing revokes the previous link", () => {
    const first = mod.issueSetupToken("u_new", "u_admin");
    const second = mod.issueSetupToken("u_new", "u_admin");
    assert.equal(mod.checkSetupToken(first.token).valid, false, "a link sent to the wrong person is revocable");
    assert.equal(mod.checkSetupToken(second.token).valid, true);
  });
});

describe("validation", () => {
  test("a fresh token resolves to its user", () => {
    const t = mod.issueSetupToken("u_new", "u_admin");
    const c = mod.checkSetupToken(t.token);
    assert.equal(c.valid, true);
    assert.ok(c.valid && c.email === "harper@x.org" && c.name === "Harper");
  });

  test("an unknown token is rejected with a reason", () => {
    const c = mod.checkSetupToken("not-a-real-token");
    assert.equal(c.valid, false);
    assert.ok(!c.valid && c.reason === "unknown");
  });

  test("an expired token is rejected as expired, not unknown", () => {
    const t = mod.issueSetupToken("u_new", "u_admin");
    const db = new Database(DB_FILE);
    db.prepare(`UPDATE account_setup_tokens SET expires_at = ?`).run(new Date(Date.now() - 1000).toISOString());
    db.close();
    (globalThis as any).__wsrDb = undefined;
    const c = mod.checkSetupToken(t.token);
    assert.equal(c.valid, false);
    assert.ok(!c.valid && c.reason === "expired", "the page can say so instead of a generic error");
  });

  test("checking does not consume", () => {
    const t = mod.issueSetupToken("u_new", "u_admin");
    mod.checkSetupToken(t.token);
    mod.checkSetupToken(t.token);
    assert.equal(mod.checkSetupToken(t.token).valid, true);
  });
});

describe("consuming", () => {
  test("sets the password and marks the token used", () => {
    const t = mod.issueSetupToken("u_new", "u_admin");
    assert.equal(mod.consumeSetupToken(t.token, "bcrypt-hash-here"), true);

    const db = new Database(DB_FILE, { readonly: true });
    const u = db.prepare(`SELECT password_hash, password_changed_at FROM users WHERE id='u_new'`).get() as any;
    const tok = db.prepare(`SELECT used_at FROM account_setup_tokens`).get() as any;
    db.close();
    assert.equal(u.password_hash, "bcrypt-hash-here");
    assert.ok(u.password_changed_at, "setting a password retires any prior session");
    assert.ok(tok.used_at);
  });

  test("a token works exactly once", () => {
    const t = mod.issueSetupToken("u_new", "u_admin");
    assert.equal(mod.consumeSetupToken(t.token, "first-hash"), true);
    assert.equal(mod.consumeSetupToken(t.token, "second-hash"), false);

    const db = new Database(DB_FILE, { readonly: true });
    const u = db.prepare(`SELECT password_hash FROM users WHERE id='u_new'`).get() as any;
    db.close();
    assert.equal(u.password_hash, "first-hash", "the second attempt must not overwrite");
  });

  test("a used token reports used, not unknown", () => {
    const t = mod.issueSetupToken("u_new", "u_admin");
    mod.consumeSetupToken(t.token, "h");
    const c = mod.checkSetupToken(t.token);
    assert.ok(!c.valid && c.reason === "used");
  });

  test("an expired token cannot be consumed", () => {
    const t = mod.issueSetupToken("u_new", "u_admin");
    const db = new Database(DB_FILE);
    db.prepare(`UPDATE account_setup_tokens SET expires_at = ?`).run(new Date(Date.now() - 1000).toISOString());
    db.close();
    (globalThis as any).__wsrDb = undefined;
    assert.equal(mod.consumeSetupToken(t.token, "h"), false);
  });

  test("a revoked token cannot be consumed", () => {
    const first = mod.issueSetupToken("u_new", "u_admin");
    mod.issueSetupToken("u_new", "u_admin");
    assert.equal(mod.consumeSetupToken(first.token, "h"), false);
  });
});

describe("pending setups", () => {
  test("lists accounts with no password yet", () => {
    const pending = mod.getPendingSetups();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].email, "harper@x.org");
    assert.equal(pending[0].link_expires_at, null, "no link issued yet");
  });

  test("shows when an outstanding link expires", () => {
    mod.issueSetupToken("u_new", "u_admin");
    assert.ok(mod.getPendingSetups()[0].link_expires_at);
  });

  test("drops off the list once the password is set", () => {
    const t = mod.issueSetupToken("u_new", "u_admin");
    mod.consumeSetupToken(t.token, "h");
    assert.equal(mod.getPendingSetups().length, 0);
  });
});

describe("an account awaiting setup cannot be logged into", () => {
  test("bcrypt rejects every input against an empty hash", async () => {
    const bcrypt = (await import("bcryptjs")).default;
    // This is what makes password_hash='' safe as the "awaiting setup" marker:
    // it is not a blank password anyone can log in with.
    for (const attempt of ["", " ", "password", "harper"]) {
      assert.equal(bcrypt.compareSync(attempt, ""), false, `"${attempt}" must not authenticate`);
    }
  });
});

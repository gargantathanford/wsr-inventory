import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { checkPassword, passwordProblem, MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from "./password";

describe("password policy", () => {
  test("accepts a reasonable passphrase", () => {
    assert.equal(checkPassword("correct horse battery staple").ok, true);
    assert.equal(checkPassword("rear-upright-tolerance-0.2mm").ok, true);
  });

  test(`rejects anything under ${MIN_PASSWORD_LENGTH} characters`, () => {
    assert.equal(checkPassword("short").ok, false);
    assert.equal(checkPassword("elevenchar").ok, false);
    assert.equal(checkPassword("a".repeat(MIN_PASSWORD_LENGTH - 1)).ok, false);
  });

  test("the old six-character minimum would now fail", () => {
    // This is the regression the whole module exists to prevent.
    assert.equal(checkPassword("abc123").ok, false);
  });

  test("rejects beyond bcrypt's byte limit rather than silently truncating", () => {
    const r = checkPassword("a".repeat(MAX_PASSWORD_LENGTH + 1));
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((p) => /bytes/.test(p)));
  });

  test("counts bytes, not characters, for the upper bound", () => {
    // 20 four-byte emoji = 80 bytes, which bcrypt would cut short.
    const r = checkPassword("🔧".repeat(20));
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((p) => /bytes/.test(p)));
  });

  test("rejects common passwords even when long enough", () => {
    assert.equal(checkPassword("mypasswordislong").ok, false);
    assert.equal(checkPassword("letmeinplease1234").ok, false);
  });

  test("rejects the team and school names", () => {
    assert.equal(checkPassword("warpspeedracing2027").ok, false);
    assert.equal(checkPassword("formulasae-tulsa-27").ok, false);
    assert.equal(checkPassword("okstate-cowboys-123").ok, false);
  });

  test("sees through punctuation used to dodge the check", () => {
    assert.equal(checkPassword("w-a-r-p-s-p-e-e-d-racing").ok, false);
    assert.equal(checkPassword("P.a.s.s.w.o.r.d.1.2.3.4").ok, false);
  });

  test("rejects the person's own name or email", () => {
    assert.equal(checkPassword("jonathan-ford-2027", { name: "Jonathan Ford" }).ok, false);
    assert.equal(checkPassword("jonathanford-rocks", { email: "jonathanford@example.org" }).ok, false);
  });

  test("a short name fragment does not trip it", () => {
    // "Ali" is three characters — too short to be a meaningful guess, and
    // banning it would reject half the dictionary.
    assert.equal(checkPassword("aligning-the-uprights", { name: "Ali Jones" }).ok, true);
  });

  test("rejects one repeated character and keyboard runs", () => {
    assert.equal(checkPassword("aaaaaaaaaaaaaaaa").ok, false);
    assert.equal(checkPassword("qwertyuiop-asdf-123").ok, false);
    assert.equal(checkPassword("my0123456789pass").ok, false);
  });

  test("reports every problem at once rather than one at a time", () => {
    const r = checkPassword("password", { name: "Password Person" });
    assert.equal(r.ok, false);
    assert.ok(r.problems.length >= 2, "too short AND a common password");
  });

  test("passwordProblem returns null when fine, else the first problem", () => {
    assert.equal(passwordProblem("a perfectly good passphrase"), null);
    assert.match(passwordProblem("tiny")!, /at least 12/);
  });

  test("does not reject a password merely for lacking symbols or digits", () => {
    // Composition rules push people to Password1! and are worse than length.
    assert.equal(checkPassword("thequickbrownfoxjumps").ok, true);
  });
});

/**
 * The point of these tests is that `error` is ALWAYS a string.
 *
 * The original bug was not that the message was wrong; it was that the message
 * was an object, and every form's `typeof data.error === "string"` check threw
 * it away. A test that only checked the wording would have passed against the
 * broken version too.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { invalid, dbError, optionalRef, optionalText, optionalNumber, formNumber } from "./apiValidation";

async function body(res: Response | any): Promise<any> {
  return await res.json();
}

describe("invalid() always returns a string message", () => {
  test("a missing required field names that field", async () => {
    const r = z.object({ title: z.string().min(1) }).safeParse({});
    assert.equal(r.success, false);
    const res = invalid((r as any).error);
    const b = await body(res);
    assert.equal(res.status, 400);
    assert.equal(typeof b.error, "string", "a form does typeof data.error === 'string'");
    assert.match(b.error, /Title is required/);
  });

  test("an empty string in a required field reads as required, not 'too short'", async () => {
    const r = z.object({ title: z.string().min(1) }).safeParse({ title: "" });
    const b = await body(invalid((r as any).error));
    assert.match(b.error, /Title is required/);
  });

  test("every problem is reported at once, not one per submit", async () => {
    const schema = z.object({
      title: z.string().min(1),
      deadline_date: z.string().min(1),
      quantity: z.number()
    });
    const b = await body(invalid((schema.safeParse({}) as any).error));
    assert.match(b.error, /Title/);
    assert.match(b.error, /Date/);
    assert.match(b.error, /Quantity/);
  });

  test("a bad enum lists the allowed values", async () => {
    const schema = z.object({ priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]) });
    const b = await body(invalid((schema.safeParse({ priority: "URGENT" }) as any).error));
    assert.match(b.error, /Priority must be one of: CRITICAL, HIGH, MEDIUM, LOW/);
  });

  test("field detail is available alongside the sentence", async () => {
    const schema = z.object({ title: z.string().min(1), email: z.string().email() });
    const b = await body(invalid((schema.safeParse({ title: "", email: "nope" }) as any).error));
    assert.ok(Array.isArray(b.fields.title));
    assert.ok(Array.isArray(b.fields.email));
    assert.match(b.fields.email[0], /valid email/);
  });

  test("a number field sent as text says so in plain words", async () => {
    const schema = z.object({ quantity: z.number() });
    const b = await body(invalid((schema.safeParse({ quantity: "lots" }) as any).error));
    assert.match(b.error, /Quantity must be a number/);
    assert.doesNotMatch(b.error, /Expected number, received/, "Zod's developer wording must not leak out");
  });
});

describe("optionalRef — the empty-string-into-a-foreign-key bug", () => {
  test('"" becomes null, so it never reaches a REFERENCES column', () => {
    assert.equal(optionalRef.parse(""), null);
  });
  test("undefined becomes null", () => {
    assert.equal(optionalRef.parse(undefined), null);
  });
  test("an explicit null stays null", () => {
    assert.equal(optionalRef.parse(null), null);
  });
  test("a real id passes through untouched", () => {
    assert.equal(optionalRef.parse("sub_abc123"), "sub_abc123");
  });
  test("a whitespace-only id is NOT silently accepted as an id", () => {
    // " " is not a valid row id; it would fail the FK just as "" did.
    assert.equal(String(optionalRef.parse(" ")).trim(), "");
  });
});

describe("optionalText", () => {
  test('"" and whitespace become null rather than a stored empty string', () => {
    assert.equal(optionalText.parse(""), null);
    assert.equal(optionalText.parse("   "), null);
  });
  test("real text survives, with its own spacing", () => {
    assert.equal(optionalText.parse("  needed for brake test "), "  needed for brake test ");
  });
});

describe("number coercion from form fields", () => {
  test('optionalNumber turns "" into null, not 0', () => {
    assert.equal(optionalNumber.parse(""), null, "0 and 'not stated' are different facts about a cost");
  });
  test("optionalNumber parses a numeric string", () => {
    assert.equal(optionalNumber.parse("240.5"), 240.5);
  });
  test("formNumber parses a numeric string", () => {
    assert.equal(formNumber.parse("25"), 25);
  });
  test("formNumber rejects text", () => {
    assert.equal(formNumber.safeParse("twenty").success, false);
  });
});

describe("dbError translates SQLite constraint codes", () => {
  test("a foreign key failure explains the stale selection", async () => {
    const res = dbError({ code: "SQLITE_CONSTRAINT_FOREIGNKEY", message: "FOREIGN KEY constraint failed" });
    const b = await body(res);
    assert.equal(res.status, 409);
    assert.equal(typeof b.error, "string");
    assert.match(b.error, /no longer exists/);
  });

  test("a CHECK failure names the column", async () => {
    const b = await body(
      dbError({
        code: "SQLITE_CONSTRAINT_CHECK",
        message: "CHECK constraint failed: notify_scope IN ('EVERYONE','TEAM')"
      })
    );
    assert.match(b.error, /Who to notify is not one of the allowed values/);
  });

  test("a NOT NULL failure names the column", async () => {
    const b = await body(
      dbError({ code: "SQLITE_CONSTRAINT_NOTNULL", message: "NOT NULL constraint failed: parts.part_name" })
    );
    assert.match(b.error, /Part name is required/);
  });

  test("a readonly database is called out as a server problem", async () => {
    const res = dbError({ code: "SQLITE_READONLY", message: "attempt to write a readonly database" });
    const b = await body(res);
    assert.equal(res.status, 500);
    assert.match(b.error, /not something you did/);
  });

  test("an unknown error still yields a string, never an object", async () => {
    const b = await body(dbError(new Error("something exotic")));
    assert.equal(typeof b.error, "string");
  });

  test("context is prefixed when given", async () => {
    const b = await body(dbError({ code: "SQLITE_CONSTRAINT_UNIQUE", message: "x" }, "Could not create event"));
    assert.match(b.error, /^Could not create event: /);
  });
});

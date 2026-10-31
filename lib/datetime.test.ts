/**
 * The timezone bug, pinned.
 *
 * The symptom was an 11:00 shop session reading as 16:00. These tests use that
 * exact instant, because a test that only proves "some conversion happens"
 * would have passed against the broken code too.
 *
 * October and November instants are both here on purpose: Tulsa is UTC-5 in
 * October and UTC-6 in November, so any fix built on a fixed offset passes one
 * and fails the other.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  parseStamp,
  formatDateTime,
  formatDate,
  formatTime,
  localDayOf,
  daysUntil,
  describeDaysUntil,
  formatDay,
  TEAM_TIMEZONE
} from "./datetime";

describe("parseStamp", () => {
  test("a SQLite stamp is read as UTC, not as local time", () => {
    // datetime('now') writes this shape, and it means UTC. JS reads an
    // unmarked string as local, which is the whole bug.
    const d = parseStamp("2026-10-31 16:00:00")!;
    assert.equal(d.toISOString(), "2026-10-31T16:00:00.000Z");
  });

  test("an ISO stamp with a Z is unchanged", () => {
    const d = parseStamp("2026-10-31T16:00:00.000Z")!;
    assert.equal(d.toISOString(), "2026-10-31T16:00:00.000Z");
  });

  test("both shapes of the same instant agree", () => {
    assert.equal(
      parseStamp("2026-10-31 16:00:00")!.getTime(),
      parseStamp("2026-10-31T16:00:00Z")!.getTime(),
      "whichever function wrote the row must not change what it means"
    );
  });

  test("a stamp with an explicit offset is respected", () => {
    const d = parseStamp("2026-10-31T11:00:00-05:00")!;
    assert.equal(d.toISOString(), "2026-10-31T16:00:00.000Z");
  });

  test("nothing, empty and nonsense all come back null", () => {
    for (const v of [null, undefined, "", "   ", "not a date"]) {
      assert.equal(parseStamp(v as any), null, `${JSON.stringify(v)} should be null`);
    }
  });
});

describe("formatting in the team's timezone", () => {
  test("the reported bug: 16:00 UTC shows as 11:00 AM", () => {
    assert.equal(TEAM_TIMEZONE, "America/Chicago", "default zone");
    assert.equal(formatTime("2026-10-31 16:00:00"), "11:00 AM");
    assert.equal(formatDateTime("2026-10-31 16:00:00"), "Oct 31, 2026, 11:00 AM");
  });

  test("the same wall-clock hour after DST ends is still correct", () => {
    // Nov 15 2026 is CST (UTC-6). 17:00 UTC is 11:00 AM local.
    assert.equal(formatTime("2026-11-15 17:00:00"), "11:00 AM");
    // A fixed -5 offset would say 12:00 PM here.
    assert.notEqual(formatTime("2026-11-15 16:00:00"), "11:00 AM");
  });

  test("late-evening UTC rolls back to the previous local day", () => {
    // 01:30 UTC on Nov 1 is 20:30 on Oct 31 in Tulsa.
    assert.equal(formatDate("2026-11-01 01:30:00"), "Oct 31, 2026");
    assert.equal(localDayOf("2026-11-01 01:30:00"), "2026-10-31");
  });

  test("missing values render as a dash rather than Invalid Date", () => {
    assert.equal(formatDateTime(null), "—");
    assert.equal(formatDate(undefined), "—");
    assert.equal(formatTime(""), "—");
    assert.equal(formatDateTime(null, "never"), "never");
  });
});

describe("formatDay — a date is not an instant", () => {
  test("a due date never moves", () => {
    // The trap: new Date("2026-10-31") is midnight UTC, which is Oct 30 in
    // Tulsa. Pushing a deadline through an instant formatter moves every date
    // in the app a day earlier.
    assert.equal(formatDay("2026-10-31"), "Oct 31, 2026");
    assert.equal(formatDay("2026-01-01"), "Jan 1, 2026");
    assert.equal(formatDay("2026-12-31"), "Dec 31, 2026");
  });

  test("a full timestamp still renders, in the team's zone", () => {
    assert.equal(formatDay("2026-11-01 01:30:00"), "Oct 31, 2026");
  });

  test("missing and malformed values fall back", () => {
    assert.equal(formatDay(null), "—");
    assert.equal(formatDay("2026-13-45"), "—");
    assert.equal(formatDay("", "no date"), "no date");
  });
});

describe("daysUntil", () => {
  test("counts calendar days, not elapsed hours", () => {
    assert.equal(daysUntil("2026-11-11", "2026-10-31"), 11);
    assert.equal(daysUntil("2026-10-31", "2026-10-31"), 0);
    assert.equal(daysUntil("2026-11-01", "2026-10-31"), 1);
  });

  test("counts across the DST boundary without losing a day", () => {
    // Nov 1 2026 is the fall-back. An hours-based count would make this 29.96
    // days and round to 30.
    assert.equal(daysUntil("2026-11-30", "2026-10-31"), 30);
  });

  test("overdue is negative", () => {
    assert.equal(daysUntil("2026-10-28", "2026-10-31"), -3);
  });

  test("a full timestamp is accepted, and a non-date is not", () => {
    assert.equal(daysUntil("2026-11-11T00:00:00Z", "2026-10-31"), 11);
    assert.equal(daysUntil("soon", "2026-10-31"), null);
  });

  test("the words match the number", () => {
    assert.equal(describeDaysUntil(11), "in 11 days");
    assert.equal(describeDaysUntil(1), "tomorrow");
    assert.equal(describeDaysUntil(0), "today");
    assert.equal(describeDaysUntil(-1), "1 day overdue");
    assert.equal(describeDaysUntil(-4), "4 days overdue");
  });
});

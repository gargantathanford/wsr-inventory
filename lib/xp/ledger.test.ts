/**
 * Multiplier windows against the daily cap.
 *
 * The only test here that really matters is "THE CAP STILL BINDS inside a
 * window". If a window can lift somebody past the cap then the window is a
 * farming tool, and the cap was the thing holding the whole XP feature
 * honest.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { prepareAward } from "./ledger";

describe("multiplier windows interact correctly with the daily cap", () => {
  const base = {
    userId: "u1", sourceType: "task", transition: "CLOSED",
    at: "2026-11-07T12:00:00Z", timeZone: "America/Chicago"
  };

  test("a 2x window doubles an ordinary award", () => {
    const r = prepareAward([], { ...base, kind: "tool.returnedOnTime", sourceId: "p1", multiplier: 2 });
    assert.equal(r.ok, true);
    assert.equal((r as any).event.points, 10, "a 5-point event pays 10");
  });

  test("no multiplier pays the base", () => {
    const r = prepareAward([], { ...base, kind: "tool.returnedOnTime", sourceId: "p1" });
    assert.equal((r as any).event.points, 5);
  });

  test("THE CAP STILL BINDS inside a window — this is the whole guard rail", () => {
    // 95 already earned today, so 5 of room left. A 2x award worth 10 must pay
    // 5, not 10: a window must never be a way out of the cap.
    const existing = [
      {
        id: "x", userId: "u1", kind: "tool.returnedOnTime", points: 95,
        at: "2026-11-07T10:00:00Z", subsystemId: null, sourceType: "part",
        sourceId: "p0", transition: "SEED", selfVerified: false,
        status: "AWARDED" as const, reverses: null, note: null
      }
    ];
    const r = prepareAward(existing, { ...base, kind: "tool.returnedOnTime", sourceId: "p1", multiplier: 2 });
    assert.equal(r.ok, true);
    assert.equal((r as any).event.points, 5, "capped, not doubled past the cap");
  });

  test("a window cannot revive a day that is already fully capped", () => {
    const existing = [
      {
        id: "x", userId: "u1", kind: "tool.returnedOnTime", points: 100,
        at: "2026-11-07T10:00:00Z", subsystemId: null, sourceType: "part",
        sourceId: "p0", transition: "SEED", selfVerified: false,
        status: "AWARDED" as const, reverses: null, note: null
      }
    ];
    const r = prepareAward(existing, { ...base, kind: "tool.returnedOnTime", sourceId: "p1", multiplier: 2 });
    assert.equal(r.ok, false);
    assert.equal((r as any).reason, "cap-reached");
  });

  test("self-verified reduction applies BEFORE the multiplier", () => {
    // 5 base, x0.4 self-verified = 2, x2 window = 4. Multiplying first would
    // pay 10 then reduce to 4 — same here, but it diverges with rounding, and
    // the reduction is a statement about the WORK, not about the day.
    const r = prepareAward([], {
      ...base, kind: "tool.returnedOnTime", sourceId: "p1", selfVerified: true, multiplier: 2
    });
    assert.equal((r as any).event.points, 4);
  });

  test("an approval-tier award carries the multiplier into PENDING", () => {
    const r = prepareAward([], { ...base, kind: "part.designFrozen", sourceId: "pr1", multiplier: 2 });
    assert.equal(r.ok, true);
    assert.equal((r as any).event.status, "PENDING");
    assert.ok((r as any).event.points > 0);
  });

  test("a multiplier of 1 or below is ignored rather than reducing an award", () => {
    for (const m of [1, 0.5, 0, -2]) {
      const r = prepareAward([], { ...base, kind: "tool.returnedOnTime", sourceId: "p" + m, multiplier: m });
      assert.equal((r as any).event.points, 5, `multiplier ${m} must not reduce the award`);
    }
  });
});

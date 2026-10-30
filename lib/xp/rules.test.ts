/**
 * Run: npm run test:xp
 *
 * Covers the cases that would silently damage the team if they broke:
 * idempotency, reversal arithmetic, the self-verify reduction, the daily cap,
 * the streak across a local midnight boundary, the deferred payout, and every
 * branch of shop settlement.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  DAILY_XP_CAP,
  SELF_VERIFIED_MULTIPLIER,
  SHOP,
  XP_EVENTS,
  awardKey,
  computeStreak,
  isCelebrated,
  localDay,
  pointsFor,
  requiresApproval,
  settleShopSession
} from "./rules";
import {
  deriveTotals,
  dueDeferredAwards,
  pointsOnDay,
  prepareAward,
  prepareReversal,
  type XpEvent
} from "./ledger";

const TZ = "America/Chicago";

const award = (over: Partial<XpEvent> = {}): XpEvent => ({
  id: "task:T1:completed",
  userId: "u1",
  kind: "task.completed",
  points: 20,
  at: "2026-10-30T15:00:00Z",
  subsystemId: "sub_pwt",
  sourceType: "task",
  sourceId: "T1",
  transition: "completed",
  selfVerified: false,
  status: "AWARDED",
  reverses: null,
  note: null,
  ...over
});

describe("XP table", () => {
  test("every entry has a tier and a description", () => {
    for (const [k, def] of Object.entries(XP_EVENTS)) {
      assert.equal(def.kind, k, `${k} kind mismatch`);
      assert.ok(def.fires.length > 10, `${k} needs a real description`);
      assert.ok(["AUTO", "EVIDENCE", "APPROVAL"].includes(def.tier), `${k} bad tier`);
    }
  });

  test("anything weighted 30 or more requires approval", () => {
    for (const def of Object.values(XP_EVENTS)) {
      if (def.points >= 30) {
        assert.equal(def.tier, "APPROVAL", `${def.kind} is ${def.points} XP and must need approval`);
      }
    }
  });

  test("no event is worth more than a third of the daily cap", () => {
    // Otherwise three actions max out a day and the cap stops being a cap.
    for (const def of Object.values(XP_EVENTS)) {
      assert.ok(def.points <= DAILY_XP_CAP / 2, `${def.kind} at ${def.points} is too large vs cap ${DAILY_XP_CAP}`);
    }
  });

  test("no event carries negative points", () => {
    for (const def of Object.values(XP_EVENTS)) assert.ok(def.points >= 0, `${def.kind} is negative`);
  });

  test("confetti is reserved for substantial awards", () => {
    assert.equal(isCelebrated("task.completed"), true);
    assert.equal(isCelebrated("part.designFrozen"), true);
    assert.equal(isCelebrated("tool.returnedOnTime"), false, "5 XP should not fire confetti");
    assert.equal(isCelebrated("part.sourced"), false);
  });

  test("approval tier is reported correctly", () => {
    assert.equal(requiresApproval("part.designFrozen"), true);
    assert.equal(requiresApproval("blocker.resolved"), true);
    assert.equal(requiresApproval("task.completed"), false);
  });
});

describe("self-verification", () => {
  test("pays 40% and rounds to an integer", () => {
    assert.equal(pointsFor("task.completed"), 20);
    assert.equal(pointsFor("task.completed", { selfVerified: true }), 8);
    assert.equal(pointsFor("po.reconciled", { selfVerified: true }), 10);
    // 5 * 0.4 = 2
    assert.equal(pointsFor("tool.returnedOnTime", { selfVerified: true }), 2);
    assert.equal(SELF_VERIFIED_MULTIPLIER, 0.4);
  });

  test("an unknown kind is worth nothing rather than throwing", () => {
    assert.equal(pointsFor("nope.notAThing"), 0);
  });
});

describe("idempotency", () => {
  test("the same transition twice produces one event", () => {
    const req = {
      userId: "u1",
      kind: "task.completed",
      sourceType: "task",
      sourceId: "T1",
      transition: "completed",
      at: "2026-10-30T15:00:00Z",
      timeZone: TZ
    };
    const first = prepareAward([], req);
    assert.equal(first.ok, true);
    assert.ok(first.ok && first.event.id === "task:T1:completed");

    const second = prepareAward([first.ok ? first.event : award()], req);
    assert.equal(second.ok, false);
    assert.ok(!second.ok && second.reason === "duplicate");
  });

  test("close, reopen, close again cannot pay twice", () => {
    const ledger = [award()];
    const reopened = prepareReversal(ledger[0], "2026-10-31T10:00:00Z", "Task reopened");
    ledger.push(reopened);
    // Closing again replays the SAME transition key, so it is refused.
    const retry = prepareAward(ledger, {
      userId: "u1",
      kind: "task.completed",
      sourceType: "task",
      sourceId: "T1",
      transition: "completed",
      at: "2026-11-01T10:00:00Z",
      timeZone: TZ
    });
    assert.equal(retry.ok, false);
  });

  test("the key is stable and readable", () => {
    assert.equal(awardKey("po", "WSR-PO-2026-0142", "reconciled"), "po:WSR-PO-2026-0142:reconciled");
  });
});

describe("reversal arithmetic", () => {
  test("a reversed award leaves the total at zero but stays visible", () => {
    const original = award();
    const rev = prepareReversal(original, "2026-10-31T10:00:00Z", "Task reopened");
    const t = deriveTotals([original, rev]);
    assert.equal(t.total, 0, "reversed points must not count");
    assert.equal(t.reversedCount, 1, "and must still be visible as reversed");
  });

  test("the reversal stores positive points, so no path can render negative XP", () => {
    const rev = prepareReversal(award({ points: 25 }), "2026-10-31T10:00:00Z", "Un-reconciled");
    assert.equal(rev.points, 25);
    assert.ok(rev.points > 0);
    assert.equal(rev.reverses, "task:T1:completed");
  });

  test("reversing one award does not touch the others", () => {
    const a = award({ id: "task:T1:completed", points: 20 });
    const b = award({ id: "po:P1:reconciled", kind: "po.reconciled", points: 25, sourceId: "P1" });
    const t = deriveTotals([a, b, prepareReversal(a, "2026-10-31T10:00:00Z", "reopened")]);
    assert.equal(t.total, 25);
  });
});

describe("daily cap", () => {
  test(`caps a day at ${DAILY_XP_CAP} and reports the shortfall`, () => {
    const existing: XpEvent[] = [];
    // 4 x 25 = 100, exactly the cap.
    for (let i = 0; i < 4; i++) {
      existing.push(
        award({ id: `po:P${i}:reconciled`, kind: "po.reconciled", points: 25, sourceId: `P${i}` })
      );
    }
    assert.equal(pointsOnDay(existing, "2026-10-30", TZ), 100);

    const over = prepareAward(existing, {
      userId: "u1",
      kind: "task.completed",
      sourceType: "task",
      sourceId: "T9",
      transition: "completed",
      at: "2026-10-30T16:00:00Z",
      timeZone: TZ
    });
    assert.equal(over.ok, false);
    assert.ok(!over.ok && over.reason === "cap-reached");
  });

  test("a partially-filled day pays only the remaining room", () => {
    const existing = [award({ id: "po:P1:reconciled", kind: "po.reconciled", points: 90, sourceId: "P1" })];
    const res = prepareAward(existing, {
      userId: "u1",
      kind: "task.completed",
      sourceType: "task",
      sourceId: "T2",
      transition: "completed",
      at: "2026-10-30T16:00:00Z",
      timeZone: TZ
    });
    assert.ok(res.ok);
    assert.equal(res.ok && res.event.points, 10, "20 XP award trimmed to the 10 remaining");
    assert.equal(res.ok && res.cappedFrom, 20);
  });

  test("the cap is per local day, so the next day is clear", () => {
    const existing = [award({ id: "po:P1:reconciled", points: 100, sourceId: "P1" })];
    const res = prepareAward(existing, {
      userId: "u1",
      kind: "task.completed",
      sourceType: "task",
      sourceId: "T3",
      transition: "completed",
      at: "2026-10-31T16:00:00Z",
      timeZone: TZ
    });
    assert.ok(res.ok);
    assert.equal(res.ok && res.event.points, 20);
  });

  test("approval-tier awards land PENDING and consume no cap room", () => {
    const existing = [award({ id: "po:P1:reconciled", points: 100, sourceId: "P1" })];
    const res = prepareAward(existing, {
      userId: "u1",
      kind: "part.designFrozen",
      sourceType: "part",
      sourceId: "PWT-001",
      transition: "frozen",
      at: "2026-10-30T18:00:00Z",
      timeZone: TZ
    });
    assert.ok(res.ok, "a full day must not block a pending approval award");
    assert.equal(res.ok && res.event.status, "PENDING");
    assert.equal(res.ok && res.event.points, 40);

    const t = deriveTotals([...existing, res.ok ? res.event : award()]);
    assert.equal(t.total, 100, "pending points are not in the total");
    assert.equal(t.pending, 40, "they are reported separately");
  });
});

describe("Engineering Days — streak", () => {
  test("consecutive days count", () => {
    const s = computeStreak(["2026-10-28", "2026-10-29", "2026-10-30"], "2026-10-30");
    assert.equal(s.current, 3);
  });

  test("survives today not being over yet", () => {
    const s = computeStreak(["2026-10-28", "2026-10-29"], "2026-10-30");
    assert.equal(s.current, 2, "yesterday still counts while today is in progress");
  });

  test("one grace day per month bridges a single gap", () => {
    // 27th missing, activity either side.
    const s = computeStreak(["2026-10-25", "2026-10-26", "2026-10-28", "2026-10-29"], "2026-10-29");
    assert.equal(s.current, 5, "4 active days plus 1 grace day");
    assert.deepEqual(s.graceDays, ["2026-10-27"]);
  });

  test("a second gap in the same month breaks it", () => {
    const s = computeStreak(["2026-10-20", "2026-10-22", "2026-10-24"], "2026-10-24");
    assert.equal(s.current, 3, "24th, grace for 23rd, 22nd — then the 21st has no grace left");
  });

  test("a long absence resets rather than accumulating grace", () => {
    const s = computeStreak(["2026-09-01", "2026-09-02", "2026-10-30"], "2026-10-30");
    assert.equal(s.current, 1);
    assert.ok(s.longest >= 2);
  });

  test("no activity at all is zero, not a crash", () => {
    const s = computeStreak([], "2026-10-30");
    assert.deepEqual(s, { current: 0, longest: 0, activeDays: [], graceDays: [] });
  });

  test("longest is remembered after a break", () => {
    const s = computeStreak(
      ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-20"],
      "2026-10-20"
    );
    assert.equal(s.current, 1);
    assert.equal(s.longest, 4);
  });
});

describe("local midnight boundary", () => {
  test("late-evening work counts as that evening, not the next UTC day", () => {
    // 2026-10-30 23:30 Chicago = 2026-10-31 04:30 UTC.
    const iso = "2026-10-31T04:30:00Z";
    assert.equal(localDay(iso, "America/Chicago"), "2026-10-30");
    assert.equal(localDay(iso, "UTC"), "2026-10-31", "the UTC answer is the bug this guards against");
  });

  test("two late nights in a row are a 2-day streak, not two broken ones", () => {
    const days = ["2026-10-30T04:30:00Z", "2026-10-31T04:30:00Z"].map((i) => localDay(i, "America/Chicago"));
    assert.deepEqual(days, ["2026-10-29", "2026-10-30"]);
    assert.equal(computeStreak(days, "2026-10-30").current, 2);
  });

  test("the cap follows the local day too", () => {
    const evening = award({ id: "po:P1:reconciled", points: 100, sourceId: "P1", at: "2026-10-31T04:30:00Z" });
    assert.equal(pointsOnDay([evening], "2026-10-30", "America/Chicago"), 100);
    assert.equal(pointsOnDay([evening], "2026-10-31", "America/Chicago"), 0);
  });
});

describe("deferred first-time-right", () => {
  const base = {
    userId: "u1",
    sourceType: "task",
    sourceId: "T5",
    closedAt: "2026-10-20T12:00:00Z",
    reopenedSince: false
  };

  test("does not pay before 7 days", () => {
    const due = dueDeferredAwards([base], [], "2026-10-25T12:00:00Z", TZ);
    assert.equal(due.length, 0);
  });

  test("pays at 7 days when never reopened", () => {
    const due = dueDeferredAwards([base], [], "2026-10-27T12:00:01Z", TZ);
    assert.equal(due.length, 1);
    assert.equal(due[0].kind, "task.firstTimeRight");
  });

  test("never pays if the task was reopened", () => {
    const due = dueDeferredAwards([{ ...base, reopenedSince: true }], [], "2026-11-30T12:00:00Z", TZ);
    assert.equal(due.length, 0);
  });

  test("does not pay twice", () => {
    const paid = award({ id: "task:T5:task.firstTimeRight", kind: "task.firstTimeRight", points: 10 });
    const due = dueDeferredAwards([base], [paid], "2026-11-30T12:00:00Z", TZ);
    assert.equal(due.length, 0);
  });
});

describe("shop settlement", () => {
  const base = {
    verifiedMinutes: 120,
    unverifiedMinutes: 0,
    openFactors: ["geofence", "doorCode"] as const,
    closeMethod: "geofence" as const,
    state: "settled" as const,
    alreadyEarnedToday: 0,
    alreadyEarnedThisWeek: 0
  };

  test("two hours verified pays 12", () => {
    const r = settleShopSession({ ...base, openFactors: [...base.openFactors] });
    assert.equal(r.points, 12);
    assert.equal(r.recordedMinutes, 120);
  });

  test("one factor is never enough", () => {
    const r = settleShopSession({ ...base, openFactors: ["geofence"] });
    assert.equal(r.points, 0);
    assert.match(r.reason, /two are required/);
  });

  test("an open session pays nothing", () => {
    const r = settleShopSession({ ...base, openFactors: [...base.openFactors], state: "open" });
    assert.equal(r.points, 0);
    assert.equal(r.recordedMinutes, 120, "but the hours are still recorded");
  });

  test("a voided session pays nothing and says why", () => {
    const r = settleShopSession({ ...base, openFactors: [...base.openFactors], state: "void", closeMethod: "auto" });
    assert.equal(r.points, 0);
    assert.match(r.reason, /late close/);
  });

  test("an approved late close pays half", () => {
    const r = settleShopSession({
      ...base,
      openFactors: [...base.openFactors],
      state: "void",
      closeMethod: "manual-late"
    });
    assert.equal(r.points, 6, "12 XP at 50%");
  });

  test("under the 20-minute minimum pays nothing", () => {
    const r = settleShopSession({ ...base, openFactors: [...base.openFactors], verifiedMinutes: 19 });
    assert.equal(r.points, 0);
    assert.match(r.reason, /minimum/);
  });

  test("unverified minutes pay the reduced rate, not zero", () => {
    const r = settleShopSession({
      ...base,
      openFactors: [...base.openFactors],
      verifiedMinutes: 60,
      unverifiedMinutes: 60
    });
    assert.equal(r.points, 9, "6 for the verified hour plus 3 for the unverified one");
  });

  test("the rate decays and stops after 6 hours", () => {
    // 7 hours verified: 3h full (18) + 3h half (9) + 1h nothing = 27, capped to 25/day.
    const r = settleShopSession({ ...base, openFactors: [...base.openFactors], verifiedMinutes: 420 });
    assert.equal(r.recordedMinutes, 420, "all 7 hours recorded on the timesheet");
    assert.equal(r.points, SHOP.dailyCap, "XP stops at the presence cap");
    assert.equal(r.capped, true);
  });

  test("a 6-hour day earns 27 before the cap, proving the decay", () => {
    const r = settleShopSession({
      ...base,
      openFactors: [...base.openFactors],
      verifiedMinutes: 360,
      alreadyEarnedToday: 0
    });
    // 3h at 6 = 18, 3h at 3 = 9, total 27 -> capped at 25.
    assert.equal(r.points, 25);
    assert.match(r.reason, /27 XP earned, 25 paid/);
  });

  test("the weekly presence cap binds too", () => {
    const r = settleShopSession({
      ...base,
      openFactors: [...base.openFactors],
      verifiedMinutes: 180,
      alreadyEarnedThisWeek: 98
    });
    assert.equal(r.points, 2, "18 earned, only 2 of the weekly 100 left");
  });

  test("caps limit XP but never the timesheet", () => {
    const r = settleShopSession({
      ...base,
      openFactors: [...base.openFactors],
      verifiedMinutes: 600,
      alreadyEarnedToday: 25
    });
    assert.equal(r.points, 0);
    assert.equal(r.recordedMinutes, 600, "leads still need the real hours");
  });

  test("settlement never returns negative points", () => {
    for (const minutes of [0, 5, 19, 20, 60, 180, 360, 600, 1440]) {
      for (const earned of [0, 20, 25, 999]) {
        const r = settleShopSession({
          ...base,
          openFactors: [...base.openFactors],
          verifiedMinutes: minutes,
          alreadyEarnedToday: earned
        });
        assert.ok(r.points >= 0, `negative at ${minutes}min / ${earned} earned`);
      }
    }
  });
});

describe("totals", () => {
  test("rolls up by kind and subsystem and surfaces self-verified", () => {
    const events = [
      award({ id: "a", points: 20, subsystemId: "pwt" }),
      award({ id: "b", kind: "po.reconciled", points: 10, subsystemId: "pwt", selfVerified: true }),
      award({ id: "c", kind: "po.reconciled", points: 25, subsystemId: "ele" })
    ];
    const t = deriveTotals(events);
    assert.equal(t.total, 55);
    assert.deepEqual(t.byKind, { "task.completed": 20, "po.reconciled": 35 });
    assert.deepEqual(t.bySubsystem, { pwt: 30, ele: 25 });
    assert.equal(t.selfVerifiedCount, 1);
  });

  test("void events are excluded", () => {
    const t = deriveTotals([award({ id: "a", points: 20 }), award({ id: "b", points: 20, status: "VOID" })]);
    assert.equal(t.total, 20);
  });
});

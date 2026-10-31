import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  RANKS, rankFor, ACHIEVEMENTS, achievementsFor, windowProblem, multiplierAt,
  applyMultiplier, MAX_MULTIPLIER, MAX_WINDOW_HOURS, type AchievementFacts
} from "./ranks";

function facts(over: Partial<AchievementFacts> = {}): AchievementFacts {
  return {
    approvedXp: 0, kinds: new Set(), countByKind: {}, subsystemsTouched: 0,
    longestStreak: 0, reversedCount: 0, selfVerifiedCount: 0,
    gatesEndorsedAndApproved: 0, interfacesAgreedBothSides: 0, shopHours: 0,
    ...over
  };
}

describe("ranks", () => {
  test("thresholds ascend and start at zero", () => {
    assert.equal(RANKS[0].at, 0);
    for (let i = 1; i < RANKS.length; i++) {
      assert.ok(RANKS[i].at > RANKS[i - 1].at, `${RANKS[i].name} must be above ${RANKS[i - 1].name}`);
    }
  });

  test("the gaps widen, so early movement is visible and the top is a season", () => {
    const gaps = RANKS.slice(1).map((r, i) => r.at - RANKS[i].at);
    for (let i = 1; i < gaps.length; i++) {
      assert.ok(gaps[i] >= gaps[i - 1], `gap ${i} (${gaps[i]}) narrowed from ${gaps[i - 1]}`);
    }
  });

  test("zero XP is the first rank, not an error", () => {
    const s = rankFor(0);
    assert.equal(s.rank.name, "Rookie");
    assert.equal(s.bandPct, 0);
  });

  test("standing reports how far to the next rank", () => {
    const s = rankFor(100);
    assert.equal(s.rank.name, "Wrench");
    assert.equal(s.next!.name, "Fabricator");
    assert.equal(s.toNext, 50);
    assert.equal(s.bandPct, 50);
  });

  test("the top rank has no next and reads 100%", () => {
    const s = rankFor(99_999);
    assert.equal(s.next, null);
    assert.equal(s.toNext, 0);
    assert.equal(s.bandPct, 100);
  });

  test("rank never decreases as XP rises", () => {
    let last = -1;
    for (let xp = 0; xp <= 2500; xp += 7) {
      const i = RANKS.findIndex((r) => r.name === rankFor(xp).rank.name);
      assert.ok(i >= last, `rank went backwards at ${xp}`);
      last = i;
    }
  });
});

describe("achievements", () => {
  test("every id is unique", () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test("a brand new member earns nothing and sees no secrets", () => {
    const list = achievementsFor(facts());
    assert.equal(list.filter((a) => a.earned).length, 0);
    assert.equal(list.filter((a) => a.secret).length, 0, "secret achievements stay hidden until earned");
  });

  test("the first approved XP earns First Sign-Off", () => {
    const list = achievementsFor(facts({ approvedXp: 5 }));
    assert.equal(list.find((a) => a.id === "first-blood")!.earned, true);
  });

  test("progress is reported for countable ones", () => {
    const list = achievementsFor(facts({ subsystemsTouched: 2 }));
    assert.equal(list.find((a) => a.id === "generalist")!.progressPct, 50);
  });

  test("Nothing Undone is lost entirely by a single reversal", () => {
    const clean = achievementsFor(facts({ approvedXp: 400 })).find((a) => a.id === "clean-record")!;
    const marked = achievementsFor(facts({ approvedXp: 400, reversedCount: 1 })).find((a) => a.id === "clean-record")!;
    assert.equal(clean.earned, true);
    assert.equal(marked.earned, false);
    assert.equal(marked.progressPct, 0, "it is not partially intact");
  });

  test("Honest Broker needs mostly externally-checked work", () => {
    const mostlySelf = facts({
      approvedXp: 300,
      countByKind: { "task.closedWithEvidence": 10 },
      selfVerifiedCount: 5
    });
    assert.equal(achievementsFor(mostlySelf).some((a) => a.id === "honest-broker"), false);

    const mostlyChecked = facts({
      approvedXp: 300,
      countByKind: { "task.closedWithEvidence": 100 },
      selfVerifiedCount: 2
    });
    assert.equal(
      achievementsFor(mostlyChecked).find((a) => a.id === "honest-broker")!.earned,
      true
    );
  });

  test("earned ones sort first, then the closest to earned", () => {
    const list = achievementsFor(facts({ approvedXp: 10, subsystemsTouched: 3, longestStreak: 1 }));
    assert.equal(list[0].earned, true);
    const unearned = list.filter((a) => !a.earned && a.progressPct !== null);
    for (let i = 1; i < unearned.length; i++) {
      assert.ok((unearned[i - 1].progressPct ?? 0) >= (unearned[i].progressPct ?? 0));
    }
  });

  test("none of them reward raw volume alone", () => {
    // A member with a huge pile of XP and nothing else should not sweep the
    // board — that is the farmable shape this set is designed to avoid.
    const grinder = facts({ approvedXp: 5000 });
    const earned = achievementsFor(grinder).filter((a) => a.earned).map((a) => a.id);
    assert.deepEqual(earned.sort(), ["clean-record", "first-blood"], "volume alone earns almost nothing");
  });
});

describe("multiplier windows", () => {
  const W = (over: any = {}) => ({
    label: "Saturday build day",
    multiplier: 2,
    startsAt: "2026-11-07T09:00:00Z",
    endsAt: "2026-11-07T17:00:00Z",
    ...over
  });

  test("a sensible window is accepted", () => {
    assert.equal(windowProblem(W(), []), null);
  });

  test("an unnamed window is refused", () => {
    assert.match(windowProblem(W({ label: "x" }), [])!.reason, /name people will recognise/);
  });

  test("a multiplier above the ceiling is refused, with the reasoning", () => {
    const p = windowProblem(W({ multiplier: 3 }), [])!;
    assert.match(p.reason, new RegExp(`${MAX_MULTIPLIER}x is the ceiling`));
    assert.match(p.reason, /waiting becomes the smart play/);
  });

  test("a multiplier at or below 1 is refused", () => {
    assert.match(windowProblem(W({ multiplier: 1 }), [])!.reason, /penalise showing up/);
    assert.match(windowProblem(W({ multiplier: 0.5 }), [])!.reason, /penalise showing up/);
  });

  test("a window longer than a shop day is refused", () => {
    const p = windowProblem(W({ endsAt: "2026-11-09T17:00:00Z" }), [])!;
    assert.match(p.reason, new RegExp(`${MAX_WINDOW_HOURS} hours is the longest`));
    assert.match(p.reason, /quietly becomes the new baseline/);
  });

  test("exactly the maximum length is allowed", () => {
    assert.equal(windowProblem(W({ startsAt: "2026-11-07T06:00:00Z", endsAt: "2026-11-07T20:00:00Z" }), []), null);
  });

  test("a backwards window is refused", () => {
    assert.match(windowProblem(W({ endsAt: "2026-11-07T08:00:00Z" }), [])!.reason, /ends before it starts/);
  });

  test("overlapping windows are refused, because they would multiply together", () => {
    const existing = [{ startsAt: "2026-11-07T12:00:00Z", endsAt: "2026-11-07T20:00:00Z" }];
    assert.match(windowProblem(W(), existing)!.reason, /multiply together/);
  });

  test("a window that merely touches the end of another is fine", () => {
    const existing = [{ startsAt: "2026-11-07T01:00:00Z", endsAt: "2026-11-07T09:00:00Z" }];
    assert.equal(windowProblem(W(), existing), null);
  });
});

describe("the multiplier in force", () => {
  const win = {
    id: "w1", label: "Build day", multiplier: 2,
    startsAt: "2026-11-07T09:00:00Z", endsAt: "2026-11-07T17:00:00Z", createdBy: "u1"
  };

  test("inside the window", () => {
    assert.equal(multiplierAt("2026-11-07T12:00:00Z", [win]).multiplier, 2);
  });

  test("outside it, and at the exact end", () => {
    assert.equal(multiplierAt("2026-11-07T18:00:00Z", [win]).multiplier, 1);
    assert.equal(multiplierAt("2026-11-07T17:00:00Z", [win]).multiplier, 1, "end is exclusive");
  });

  test("at the exact start it applies", () => {
    assert.equal(multiplierAt("2026-11-07T09:00:00Z", [win]).multiplier, 2);
  });

  test("overlapping windows take the highest, never the product", () => {
    const other = { ...win, id: "w2", multiplier: 1.5 };
    const m = multiplierAt("2026-11-07T12:00:00Z", [win, other]).multiplier;
    assert.equal(m, 2, "2 and 1.5 must not become 3");
  });

  test("no windows at all is 1, not zero", () => {
    assert.equal(multiplierAt("2026-11-07T12:00:00Z", []).multiplier, 1);
  });
});

describe("applying the multiplier", () => {
  test("doubles a 20-point award", () => {
    assert.equal(applyMultiplier(20, 2), 40);
  });

  test("rounds DOWN, so cheap events do not benefit most", () => {
    assert.equal(applyMultiplier(5, 1.5), 7, "7, not 8");
    assert.equal(applyMultiplier(25, 1.5), 37);
  });

  test("a multiplier of 1 changes nothing", () => {
    assert.equal(applyMultiplier(20, 1), 20);
  });

  test("never reduces an award", () => {
    for (const base of [1, 5, 20, 25, 30]) {
      for (const m of [1, 1.5, 2]) {
        assert.ok(applyMultiplier(base, m) >= base);
      }
    }
  });
});

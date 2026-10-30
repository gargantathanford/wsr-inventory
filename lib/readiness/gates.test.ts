/**
 * The tests that matter are the ones about the OLD metric's failure modes.
 * If the one-owned-part subsystem can still read 100%, nothing has been fixed.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { evaluateGates, readinessFor, rollUp, GATES, type SubsystemFacts, type GateSignOff, type PartFacts } from "./gates";

function part(over: Partial<PartFacts> = {}): PartFacts {
  return {
    id: "p" + Math.random().toString(36).slice(2, 7),
    designStatus: "PLACEHOLDER",
    status: "NEEDED",
    citationCount: 0,
    isManufactured: false,
    isFitted: true,
    ...over
  };
}

function facts(over: Partial<SubsystemFacts> = {}): SubsystemFacts {
  return { partListDeclaredComplete: false, parts: [], testsWithEvidence: 0, ...over };
}

const signed = (gate: any, reason: string | null = null): GateSignOff => ({
  gate,
  decision: "PASSED",
  reason,
  by: "u_lead",
  at: "2026-10-30 12:00:00"
});

const na = (gate: any, reason: string): GateSignOff => ({
  gate,
  decision: "NOT_APPLICABLE",
  reason,
  by: "u_lead",
  at: "2026-10-30 12:00:00"
});

describe("the failure modes of the old part-count metric", () => {
  test("one owned part no longer reads 100%", () => {
    const r = readinessFor(
      facts({ parts: [part({ status: "OWNED", designStatus: "FROZEN" })] }),
      []
    );
    assert.notEqual(r.pct, 100, "this exact case read 100% under the old metric");
    assert.equal(r.pct, 0, "nothing is signed off, so nothing has passed");
  });

  test("entering MORE parts can no longer lower the score", () => {
    // Under the old metric, adding an unstarted part dropped the percentage,
    // so the cheapest way to look good was to stop entering work.
    const one = readinessFor(facts({ parts: [part({ status: "OWNED" })] }), [signed("SCOPED")]);
    const many = readinessFor(
      facts({ parts: [part({ status: "OWNED" }), part(), part(), part()] }),
      [signed("SCOPED")]
    );
    assert.equal(one.pct, many.pct, "the score depends on gates, not on the size of the list");
  });

  test("a subsystem with no parts at all is 0%, not 100%", () => {
    const r = readinessFor(facts(), []);
    assert.equal(r.pct, 0);
  });

  test("buying everything is not completeness on its own", () => {
    const all = [part({ status: "OWNED", designStatus: "FROZEN" }), part({ status: "OWNED", designStatus: "FROZEN" })];
    // Design frozen must be SIGNED, not merely derivable, before Procured can
    // be claimed — a lead should not rubber-stamp "we bought it all" while the
    // design is still officially unfrozen.
    const r = readinessFor(facts({ partListDeclaredComplete: true, parts: all }), [
      signed("SCOPED"),
      signed("DESIGN_FROZEN")
    ]);
    assert.ok(r.pct < 100, "procurement is one gate of seven");
    const procured = r.gates.find((g) => g.gate === "PROCURED")!;
    assert.equal(procured.state, "READY", "the data says procured — but a lead still signs it");
  });
});

describe("SCOPED is the gate that fixes the denominator", () => {
  test("it cannot be derived from part data alone", () => {
    const g = evaluateGates(facts({ parts: [part(), part()] }), []).find((x) => x.gate === "SCOPED")!;
    assert.equal(g.state, "OPEN");
    assert.match(g.detail, /a lead must confirm the list is complete/);
  });

  test("declaring the list complete makes it READY, not PASSED", () => {
    const g = evaluateGates(facts({ partListDeclaredComplete: true, parts: [part()] }), []).find(
      (x) => x.gate === "SCOPED"
    )!;
    assert.equal(g.state, "READY", "a person still has to put their name to it");
  });

  test("everything downstream is BLOCKED until it passes", () => {
    const gs = evaluateGates(facts({ parts: [part({ designStatus: "FROZEN" })] }), []);
    const design = gs.find((g) => g.gate === "DESIGN_FROZEN")!;
    assert.equal(design.state, "BLOCKED");
    assert.match(design.detail, /Waiting on Scoped/);
  });
});

describe("derivation vs sign-off", () => {
  test("data satisfying a gate yields READY, never PASSED", () => {
    const gs = evaluateGates(
      facts({ partListDeclaredComplete: true, parts: [part({ designStatus: "FROZEN" })] }),
      [signed("SCOPED")]
    );
    const d = gs.find((g) => g.gate === "DESIGN_FROZEN")!;
    assert.equal(d.state, "READY");
    assert.match(d.detail, /needs a lead to sign it off/i);
  });

  test("READY does not count toward the percentage", () => {
    const r = readinessFor(
      facts({ partListDeclaredComplete: true, parts: [part({ designStatus: "FROZEN", status: "OWNED" })] }),
      [signed("SCOPED")]
    );
    const ready = r.gates.filter((g) => g.state === "READY");
    assert.ok(ready.length > 0, "some gates are ready");
    assert.equal(r.passed, 1, "only the signed-off SCOPED gate counts");
  });

  test("OPEN states say what is actually left", () => {
    const gs = evaluateGates(
      facts({
        partListDeclaredComplete: true,
        parts: [part({ designStatus: "FROZEN" }), part({ designStatus: "SELECTED" }), part()]
      }),
      [signed("SCOPED")]
    );
    assert.match(gs.find((g) => g.gate === "DESIGN_FROZEN")!.detail, /2 of 3 not frozen yet/);
  });

  test("TESTED can never be derived from part statuses", () => {
    const everything = facts({
      partListDeclaredComplete: true,
      parts: [part({ designStatus: "FROZEN", status: "INSTALLED" })]
    });
    const gs = evaluateGates(everything, [
      signed("SCOPED"), signed("DESIGN_FROZEN"), signed("RULES_CHECKED"),
      signed("PROCURED"), na("MANUFACTURED", "all bought"), signed("INSTALLED")
    ]);
    const t = gs.find((g) => g.gate === "TESTED")!;
    assert.equal(t.state, "OPEN", "installed is not tested");
    assert.match(t.detail, /No test record with evidence yet/);
  });

  test("a recorded test with evidence makes TESTED ready", () => {
    const gs = evaluateGates(
      facts({ partListDeclaredComplete: true, parts: [part({ status: "INSTALLED" })], testsWithEvidence: 1 }),
      [signed("SCOPED"), signed("DESIGN_FROZEN"), signed("RULES_CHECKED"), signed("PROCURED"),
       na("MANUFACTURED", "all bought"), signed("INSTALLED")]
    );
    assert.equal(gs.find((g) => g.gate === "TESTED")!.state, "READY");
  });
});

describe("NOT_APPLICABLE leaves the denominator and does not block", () => {
  test("an out-of-scope gate does not hold the score below 100", () => {
    const all = GATES.map((g) =>
      g.id === "TESTED" ? na("TESTED", "no track time this season") : signed(g.id)
    );
    const r = readinessFor(facts({ partListDeclaredComplete: true, parts: [part()] }), all);
    assert.equal(r.pct, 100);
    assert.equal(r.applicable, 6, "the excluded gate is out of the denominator");
  });

  test("an out-of-scope prerequisite does NOT block what comes after it", () => {
    // Manufacturing marked N/A must not freeze Installed forever.
    const gs = evaluateGates(
      facts({ partListDeclaredComplete: true, parts: [part({ designStatus: "FROZEN", status: "OWNED" })] }),
      [signed("SCOPED"), signed("DESIGN_FROZEN"), signed("PROCURED"), na("MANUFACTURED", "nothing made in-house")]
    );
    const installed = gs.find((g) => g.gate === "INSTALLED")!;
    assert.notEqual(installed.state, "BLOCKED", "N/A is settled, just not by passing");
  });

  test("it requires a reason, which is carried into the detail", () => {
    const gs = evaluateGates(facts(), [na("TESTED", "no track time this season")]);
    const t = gs.find((g) => g.gate === "TESTED")!;
    assert.equal(t.state, "NOT_APPLICABLE");
    assert.match(t.detail, /Out of scope: no track time this season/);
  });

  test("every gate out of scope is 100%, not a division by zero", () => {
    const r = readinessFor(facts(), GATES.map((g) => na(g.id, "year one")));
    assert.equal(r.pct, 100);
    assert.equal(r.applicable, 0);
    assert.equal(r.next, null);
  });
});

describe("retired parts do not hold gates open forever", () => {
  test("NO_LONGER_NEEDED is excluded from every gate", () => {
    const gs = evaluateGates(
      facts({
        partListDeclaredComplete: true,
        parts: [part({ designStatus: "FROZEN", status: "OWNED" }), part({ status: "NO_LONGER_NEEDED" })]
      }),
      [signed("SCOPED")]
    );
    assert.equal(gs.find((g) => g.gate === "DESIGN_FROZEN")!.state, "READY");
  });
});

describe("manufactured vs bought parts are gated separately", () => {
  test("a subsystem that makes nothing derives MANUFACTURED as not-applicable", () => {
    const gs = evaluateGates(
      facts({ partListDeclaredComplete: true, parts: [part({ designStatus: "FROZEN", status: "OWNED" })] }),
      [signed("SCOPED"), signed("DESIGN_FROZEN")]
    );
    const m = gs.find((g) => g.gate === "MANUFACTURED")!;
    assert.equal(m.state, "OPEN");
    // The message must name the action, not just report absence.
    assert.match(m.detail, /Nothing in this subsystem is made in-house/);
    assert.match(m.detail, /mark out of scope/);
  });

  test("an unfinished made part blocks MANUFACTURED but not PROCURED", () => {
    const gs = evaluateGates(
      facts({
        partListDeclaredComplete: true,
        parts: [
          part({ designStatus: "FROZEN", status: "OWNED", isManufactured: false }),
          part({ designStatus: "FROZEN", status: "MANUFACTURING", isManufactured: true })
        ]
      }),
      [signed("SCOPED"), signed("DESIGN_FROZEN")]
    );
    assert.equal(gs.find((g) => g.gate === "PROCURED")!.state, "READY");
    assert.equal(gs.find((g) => g.gate === "MANUFACTURED")!.state, "OPEN");
    assert.match(gs.find((g) => g.gate === "MANUFACTURED")!.detail, /1 of 1 made parts not finished/);
  });
});

describe("unfitted parts are not expected on the car", () => {
  test("a spare does not hold INSTALLED open", () => {
    const gs = evaluateGates(
      facts({
        partListDeclaredComplete: true,
        parts: [
          part({ designStatus: "FROZEN", status: "INSTALLED", isFitted: true }),
          part({ designStatus: "FROZEN", status: "OWNED", isFitted: false })
        ]
      }),
      [signed("SCOPED"), signed("DESIGN_FROZEN"), signed("PROCURED"), na("MANUFACTURED", "bought")]
    );
    assert.equal(gs.find((g) => g.gate === "INSTALLED")!.state, "READY");
  });
});

describe("next gate points a lead at one thing", () => {
  test("READY outranks OPEN, because a signature is the cheapest next action", () => {
    const r = readinessFor(
      facts({ partListDeclaredComplete: true, parts: [part({ designStatus: "FROZEN" })] }),
      []
    );
    assert.equal(r.next!.gate, "SCOPED");
    assert.equal(r.next!.state, "READY");
  });

  test("null once everything applicable has passed AND the data still agrees", () => {
    // The facts have to genuinely support every gate. Signing all seven over a
    // subsystem of placeholder parts now (correctly) flags stale instead.
    const r = readinessFor(
      facts({
        partListDeclaredComplete: true,
        parts: [part({ designStatus: "FROZEN", status: "INSTALLED", citationCount: 1 })],
        testsWithEvidence: 1
      }),
      GATES.map((g) => (g.id === "MANUFACTURED" ? na("MANUFACTURED", "all bought") : signed(g.id)))
    );
    assert.equal(r.stale.length, 0, "nothing in disagreement");
    assert.equal(r.next, null);
    assert.equal(r.pct, 100);
  });
});

describe("the weighting is monotonic", () => {
  test("passing one more gate never lowers the percentage", () => {
    const f = facts({ partListDeclaredComplete: true, parts: [part({ designStatus: "FROZEN", status: "INSTALLED" })] });
    const order = ["SCOPED", "DESIGN_FROZEN", "RULES_CHECKED", "PROCURED", "MANUFACTURED", "INSTALLED", "TESTED"] as const;
    let last = -1;
    for (let i = 0; i <= order.length; i++) {
      const pct = readinessFor(f, order.slice(0, i).map((g) => signed(g))).pct;
      assert.ok(pct >= last, `passing ${i} gates gave ${pct}%, down from ${last}%`);
      last = pct;
    }
    assert.equal(last, 100);
  });

  test("TESTED is the heaviest single gate", () => {
    const weights = GATES.map((g) => g.weight);
    const tested = GATES.find((g) => g.id === "TESTED")!.weight;
    assert.equal(tested, Math.max(...weights), "proving it works is worth more than buying it");
  });
});

describe("a signed gate notices when the data moves under it", () => {
  test("adding a part after SCOPED passes flags it stale, without unsigning it", () => {
    // The subtle rebirth of the old denominator bug: declare the list complete,
    // get it signed, then keep adding parts. Without this, the signature makes
    // an incomplete list look verified.
    const r = readinessFor(
      facts({ partListDeclaredComplete: false, parts: [part(), part()] }),
      [signed("SCOPED")]
    );
    const scoped = r.gates.find((g) => g.gate === "SCOPED")!;
    assert.equal(scoped.state, "PASSED", "a person's sign-off is not silently reverted");
    assert.equal(scoped.stale, true);
    assert.match(scoped.staleReason!, /the data no longer agrees/);
    assert.equal(r.stale.length, 1);
  });

  test("a reopened design flags the frozen gate stale", () => {
    const r = readinessFor(
      facts({ partListDeclaredComplete: true, parts: [part({ designStatus: "SELECTED" })] }),
      [signed("SCOPED"), signed("DESIGN_FROZEN")]
    );
    const d = r.gates.find((g) => g.gate === "DESIGN_FROZEN")!;
    assert.equal(d.stale, true);
    assert.match(d.staleReason!, /1 of 1 not frozen yet/);
  });

  test("a part coming back off the car flags Installed stale", () => {
    const r = readinessFor(
      facts({ partListDeclaredComplete: true, parts: [part({ designStatus: "FROZEN", status: "OWNED" })] }),
      [signed("SCOPED"), signed("DESIGN_FROZEN"), signed("PROCURED"), na("MANUFACTURED", "bought"), signed("INSTALLED")]
    );
    assert.equal(r.gates.find((g) => g.gate === "INSTALLED")!.stale, true);
  });

  test("staleness outranks forward progress as the next action", () => {
    const r = readinessFor(
      facts({ partListDeclaredComplete: false, parts: [part({ designStatus: "FROZEN" })] }),
      [signed("SCOPED")]
    );
    assert.equal(r.next!.gate, "SCOPED", "the known disagreement comes before the next new thing");
    assert.equal(r.next!.stale, true);
  });

  test("a gate still supported by its data is not stale", () => {
    const r = readinessFor(
      facts({ partListDeclaredComplete: true, parts: [part({ designStatus: "FROZEN" })] }),
      [signed("SCOPED"), signed("DESIGN_FROZEN")]
    );
    assert.equal(r.stale.length, 0);
  });

  test("nothing-to-judge does not count as disagreement", () => {
    // A subsystem that buys nothing should not make a signed PROCURED gate
    // stale — absence of bought parts is not evidence against it.
    const r = readinessFor(
      facts({ partListDeclaredComplete: true, parts: [part({ designStatus: "FROZEN", isManufactured: true, status: "OWNED" })] }),
      [signed("SCOPED"), signed("DESIGN_FROZEN"), signed("PROCURED")]
    );
    assert.equal(r.gates.find((g) => g.gate === "PROCURED")!.stale, false);
  });
});

/**
 * The tests that matter are the ones about the OLD metric's failure modes.
 * If the one-owned-part subsystem can still read 100%, nothing has been fixed.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateGates, readinessFor, rollUp, GATES,
  endorseProblem, approveProblem, notApplicableProblem, isApprover,
  type SubsystemFacts, type GateSignOff, type PartFacts, type InterfaceFacts
} from "./gates";

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
  return { partListDeclaredComplete: false, parts: [], testsWithEvidence: 0, interfaces: [], ...over };
}

/** An interface agreed by both leads and closed out. */
function iface(over: Partial<InterfaceFacts> = {}): InterfaceFacts {
  return { ref: "CHS_PWT_001", priority: "P2", status: "AGREED", agreedBothSides: true, counterpart: "Chassis", ...over };
}

/** Fully approved: lead endorsed, Chief approved. */
const signed = (gate: any, reason: string | null = null): GateSignOff => ({
  gate,
  decision: "PASSED",
  reason,
  endorsedBy: "u_lead",
  endorsedAt: "2026-10-30 12:00:00",
  approvedBy: "u_chief",
  approvedAt: "2026-10-30 13:00:00"
});

/** Endorsed by the lead only — deliberately NOT closed. */
const endorsed = (gate: any): GateSignOff => ({
  gate,
  decision: "PASSED",
  reason: null,
  endorsedBy: "u_lead",
  endorsedAt: "2026-10-30 12:00:00",
  approvedBy: null,
  approvedAt: null
});

const na = (gate: any, reason: string): GateSignOff => ({
  gate,
  decision: "NOT_APPLICABLE",
  reason,
  endorsedBy: null,
  endorsedAt: null,
  approvedBy: "u_chief",
  approvedAt: "2026-10-30 12:00:00"
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
    assert.match(d.detail, /needs the subsystem lead to endorse it/i);
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
    assert.equal(r.applicable, GATES.length - 1, "the excluded gate is out of the denominator");
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
    const f = facts({
      partListDeclaredComplete: true,
      parts: [part({ designStatus: "FROZEN", status: "INSTALLED" })],
      interfaces: [iface()]
    });
    // Derived from GATES, not a hardcoded list, so adding a gate cannot make
    // this test quietly assert the wrong total.
    const order = GATES.map((g) => g.id);
    let last = -1;
    for (let i = 0; i <= order.length; i++) {
      const pct = readinessFor(f, order.slice(0, i).map((g) => signed(g))).pct;
      assert.ok(pct >= last, `passing ${i} gates gave ${pct}%, down from ${last}%`);
      last = pct;
    }
    assert.equal(last, 100);
  });

  test("weights are flat, so no gate outranks another", () => {
    assert.deepEqual([...new Set(GATES.map((g) => g.weight))], [1]);
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

describe("endorsement is not approval", () => {
  const facts2 = () => facts({ partListDeclaredComplete: true, parts: [part({ designStatus: "FROZEN" })] });

  test("a lead's endorsement alone does not close a gate", () => {
    const r = readinessFor(facts2(), [endorsed("SCOPED")]);
    const g = r.gates.find((x) => x.gate === "SCOPED")!;
    assert.equal(g.state, "ENDORSED");
    assert.equal(r.passed, 0, "one person's word is not the finish line");
    assert.equal(r.pct, 0);
  });

  test("an endorsed gate does NOT unlock what comes after it", () => {
    // A lead endorsing "design frozen" must not let Procured be signed before
    // the Chief has agreed the design is actually frozen.
    const gs = evaluateGates(facts2(), [signed("SCOPED"), endorsed("DESIGN_FROZEN")]);
    assert.equal(gs.find((g) => g.gate === "PROCURED")!.state, "BLOCKED");
  });

  test("approval closes it and it counts", () => {
    const r = readinessFor(facts2(), [signed("SCOPED")]);
    assert.equal(r.gates.find((g) => g.gate === "SCOPED")!.state, "PASSED");
    assert.equal(r.passed, 1);
  });

  test("the detail names who is being waited on", () => {
    const gs = evaluateGates(facts2(), [endorsed("SCOPED")]);
    assert.match(gs.find((g) => g.gate === "SCOPED")!.detail, /waiting on the Chief Engineer/i);
  });
});

describe("who may endorse", () => {
  const ready = () =>
    evaluateGates(facts({ partListDeclaredComplete: true, parts: [part()] }), []).find((g) => g.gate === "SCOPED")!;

  test("a team member cannot", () => {
    const p = endorseProblem({ id: "u1", role: "TEAM_MEMBER", leadsThisSubsystem: false }, ready());
    assert.match(p!, /Only the subsystem lead/);
  });

  test("a lead of a DIFFERENT subsystem cannot", () => {
    const p = endorseProblem({ id: "u1", role: "TEAM_LEADER", leadsThisSubsystem: false }, ready());
    assert.match(p!, /lead a different subsystem/);
  });

  test("this subsystem's lead can", () => {
    assert.equal(endorseProblem({ id: "u1", role: "TEAM_LEADER", leadsThisSubsystem: true }, ready()), null);
  });

  test("the Chief can endorse directly, without leading the subsystem", () => {
    assert.equal(endorseProblem({ id: "u1", role: "CHIEF_ENGINEER", leadsThisSubsystem: false }, ready()), null);
  });

  test("a blocked gate cannot be endorsed, and says what it waits on", () => {
    const blocked = evaluateGates(facts({ parts: [part()] }), []).find((g) => g.gate === "DESIGN_FROZEN")!;
    const p = endorseProblem({ id: "u1", role: "CHIEF_ENGINEER", leadsThisSubsystem: true }, blocked);
    assert.match(p!, /cannot be endorsed yet/);
    assert.match(p!, /waiting on scoped/i);
  });
});

describe("who may approve", () => {
  const endorsedScoped = () =>
    evaluateGates(facts({ partListDeclaredComplete: true, parts: [part()] }), [endorsed("SCOPED")]).find(
      (g) => g.gate === "SCOPED"
    )!;

  test("a team leader cannot approve, and is told to endorse instead", () => {
    const p = approveProblem({ id: "u_lead", role: "TEAM_LEADER", leadsThisSubsystem: true }, endorsedScoped(), "u_lead");
    assert.match(p!, /Only the Chief Engineer or an Admin/);
    assert.match(p!, /Endorse it instead/);
  });

  test("the Chief can approve a lead's endorsement", () => {
    assert.equal(
      approveProblem({ id: "u_chief", role: "CHIEF_ENGINEER", leadsThisSubsystem: false }, endorsedScoped(), "u_lead"),
      null
    );
  });

  test("an Admin can approve", () => {
    assert.equal(
      approveProblem({ id: "u_admin", role: "ADMIN", leadsThisSubsystem: false }, endorsedScoped(), "u_lead"),
      null
    );
  });

  test("nothing can be approved before a lead has endorsed it", () => {
    const ready = evaluateGates(facts({ partListDeclaredComplete: true, parts: [part()] }), []).find(
      (g) => g.gate === "SCOPED"
    )!;
    const p = approveProblem({ id: "u_chief", role: "CHIEF_ENGINEER", leadsThisSubsystem: false }, ready, null);
    assert.match(p!, /not been endorsed/);
  });
});

describe("nobody approves their own Tested gate", () => {
  function testedGate(endorser: string) {
    const f = facts({
      partListDeclaredComplete: true,
      parts: [part({ designStatus: "FROZEN", status: "INSTALLED" })],
      testsWithEvidence: 1
    });
    return evaluateGates(f, [
      signed("SCOPED"), signed("DESIGN_FROZEN"), signed("RULES_CHECKED"),
      signed("PROCURED"), na("MANUFACTURED", "all bought"), signed("INSTALLED"),
      { gate: "TESTED", decision: "PASSED", reason: null, endorsedBy: endorser,
        endorsedAt: "2026-10-30", approvedBy: null, approvedAt: null }
    ]).find((g) => g.gate === "TESTED")!;
  }

  test("the Chief cannot approve a Tested gate they endorsed themselves", () => {
    const p = approveProblem(
      { id: "u_chief", role: "CHIEF_ENGINEER", leadsThisSubsystem: true },
      testedGate("u_chief"),
      "u_chief"
    );
    assert.match(p!, /somebody else has to approve it/);
    assert.match(p!, /signed off by one person is an opinion/);
  });

  test("but can approve one a lead endorsed", () => {
    assert.equal(
      approveProblem({ id: "u_chief", role: "CHIEF_ENGINEER", leadsThisSubsystem: false }, testedGate("u_lead"), "u_lead"),
      null
    );
  });

  test("the restriction is specific to Tested — a Chief can do Installed end to end", () => {
    const f = facts({
      partListDeclaredComplete: true,
      parts: [part({ designStatus: "FROZEN", status: "INSTALLED" })]
    });
    const installed = evaluateGates(f, [
      signed("SCOPED"), signed("DESIGN_FROZEN"), signed("PROCURED"), na("MANUFACTURED", "bought"),
      { gate: "INSTALLED", decision: "PASSED", reason: null, endorsedBy: "u_chief",
        endorsedAt: "2026-10-30", approvedBy: null, approvedAt: null }
    ]).find((g) => g.gate === "INSTALLED")!;
    assert.equal(
      approveProblem({ id: "u_chief", role: "CHIEF_ENGINEER", leadsThisSubsystem: true }, installed, "u_chief"),
      null
    );
  });
});

describe("marking a gate out of scope", () => {
  const openTested = () =>
    evaluateGates(facts({ parts: [part()] }), []).find((g) => g.gate === "TESTED")!;

  test("a lead cannot do it", () => {
    const p = notApplicableProblem(
      { id: "u1", role: "TEAM_LEADER", leadsThisSubsystem: true },
      openTested(),
      "no track time this season"
    );
    assert.match(p!, /Only the Chief Engineer or an Admin/);
  });

  test("a reason is required, and 'n/a' is not a reason", () => {
    const p = notApplicableProblem({ id: "u1", role: "CHIEF_ENGINEER", leadsThisSubsystem: false }, openTested(), "n/a");
    assert.match(p!, /at least a few words/);
  });

  test("a real reason is accepted", () => {
    assert.equal(
      notApplicableProblem(
        { id: "u1", role: "CHIEF_ENGINEER", leadsThisSubsystem: false },
        openTested(),
        "no track time available this season"
      ),
      null
    );
  });

  test("Scoped can never be marked out of scope", () => {
    const scoped = evaluateGates(facts({ parts: [part()] }), []).find((g) => g.gate === "SCOPED")!;
    const p = notApplicableProblem(
      { id: "u1", role: "ADMIN", leadsThisSubsystem: false },
      scoped,
      "we know what we need already"
    );
    assert.match(p!, /cannot be marked out of scope/);
  });
});

describe("flat weights", () => {
  test("every gate weighs the same, so gates-closed and percent agree", () => {
    assert.deepEqual([...new Set(GATES.map((g) => g.weight))], [1]);
  });

  test("gates closed and percent agree, because the weights are flat", () => {
    const f = facts({ partListDeclaredComplete: true, parts: [part({ designStatus: "FROZEN", status: "INSTALLED" })] });
    const r = readinessFor(f, [
      signed("SCOPED"), signed("DESIGN_FROZEN"), signed("RULES_CHECKED"), signed("PROCURED"), signed("MANUFACTURED")
    ]);
    assert.equal(r.passed, 5);
    assert.equal(r.applicable, GATES.length);
    assert.equal(r.pct, Math.round((5 / GATES.length) * 100));
  });
});

describe("interfaces gate — the joint nobody owns", () => {
  test("one side agreeing is not agreement", () => {
    const gs = evaluateGates(
      facts({
        partListDeclaredComplete: true,
        parts: [part({ designStatus: "FROZEN" })],
        interfaces: [iface({ status: "AGREED", agreedBothSides: false })]
      }),
      [signed("SCOPED"), signed("DESIGN_FROZEN")]
    );
    const g = gs.find((x) => x.gate === "INTERFACES_AGREED")!;
    assert.equal(g.state, "OPEN", "AGREED set by one lead must not close the gate");
    assert.match(g.detail, /not agreed by both sides/);
  });

  test("both sides agreeing makes it ready", () => {
    const gs = evaluateGates(
      facts({
        partListDeclaredComplete: true,
        parts: [part({ designStatus: "FROZEN" })],
        interfaces: [iface({ status: "AGREED", agreedBothSides: true })]
      }),
      [signed("SCOPED"), signed("DESIGN_FROZEN")]
    );
    assert.equal(gs.find((x) => x.gate === "INTERFACES_AGREED")!.state, "READY");
  });

  test("the detail names the counterpart subsystem and flags critical ones", () => {
    const gs = evaluateGates(
      facts({
        partListDeclaredComplete: true,
        parts: [part({ designStatus: "FROZEN" })],
        interfaces: [
          iface({ ref: "CHS_PWT_001", priority: "P1", status: "OPEN", agreedBothSides: false, counterpart: "Chassis" })
        ]
      }),
      [signed("SCOPED"), signed("DESIGN_FROZEN")]
    );
    const d = gs.find((x) => x.gate === "INTERFACES_AGREED")!.detail;
    assert.match(d, /1 critical/);
    assert.match(d, /CHS_PWT_001 with Chassis/);
  });

  test("no interfaces recorded names the two real actions", () => {
    const gs = evaluateGates(
      facts({ partListDeclaredComplete: true, parts: [part({ designStatus: "FROZEN" })] }),
      [signed("SCOPED"), signed("DESIGN_FROZEN")]
    );
    const d = gs.find((x) => x.gate === "INTERFACES_AGREED")!.detail;
    assert.match(d, /add them, or mark out of scope/);
  });
});

describe("the P1 ceiling", () => {
  /** Everything closed except that one critical interface is still open. */
  function nearlyDone(interfaces: InterfaceFacts[]) {
    return readinessFor(
      facts({
        partListDeclaredComplete: true,
        parts: [part({ designStatus: "FROZEN", status: "INSTALLED", citationCount: 1 })],
        testsWithEvidence: 1,
        interfaces
      }),
      GATES.map((g) => (g.id === "MANUFACTURED" ? na("MANUFACTURED", "all bought") : signed(g.id)))
    );
  }

  test("an open P1 interface caps the subsystem at 84, not 100", () => {
    const r = nearlyDone([iface({ ref: "CHS_PWT_001", priority: "P1", status: "OPEN", agreedBothSides: false })]);
    assert.equal(r.gatePct, 100, "the gates themselves are all closed");
    assert.equal(r.pct, 84, "but it does not bolt to the car yet");
    assert.ok(r.ceiling);
    assert.match(r.ceiling!.reason, /1 critical interface not agreed by both sides/);
    assert.match(r.ceiling!.reason, /cannot read complete/);
  });

  test("a P2 interface left open does NOT cap — only critical ones do", () => {
    const r = nearlyDone([iface({ priority: "P2", status: "OPEN", agreedBothSides: false })]);
    assert.equal(r.ceiling, null);
  });

  test("agreeing the P1 lifts the cap", () => {
    const r = nearlyDone([iface({ priority: "P1", status: "AGREED", agreedBothSides: true })]);
    assert.equal(r.pct, 100);
    assert.equal(r.ceiling, null);
  });

  test("a P1 agreed by only one side still caps", () => {
    const r = nearlyDone([iface({ priority: "P1", status: "AGREED", agreedBothSides: false })]);
    assert.equal(r.pct, 84);
  });

  test("the ceiling is not reported when the gates are already below it", () => {
    // Reporting a cap of 84 on a subsystem sitting at 25% is noise — the
    // ceiling only matters once it actually binds.
    const r = readinessFor(
      facts({
        partListDeclaredComplete: true,
        parts: [part()],
        interfaces: [iface({ priority: "P1", status: "OPEN", agreedBothSides: false })]
      }),
      [signed("SCOPED")]
    );
    assert.ok(r.pct < 84);
    assert.equal(r.ceiling, null, "shown only when it changes the answer");
  });

  test("the ceiling applies even with several P1s open, naming the count", () => {
    const r = nearlyDone([
      iface({ ref: "CHS_PWT_001", priority: "P1", status: "OPEN", agreedBothSides: false }),
      iface({ ref: "CHS_SUS_002", priority: "P1", status: "OPEN", agreedBothSides: false, counterpart: "Suspension" })
    ]);
    assert.equal(r.pct, 84);
    assert.match(r.ceiling!.reason, /2 critical interfaces/);
  });
});

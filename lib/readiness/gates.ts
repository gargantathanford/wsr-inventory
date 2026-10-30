/**
 * Gate-based completeness.
 *
 * WHAT THIS REPLACES, and why it had to go.
 *
 * Readiness used to be:
 *
 *     parts with status OWNED/AVAILABLE/INSTALLED  ÷  all parts in the subsystem
 *
 * That measures procurement progress against whatever list the team happened to
 * type in. A subsystem with one part, owned, read 100% complete. Chassis with
 * six of six tubes bought read 100% while the car had no suspension pickups. The
 * denominator was controlled by NOT entering parts, which is the worst property
 * a metric can have: the fastest way to look finished was to do less work.
 *
 * A subsystem is now complete when its gates are closed. Gates are named,
 * ordered, and signed off by a person — so "complete" means someone put their
 * name to it, not that a count happened to divide evenly.
 *
 * TWO SIGNALS PER GATE, deliberately.
 *
 *   derive()  — what the data in the dashboard says. Cheap, always current,
 *               and nobody has to maintain a second checklist.
 *   sign-off  — a lead asserting it. What actually closes the gate.
 *
 * Derivation alone would be false precision: INSTALLED derived from a status
 * field is only as true as whoever last touched the dropdown. Sign-off alone
 * becomes a checklist that rots. So the data decides when a gate is READY to
 * claim, and a person decides whether it PASSES. This is the same shape as the
 * XP approval tier, on purpose — one idea of "who can vouch for this", not two.
 *
 * Pure module: no database, no React, no I/O. Everything here is a function of
 * facts passed in, so the rules can be argued with and tested without a server.
 */

export type GateId =
  | "SCOPED"
  | "DESIGN_FROZEN"
  | "RULES_CHECKED"
  | "PROCURED"
  | "MANUFACTURED"
  | "INSTALLED"
  | "TESTED";

export type GateState =
  /** Explicitly out of scope this season, with a stated reason. */
  | "NOT_APPLICABLE"
  /** A prerequisite gate has not passed yet. Cannot be worked on meaningfully. */
  | "BLOCKED"
  /** Workable. The data does not yet satisfy it. */
  | "OPEN"
  /** The data satisfies it. Waiting for a lead to put their name to it. */
  | "READY"
  /** Signed off. */
  | "PASSED";

/** Facts about one subsystem, read from the database by the caller. */
export interface SubsystemFacts {
  /** Has a lead declared the part list complete? The fix for the denominator. */
  partListDeclaredComplete: boolean;
  parts: PartFacts[];
  /** Subsystem-level test records with evidence attached. */
  testsWithEvidence: number;
}

export interface PartFacts {
  id: string;
  /** PLACEHOLDER | CANDIDATE | QUOTED | SELECTED | FROZEN */
  designStatus: string;
  /** OWNED | PARTIALLY_OWNED | NEEDED | ORDERED | BACKORDERED | MANUFACTURING |
   *  AVAILABLE_FOR_INSTALLATION | INSTALLED | NO_LONGER_NEEDED | UNAVAILABLE */
  status: string;
  /** Number of rule clauses cited on this part. */
  citationCount: number;
  /** True when this part is made by the team rather than bought. */
  isManufactured: boolean;
  /** A part that is not fitted to the car — a spare, a tool, a consumable. */
  isFitted: boolean;
}

/** A part nobody needs any more must not hold a gate open forever. */
const RETIRED_STATUSES = new Set(["NO_LONGER_NEEDED"]);
const OWNED_OR_BEYOND = new Set(["OWNED", "AVAILABLE_FOR_INSTALLATION", "INSTALLED"]);

/**
 * What the data says about a gate.
 *
 *   "satisfied"  — the data says it is done; a lead now signs it off
 *   "unsatisfied"— the data says work is outstanding, and how much
 *   "nothing-to-judge" — there is nothing of this kind in the subsystem at all
 *                  (no parts yet, nothing manufactured, nothing fitted), so the
 *                  honest answer is "a lead should mark this N/A or add parts"
 *
 * This started as `boolean | null` and the null was doing both of the last two
 * jobs at once. The result was that every gate whose per-gate explanation only
 * applied to the "cannot derive" case silently fell through to a generic
 * sentence — TESTED said "needs a lead to assess" instead of "no test record
 * with evidence yet", and the text written for it was unreachable. Naming the
 * three outcomes makes that impossible.
 */
export type Derived = "satisfied" | "unsatisfied" | "nothing-to-judge";

export interface GateDef {
  id: GateId;
  label: string;
  /** What signing this off actually claims. Shown in the UI next to the gate. */
  means: string;
  /** Gates that must PASS first. */
  after: GateId[];
  /** Relative weight in the subsystem rollup. */
  weight: number;
  /** Evidence (a file, a photo, a measurement) required to sign off. */
  requiresEvidence: boolean;
  derive: (f: SubsystemFacts) => Derived;
}

/** Parts that still count — retired ones are excluded from every gate. */
function live(f: SubsystemFacts): PartFacts[] {
  return f.parts.filter((p) => !RETIRED_STATUSES.has(p.status));
}

export const GATES: GateDef[] = [
  {
    id: "SCOPED",
    label: "Scoped",
    means:
      "The part list for this subsystem is complete — everything the subsystem needs is entered, " +
      "even the parts nobody has started. Until this passes, no percentage below it means anything.",
    after: [],
    weight: 1,
    requiresEvidence: false,
    // The one gate that cannot be derived from part data, because its whole
    // purpose is to assert that the part data is now the full picture. A count
    // can never tell you a list is finished.
    derive: (f) =>
      f.partListDeclaredComplete ? "satisfied" : f.parts.length > 0 ? "unsatisfied" : "nothing-to-judge"
  },
  {
    id: "DESIGN_FROZEN",
    label: "Design frozen",
    means:
      "Every part has a chosen design that will not change without a change request. " +
      "Freezing is what makes ordering and manufacturing safe.",
    after: ["SCOPED"],
    weight: 2,
    requiresEvidence: false,
    derive: (f) => {
      const parts = live(f);
      if (parts.length === 0) return "nothing-to-judge";
      return parts.every((p) => p.designStatus === "FROZEN") ? "satisfied" : "unsatisfied";
    }
  },
  {
    id: "RULES_CHECKED",
    label: "Rules checked",
    means:
      "Every part that a rule governs cites the clause it answers to, and the compliance argument " +
      "is written down. This is what Tech Inspection and the design judges ask for.",
    after: ["SCOPED"],
    weight: 2,
    requiresEvidence: true,
    derive: (f) => {
      const parts = live(f);
      if (parts.length === 0) return "nothing-to-judge";
      // Deliberately NOT "every part has a citation" — plenty of parts are
      // governed by no rule at all, and demanding a citation for a zip tie
      // teaches people to cite something irrelevant to clear the gate.
      // The derived signal is only that the work has begun; the lead decides
      // whether the coverage is honest. Hence requiresEvidence.
      return parts.some((p) => p.citationCount > 0) ? "satisfied" : "unsatisfied";
    }
  },
  {
    id: "PROCURED",
    label: "Procured",
    means: "Everything that is bought has arrived and is in the shop.",
    after: ["DESIGN_FROZEN"],
    weight: 2,
    requiresEvidence: false,
    derive: (f) => {
      const bought = live(f).filter((p) => !p.isManufactured);
      if (bought.length === 0) return "nothing-to-judge";
      return bought.every((p) => OWNED_OR_BEYOND.has(p.status)) ? "satisfied" : "unsatisfied";
    }
  },
  {
    id: "MANUFACTURED",
    label: "Manufactured",
    means: "Everything the team makes itself is made, inspected and ready to fit.",
    after: ["DESIGN_FROZEN"],
    weight: 2,
    requiresEvidence: true,
    derive: (f) => {
      const made = live(f).filter((p) => p.isManufactured);
      if (made.length === 0) return "nothing-to-judge"; // nothing to make
      return made.every((p) => OWNED_OR_BEYOND.has(p.status)) ? "satisfied" : "unsatisfied";
    }
  },
  {
    id: "INSTALLED",
    label: "Installed",
    means: "Fitted to the car, with fasteners torqued and the installation checked.",
    after: ["PROCURED", "MANUFACTURED"],
    weight: 2,
    requiresEvidence: true,
    derive: (f) => {
      const fitted = live(f).filter((p) => p.isFitted);
      if (fitted.length === 0) return "nothing-to-judge";
      return fitted.every((p) => p.status === "INSTALLED") ? "satisfied" : "unsatisfied";
    }
  },
  {
    id: "TESTED",
    label: "Tested",
    means:
      "Proven to work on the car — not assumed to work because it is installed. " +
      "Needs a record of what was tested and what the result was.",
    after: ["INSTALLED"],
    weight: 3,
    requiresEvidence: true,
    // No part status can tell you something was tested, so this gate is only
    // ever closed by a person. But "installed and untested" is a real,
    // reportable state of work outstanding — not an absence of information —
    // so it is unsatisfied rather than nothing-to-judge.
    derive: (f) => {
      if (f.testsWithEvidence > 0) return "satisfied";
      return live(f).length === 0 ? "nothing-to-judge" : "unsatisfied";
    }
  }
];

export const GATE_BY_ID: Record<GateId, GateDef> = Object.fromEntries(
  GATES.map((g) => [g.id, g])
) as Record<GateId, GateDef>;

/** A lead's recorded decision on one gate. */
export interface GateSignOff {
  gate: GateId;
  /** PASSED, or NOT_APPLICABLE with a reason. */
  decision: "PASSED" | "NOT_APPLICABLE";
  reason: string | null;
  by: string;
  at: string;
}

export interface GateStatus {
  gate: GateId;
  label: string;
  means: string;
  state: GateState;
  weight: number;
  /** Why it is in this state, in words, for the UI. */
  detail: string;
  signedOffBy: string | null;
  signedOffAt: string | null;
  requiresEvidence: boolean;
  /**
   * Signed off, but the data has since stopped supporting it — a part was
   * added to a scoped subsystem, a frozen design was reopened, an installed
   * part came back off the car.
   *
   * It stays PASSED rather than silently reverting, because quietly undoing a
   * named person's sign-off is its own kind of lie, and because the change may
   * be perfectly fine (a spare was added). But a dashboard that keeps claiming
   * a gate is closed while its own data disagrees is the exact failure being
   * fixed here, one level up. So it is flagged, loudly, and a lead re-confirms
   * or re-opens it.
   */
  stale: boolean;
  staleReason: string | null;
}

/**
 * Resolve every gate for one subsystem.
 *
 * Order matters: a gate cannot be BLOCKED by a prerequisite that is itself
 * NOT_APPLICABLE, or marking Manufacturing out of scope would freeze everything
 * downstream of it forever.
 */
export function evaluateGates(facts: SubsystemFacts, signOffs: GateSignOff[]): GateStatus[] {
  const byGate = new Map(signOffs.map((s) => [s.gate, s]));
  const resolved = new Map<GateId, GateState>();
  const out: GateStatus[] = [];

  for (const def of GATES) {
    const signed = byGate.get(def.id);

    if (signed?.decision === "NOT_APPLICABLE") {
      resolved.set(def.id, "NOT_APPLICABLE");
      out.push({
        ...base(def),
        state: "NOT_APPLICABLE",
        detail: signed.reason ? `Out of scope: ${signed.reason}` : "Marked out of scope",
        signedOffBy: signed.by,
        signedOffAt: signed.at
      });
      continue;
    }

    if (signed?.decision === "PASSED") {
      resolved.set(def.id, "PASSED");
      // Re-derive even for a passed gate: the data may have moved since the
      // signature. SCOPED is the one that matters most — adding parts after it
      // passes would otherwise recreate the old denominator bug in a subtler
      // form, with a signature on top making it look verified.
      const nowSays = def.derive(facts);
      const isStale = nowSays === "unsatisfied";
      out.push({
        ...base(def),
        state: "PASSED",
        detail: `Signed off${signed.reason ? ` — ${signed.reason}` : ""}`,
        signedOffBy: signed.by,
        signedOffAt: signed.at,
        stale: isStale,
        staleReason: isStale ? `Signed off, but the data no longer agrees: ${explainOpen(def, facts)}` : null
      });
      continue;
    }

    // A NOT_APPLICABLE prerequisite does not block; it is settled, just not by
    // passing. Only a genuinely unfinished prerequisite blocks.
    const blockers = def.after.filter((p) => {
      const s = resolved.get(p);
      return s !== "PASSED" && s !== "NOT_APPLICABLE";
    });

    if (blockers.length > 0) {
      resolved.set(def.id, "BLOCKED");
      out.push({
        ...base(def),
        state: "BLOCKED",
        detail: `Waiting on ${blockers.map((b) => GATE_BY_ID[b].label).join(" and ")}`,
        signedOffBy: null,
        signedOffAt: null
      });
      continue;
    }

    const derived = def.derive(facts);
    if (derived === "satisfied") {
      resolved.set(def.id, "READY");
      out.push({
        ...base(def),
        state: "READY",
        detail: "The data says this is done — needs a lead to sign it off",
        signedOffBy: null,
        signedOffAt: null
      });
    } else {
      resolved.set(def.id, "OPEN");
      out.push({
        ...base(def),
        state: "OPEN",
        detail:
          derived === "nothing-to-judge"
            ? nothingToJudge(def, facts)
            : explainOpen(def, facts),
        signedOffBy: null,
        signedOffAt: null
      });
    }
  }

  return out;
}

function base(def: GateDef) {
  return {
    gate: def.id,
    label: def.label,
    means: def.means,
    weight: def.weight,
    requiresEvidence: def.requiresEvidence,
    stale: false,
    staleReason: null as string | null
  };
}

/**
 * Nothing of this kind exists in the subsystem, so there is no progress to
 * report. Each message says which of the two real actions is appropriate:
 * enter the parts, or mark the gate out of scope. Never a bare "not done",
 * which leaves a lead with nowhere to go.
 */
function nothingToJudge(def: GateDef, f: SubsystemFacts): string {
  if (f.parts.length === 0) return "No parts entered yet — start by listing what this subsystem needs";
  switch (def.id) {
    case "PROCURED":
      return "Nothing in this subsystem is bought — mark out of scope if everything is made in-house";
    case "MANUFACTURED":
      return "Nothing in this subsystem is made in-house — mark out of scope if everything is bought";
    case "INSTALLED":
      return "No parts here are fitted to the car — mark out of scope if these are spares or consumables";
    default:
      return "Needs a lead to assess and sign off";
  }
}

/** Concrete counts, so OPEN says what is left rather than just "not done". */
function explainOpen(def: GateDef, f: SubsystemFacts): string {
  const parts = live(f);
  switch (def.id) {
    case "SCOPED":
      return `${parts.length} part${parts.length === 1 ? "" : "s"} entered — a lead must confirm the list is complete`;
    case "DESIGN_FROZEN": {
      const n = parts.filter((p) => p.designStatus !== "FROZEN").length;
      return `${n} of ${parts.length} not frozen yet`;
    }
    case "RULES_CHECKED":
      return "No rule clauses cited on any part yet";
    case "PROCURED": {
      const bought = parts.filter((p) => !p.isManufactured);
      const n = bought.filter((p) => !OWNED_OR_BEYOND.has(p.status)).length;
      return `${n} of ${bought.length} bought parts not in hand`;
    }
    case "MANUFACTURED": {
      const made = parts.filter((p) => p.isManufactured);
      const n = made.filter((p) => !OWNED_OR_BEYOND.has(p.status)).length;
      return `${n} of ${made.length} made parts not finished`;
    }
    case "INSTALLED": {
      const fitted = parts.filter((p) => p.isFitted);
      const n = fitted.filter((p) => p.status !== "INSTALLED").length;
      return `${n} of ${fitted.length} not on the car`;
    }
    case "TESTED":
      return "No test record with evidence yet";
  }
}

export interface Readiness {
  /** Weighted percentage of applicable gates passed. 0-100, integer. */
  pct: number;
  passed: number;
  applicable: number;
  /** The gate a lead should look at next, or null when everything has passed. */
  next: GateStatus | null;
  /** Passed gates whose data has since changed. Shown as a warning, not a drop. */
  stale: GateStatus[];
  gates: GateStatus[];
}

/**
 * Roll the gates up into one number.
 *
 * Weighted by gate, and NOT_APPLICABLE gates leave the denominator entirely —
 * a team that will not test Aero this season should not be permanently stuck
 * below 100%, as long as somebody said so out loud and gave a reason.
 *
 * READY counts as not passed. A gate waiting on sign-off is not closed, and
 * counting it would reintroduce exactly the thing being fixed: a number that
 * says finished when nobody has checked.
 */
export function rollUp(gates: GateStatus[]): Readiness {
  const applicable = gates.filter((g) => g.state !== "NOT_APPLICABLE");
  const totalWeight = applicable.reduce((s, g) => s + g.weight, 0);
  const passedWeight = applicable.filter((g) => g.state === "PASSED").reduce((s, g) => s + g.weight, 0);

  // Every gate out of scope is a defensible 100% — the alternative is dividing
  // by zero or inventing a number.
  const pct = totalWeight === 0 ? 100 : Math.round((passedWeight / totalWeight) * 100);

  const stale = applicable.filter((g) => g.stale);

  // A stale gate outranks everything: it is the one place the dashboard and
  // reality are known to disagree, and that is worth more of a lead's attention
  // than the next piece of forward progress.
  const next =
    stale[0] ??
    applicable.find((g) => g.state === "READY") ??
    applicable.find((g) => g.state === "OPEN") ??
    applicable.find((g) => g.state === "BLOCKED") ??
    null;

  return {
    pct,
    passed: applicable.filter((g) => g.state === "PASSED").length,
    applicable: applicable.length,
    next,
    stale,
    gates
  };
}

/** Everything in one call, for the common case. */
export function readinessFor(facts: SubsystemFacts, signOffs: GateSignOff[]): Readiness {
  return rollUp(evaluateGates(facts, signOffs));
}

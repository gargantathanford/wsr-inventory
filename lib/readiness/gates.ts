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
  | "INTERFACES_AGREED"
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
  /** A lead has endorsed it. Waiting on the Chief Engineer or an Admin. */
  | "ENDORSED"
  /** Approved. This is the only state that counts toward the percentage. */
  | "PASSED";

/** Facts about one subsystem, read from the database by the caller. */
export interface SubsystemFacts {
  /** Has a lead declared the part list complete? The fix for the denominator. */
  partListDeclaredComplete: boolean;
  parts: PartFacts[];
  /** Subsystem-level test records with evidence attached. */
  testsWithEvidence: number;
  /**
   * Every interface this subsystem is a party to, on either side.
   *
   * An interface is where two subsystems meet, which means nobody owns it
   * alone — and that is exactly why it is where FSAE cars fail at assembly.
   * A subsystem can close every other gate and still not bolt to anything.
   */
  interfaces: InterfaceFacts[];
}

export interface InterfaceFacts {
  ref: string;
  /** P1 is a critical interface: the car does not go together without it. */
  priority: "P1" | "P2" | "P3";
  /** OPEN | IN_WORK | AGREED | CLOSED */
  status: string;
  /** Agreed by BOTH subsystem leads. One side agreeing alone is not agreement. */
  agreedBothSides: boolean;
  /** The other subsystem's name, for the message. */
  counterpart: string;
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
  /**
   * Relative weight in the subsystem rollup. Flat at 1 for every gate, by
   * decision: a weighted version invites an argument about whether testing is
   * worth 1.5x freezing a design, and nobody can audit the answer. Flat means
   * "five of seven gates closed" and "71%" say the same thing, and the field
   * stays here so a future season can weight them without a schema change.
   */
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
    weight: 1,
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
    weight: 1,
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
    id: "INTERFACES_AGREED",
    label: "Interfaces agreed",
    means:
      "Every place this subsystem meets another one is written down and agreed by BOTH leads — " +
      "what bolts to what, with which fasteners, to what tolerance, carrying what load. " +
      "This is the gate that stops two subsystems each assuming the other owns the joint.",
    after: ["DESIGN_FROZEN"],
    weight: 1,
    requiresEvidence: true,
    derive: (f) => {
      if (f.interfaces.length === 0) return "nothing-to-judge";
      // One side ticking AGREED is not agreement. The whole failure mode this
      // gate addresses is each team believing the other has it covered.
      return f.interfaces.every((i) => i.agreedBothSides && (i.status === "AGREED" || i.status === "CLOSED"))
        ? "satisfied"
        : "unsatisfied";
    }
  },
  {
    id: "PROCURED",
    label: "Procured",
    means: "Everything that is bought has arrived and is in the shop.",
    after: ["DESIGN_FROZEN"],
    weight: 1,
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
    weight: 1,
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
    weight: 1,
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
    weight: 1,
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

/**
 * The recorded decision on one gate, in two stages.
 *
 * A subsystem lead endorses; the Chief Engineer or an Admin approves. Only
 * approval closes a gate. The lead who does the work is the right person to
 * say "this is done" and the wrong person to be the only one who says so —
 * the endorsement is a real signature with a name on it, not a request.
 */
export interface GateSignOff {
  gate: GateId;
  /** PASSED, or NOT_APPLICABLE with a reason. */
  decision: "PASSED" | "NOT_APPLICABLE";
  reason: string | null;
  /** The lead who put the gate forward. Null when a Chief went straight to it. */
  endorsedBy: string | null;
  endorsedAt: string | null;
  /** Chief Engineer or Admin. Until this is set the gate is not closed. */
  approvedBy: string | null;
  approvedAt: string | null;
}

export interface GateStatus {
  gate: GateId;
  label: string;
  means: string;
  state: GateState;
  weight: number;
  /** Why it is in this state, in words, for the UI. */
  detail: string;
  /** The lead who put it forward, if anyone has. */
  endorsedBy: string | null;
  endorsedAt: string | null;
  /** The Chief Engineer or Admin who approved it. Null until closed. */
  approvedBy: string | null;
  approvedAt: string | null;
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
        endorsedBy: signed.endorsedBy,
        endorsedAt: signed.endorsedAt,
        approvedBy: signed.approvedBy,
        approvedAt: signed.approvedAt
      });
      continue;
    }

    if (signed?.decision === "PASSED") {
      // Re-derive even for a signed gate: the data may have moved since. SCOPED
      // is the one that matters most — adding parts after it closes would
      // otherwise recreate the old denominator bug in a subtler form, with a
      // signature on top making it look verified.
      const nowSays = def.derive(facts);
      const isStale = nowSays === "unsatisfied";
      const staleReason = isStale
        ? `Signed off, but the data no longer agrees: ${explainOpen(def, facts)}`
        : null;

      // Endorsed but not yet approved is NOT closed. It counts for nothing in
      // the percentage, because the whole point of the two stages is that one
      // person's word is not the finish line.
      const state: GateState = signed.approvedBy ? "PASSED" : "ENDORSED";
      resolved.set(def.id, state);
      out.push({
        ...base(def),
        state,
        detail:
          state === "PASSED"
            ? `Approved${signed.reason ? ` — ${signed.reason}` : ""}`
            : "Endorsed by the subsystem lead — waiting on the Chief Engineer",
        endorsedBy: signed.endorsedBy,
        endorsedAt: signed.endorsedAt,
        approvedBy: signed.approvedBy,
        approvedAt: signed.approvedAt,
        stale: isStale,
        staleReason
      });
      continue;
    }

    // A NOT_APPLICABLE prerequisite does not block; it is settled, just not by
    // passing. Only a genuinely unfinished prerequisite blocks.
    // ENDORSED deliberately does NOT clear a prerequisite. A lead endorsing
    // "design frozen" must not unlock a Procured sign-off before the Chief has
    // agreed the design is actually frozen.
    const blockers = def.after.filter((p) => {
      const s = resolved.get(p);
      return s !== "PASSED" && s !== "NOT_APPLICABLE";
    });

    if (blockers.length > 0) {
      resolved.set(def.id, "BLOCKED");
      out.push({
        ...base(def),
        state: "BLOCKED",
        detail: `Waiting on ${blockers.map((b) => GATE_BY_ID[b].label).join(" and ")}`
      });
      continue;
    }

    const derived = def.derive(facts);
    if (derived === "satisfied") {
      resolved.set(def.id, "READY");
      out.push({
        ...base(def),
        state: "READY",
        detail: "The data says this is done — needs the subsystem lead to endorse it"
      });
    } else {
      resolved.set(def.id, "OPEN");
      out.push({
        ...base(def),
        state: "OPEN",
        detail:
          derived === "nothing-to-judge"
            ? nothingToJudge(def, facts)
            : explainOpen(def, facts)
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
    endorsedBy: null as string | null,
    endorsedAt: null as string | null,
    approvedBy: null as string | null,
    approvedAt: null as string | null,
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
    case "INTERFACES_AGREED":
      return "No interfaces recorded for this subsystem — add them, or mark out of scope if it genuinely touches nothing";
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
    case "INTERFACES_AGREED": {
      const open = f.interfaces.filter(
        (i) => !i.agreedBothSides || (i.status !== "AGREED" && i.status !== "CLOSED")
      );
      const p1 = open.filter((i) => i.priority === "P1");
      const withNames = open.slice(0, 3).map((i) => `${i.ref} with ${i.counterpart}`).join(", ");
      return (
        `${open.length} of ${f.interfaces.length} interfaces not agreed by both sides` +
        (p1.length ? ` — ${p1.length} critical` : "") +
        (withNames ? `: ${withNames}${open.length > 3 ? ", …" : ""}` : "")
      );
    }
  }
}

/**
 * A cap on the percentage, regardless of how many gates are closed.
 *
 * Ported from the Freeze Readiness tool, where it is the better instrument: a
 * subsystem with one unresolved critical problem and everything else perfect
 * should NOT read 97%. Subtracting points pretends to quantify how unfinished
 * something is; a ceiling says plainly "you cannot call this finished", and
 * says why.
 *
 * Ceilings are not cumulative. The lowest applicable cap wins, and the UI names
 * the one that binds — two caps stacking into a number nobody can derive is the
 * thing being avoided.
 */
export interface Ceiling {
  /** The highest percentage this subsystem may report. */
  cap: number;
  /** Shown verbatim next to the number. */
  reason: string;
}

export interface Readiness {
  /** Percentage after any ceiling is applied. This is the number to display. */
  pct: number;
  /** What the gates alone would say. Shown only to explain a binding ceiling. */
  gatePct: number;
  /** The cap in force, or null when gates alone decide. */
  ceiling: Ceiling | null;
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
/**
 * Every ceiling rule, lowest cap first.
 *
 * Starting with one rule rather than the artifact's five, because each cap is a
 * claim about what "not finished" means and an unexamined cap is worse than
 * none. P1 interfaces first: it is the one the gates genuinely cannot express,
 * since an interface is shared and a gate is per-subsystem.
 */
export const CEILINGS: Array<{ cap: number; test: (f: SubsystemFacts) => string | null }> = [
  {
    cap: 84,
    test: (f) => {
      const open = f.interfaces.filter(
        (i) => i.priority === "P1" && !(i.agreedBothSides && (i.status === "AGREED" || i.status === "CLOSED"))
      );
      if (open.length === 0) return null;
      const names = open.slice(0, 2).map((i) => `${i.ref} with ${i.counterpart}`).join(", ");
      return (
        `${open.length} critical interface${open.length === 1 ? "" : "s"} not agreed by both sides ` +
        `(${names}${open.length > 2 ? ", …" : ""}). A subsystem that does not yet bolt to the car ` +
        `cannot read complete, however much of its own work is done.`
      );
    }
  }
];

function lowestCeiling(f: SubsystemFacts): Ceiling | null {
  let best: Ceiling | null = null;
  for (const c of CEILINGS) {
    const reason = c.test(f);
    if (reason !== null && (best === null || c.cap < best.cap)) best = { cap: c.cap, reason };
  }
  return best;
}

export function rollUp(facts: SubsystemFacts, gates: GateStatus[]): Readiness {
  const applicable = gates.filter((g) => g.state !== "NOT_APPLICABLE");
  const totalWeight = applicable.reduce((s, g) => s + g.weight, 0);
  const passedWeight = applicable.filter((g) => g.state === "PASSED").reduce((s, g) => s + g.weight, 0);

  // Every gate out of scope is a defensible 100% — the alternative is dividing
  // by zero or inventing a number.
  const gatePct = totalWeight === 0 ? 100 : Math.round((passedWeight / totalWeight) * 100);

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

  const ceiling = lowestCeiling(facts);

  return {
    pct: ceiling ? Math.min(gatePct, ceiling.cap) : gatePct,
    gatePct,
    ceiling: ceiling && ceiling.cap < gatePct ? ceiling : null,
    passed: applicable.filter((g) => g.state === "PASSED").length,
    applicable: applicable.length,
    next,
    stale,
    gates
  };
}

/** Everything in one call, for the common case. */
export function readinessFor(facts: SubsystemFacts, signOffs: GateSignOff[]): Readiness {
  return rollUp(facts, evaluateGates(facts, signOffs));
}

/* -------------------------------------------------------------------------
 * Who may do what
 *
 * A subsystem lead endorses; only the Chief Engineer or an Admin approves. And
 * nobody approves their own endorsement of the Tested gate — "it works" is the
 * one claim that must pass through two sets of eyes, because it is the claim
 * most expensive to get wrong and the easiest to assert from enthusiasm.
 *
 * Pure predicates returning a REASON rather than a boolean: the API hands the
 * reason straight to the person, so a refusal says why instead of 403.
 * ---------------------------------------------------------------------- */

export type Role = "ADMIN" | "CHIEF_ENGINEER" | "TEAM_LEADER" | "TEAM_MEMBER";

export interface Actor {
  id: string;
  role: Role;
  /** True when this person leads the subsystem the gate belongs to. */
  leadsThisSubsystem: boolean;
  /** True when SOMEBODY leads it. A Chief stands in only when nobody does. */
  subsystemHasLead?: boolean;
}

/** Chief Engineer and Admin are the only approving roles. */
export function isApprover(role: Role): boolean {
  return role === "ADMIN" || role === "CHIEF_ENGINEER";
}

/**
 * Can this person put the gate forward? Null means yes.
 */
export function endorseProblem(actor: Actor, gate: GateStatus): string | null {
  if (actor.role === "TEAM_MEMBER") {
    return "Only the subsystem lead can endorse a gate. Ask your lead to put it forward.";
  }
  // The RESPONSIBLE lead endorses. A Chief or Admin may stand in only where
  // the subsystem has no lead at all — otherwise the rule that a lead puts
  // work forward is one the two most senior people can bypass whenever it is
  // convenient, and two-stage sign-off collapses back into one signature.
  if (!actor.leadsThisSubsystem) {
    if (!isApprover(actor.role)) {
      return "You lead a different subsystem. Only this subsystem's lead can endorse this gate.";
    }
    if (actor.subsystemHasLead !== false) {
      return (
        "This subsystem has a lead, and endorsing is their call — you approve what they put forward. " +
        "If they are unavailable, assign the lead role to somebody else first."
      );
    }
  }
  if (gate.state === "BLOCKED") {
    return `${gate.label} cannot be endorsed yet — ${gate.detail.toLowerCase()}.`;
  }
  if (gate.state === "PASSED") return `${gate.label} has already been approved.`;
  if (gate.state === "ENDORSED") return `${gate.label} is already endorsed and waiting on the Chief Engineer.`;
  if (gate.state === "NOT_APPLICABLE") return `${gate.label} is marked out of scope. Put it back in scope first.`;
  return null;
}

/**
 * Can this person close the gate? Null means yes.
 *
 * `endorsedBy` is passed separately rather than read off the gate, so the check
 * works on the row being written as well as on one already stored.
 */
export function approveProblem(
  actor: Actor,
  gate: GateStatus,
  endorsedBy: string | null
): string | null {
  if (!isApprover(actor.role)) {
    return "Only the Chief Engineer or an Admin can approve a gate. Endorse it instead and it will go to them.";
  }
  if (gate.state === "PASSED") return `${gate.label} has already been approved.`;
  if (gate.state === "BLOCKED") {
    return `${gate.label} cannot be approved yet — ${gate.detail.toLowerCase()}.`;
  }
  if (!endorsedBy) {
    return `${gate.label} has not been endorsed by the subsystem lead yet. It should come up through them.`;
  }
  // The one hard separation. Everything else a Chief can do end to end.
  if (gate.gate === "TESTED" && endorsedBy === actor.id) {
    return (
      "You endorsed this Tested gate, so somebody else has to approve it. " +
      "A test signed off by one person is an opinion."
    );
  }
  if (gate.requiresEvidence && gate.state !== "ENDORSED") {
    return `${gate.label} needs evidence attached before it can be approved.`;
  }
  return null;
}

/**
 * Marking a gate out of scope. Needs a reason, and the reason is published on
 * the subsystem page — an unexplained N/A is indistinguishable from hiding
 * work, and the whole model rests on the denominator being honest.
 */
export function notApplicableProblem(actor: Actor, gate: GateStatus, reason: string): string | null {
  if (!isApprover(actor.role)) {
    return "Only the Chief Engineer or an Admin can mark a gate out of scope.";
  }
  if (reason.trim().length < 10) {
    return "Give a reason of at least a few words. It is shown on the subsystem page next to the gate.";
  }
  if (gate.gate === "SCOPED") {
    return "Scoped cannot be marked out of scope — it is the gate that asserts the part list is complete.";
  }
  return null;
}

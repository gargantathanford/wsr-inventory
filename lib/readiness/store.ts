import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";
import {
  evaluateGates,
  rollUp,
  GATE_BY_ID,
  endorseProblem,
  approveProblem,
  notApplicableProblem,
  type Actor,
  type GateId,
  type GateSignOff,
  type InterfaceFacts,
  type PartFacts,
  type Readiness,
  type SubsystemFacts
} from "./gates";

/**
 * The database layer for gate-based readiness.
 *
 * All the judgement lives in gates.ts, which is pure and tested without a
 * server. This file only reads rows, writes rows, and refuses writes the pure
 * predicates say to refuse. Keeping the split sharp is what let the rules be
 * argued over before anything depended on them.
 */

/**
 * A part is "manufactured" when the team makes it rather than buys it.
 *
 * There is no made-vs-bought column, so this is inferred: a part with a
 * supplier or a purchase URL is bought; one whose status has passed through
 * MANUFACTURING is made; everything else is treated as bought, because the
 * Procured gate is the cheaper of the two to satisfy and guessing "made" would
 * open a Manufactured gate for parts nobody ever intends to build.
 *
 * Inferring rather than asking is the right trade today — the alternative is a
 * column on 157 workbook rows that nobody fills in — but it IS a guess, and a
 * `make_or_buy` column is the honest fix if leads start arguing with the gate.
 */
function inferManufactured(row: { supplier: string | null; purchase_url: string | null; status: string }): boolean {
  if (row.status === "MANUFACTURING") return true;
  return !row.supplier && !row.purchase_url;
}

/**
 * Parts that are not fitted to the car: tooling, consumables, spares.
 *
 * Also inferred, from the part's own category text. A spare bolt kit holding
 * the Installed gate open forever would train people to lie about status.
 */
const NOT_FITTED = /\b(spare|consumable|tool|tooling|fixture|jig|ppe|fastener kit)\b/i;

function loadFacts(subsystemId: string): SubsystemFacts {
  const db = getDb();

  const sub = db
    .prepare(`SELECT part_list_declared_complete AS d, mass_budget_kg FROM subsystems WHERE id = ?`)
    .get(subsystemId) as { d: number; mass_budget_kg: number | null } | undefined;

  const partRows = db
    .prepare(
      `SELECT p.id, p.design_status, p.status, p.supplier, p.purchase_url, p.category, p.part_name,
              p.weight_kg, p.allocated_mass_kg, p.mass_not_applicable,
              -- entity_type/entity_id, matching getRuleCitations. There is no
              -- part_id on this table, and cited_by is the user who added it.
              (SELECT COUNT(*) FROM rule_citations rc
                WHERE rc.entity_type = 'PART' AND rc.entity_id = p.id) AS citations
         FROM parts p
        WHERE p.subsystem_id = ?`
    )
    .all(subsystemId) as Array<{
    id: string;
    design_status: string;
    status: string;
    supplier: string | null;
    purchase_url: string | null;
    category: string | null;
    part_name: string;
    weight_kg: number | null;
    allocated_mass_kg: number | null;
    mass_not_applicable: number;
    citations: number;
  }>;

  const parts: PartFacts[] = partRows.map((r) => ({
    id: r.id,
    name: r.part_name,
    designStatus: r.design_status,
    status: r.status,
    citationCount: r.citations,
    isManufactured: inferManufactured(r),
    isFitted: !NOT_FITTED.test(`${r.category ?? ""} ${r.part_name}`),
    // Per unit, both of them — the gate asks whether this part's mass is
    // KNOWN, not what the line total comes to.
    massKg: r.weight_kg,
    allocatedMassKg: r.allocated_mass_kg,
    massNotApplicable: !!r.mass_not_applicable
  }));

  // Interfaces on EITHER side. A joint is one row shared by two subsystems, so
  // both of them see it and both are held by it — which is the point.
  const ifaceRows = db
    .prepare(
      `SELECT i.interface_ref, i.priority, i.status, i.agreed_by_a, i.agreed_by_b,
              i.subsystem_a_id, i.subsystem_b_id,
              sa.name AS a_name, sb.name AS b_name
         FROM interfaces i
         LEFT JOIN subsystems sa ON sa.id = i.subsystem_a_id
         LEFT JOIN subsystems sb ON sb.id = i.subsystem_b_id
        WHERE i.subsystem_a_id = ? OR i.subsystem_b_id = ?`
    )
    .all(subsystemId, subsystemId) as Array<{
    interface_ref: string;
    priority: string;
    status: string;
    agreed_by_a: string | null;
    agreed_by_b: string | null;
    subsystem_a_id: string | null;
    subsystem_b_id: string | null;
    a_name: string | null;
    b_name: string | null;
  }>;

  const interfaces: InterfaceFacts[] = ifaceRows.map((r) => ({
    ref: r.interface_ref,
    priority: (r.priority as "P1" | "P2" | "P3") ?? "P2",
    status: r.status,
    agreedBothSides: !!r.agreed_by_a && !!r.agreed_by_b,
    counterpart: (r.subsystem_a_id === subsystemId ? r.b_name : r.a_name) ?? "an unassigned subsystem"
  }));

  // A test record is a document attached to this subsystem that reads as test
  // evidence. Deliberately not "any document": a CAD model is not a test.
  //
  // doc_type has no TEST_REPORT value in its CHECK constraint, and widening
  // that constraint means rebuilding the table on every existing database — so
  // this matches on the free-text category and title instead. It is a looser
  // check than it should be, and the honest fix is a TEST_REPORT doc_type in a
  // later migration; the Tested gate still needs a person to sign it either
  // way, so a false positive here cannot close a gate on its own.
  const tests = db
    .prepare(
      `SELECT COUNT(*) AS n FROM documents
        WHERE subsystem_id = ?
          AND (doc_type = 'TECHNICAL_NOTE' OR doc_type = 'PDF' OR doc_type = 'SPREADSHEET')
          AND (COALESCE(category,'') LIKE '%test%' COLLATE NOCASE
               OR title LIKE '%test%' COLLATE NOCASE)`
    )
    .get(subsystemId) as { n: number } | undefined;

  return {
    partListDeclaredComplete: !!sub?.d,
    parts,
    interfaces,
    testsWithEvidence: tests?.n ?? 0,
    massBudgetKg: sub?.mass_budget_kg ?? null
  };
}

function loadSignOffs(subsystemId: string): GateSignOff[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT gate, decision, reason, endorsed_by, endorsed_at, approved_by, approved_at
         FROM subsystem_gates WHERE subsystem_id = ?`
    )
    .all(subsystemId) as Array<{
    gate: string;
    decision: string;
    reason: string | null;
    endorsed_by: string | null;
    endorsed_at: string | null;
    approved_by: string | null;
    approved_at: string | null;
  }>;

  return rows.map((r) => ({
    gate: r.gate as GateId,
    decision: r.decision as "PASSED" | "NOT_APPLICABLE",
    reason: r.reason,
    endorsedBy: r.endorsed_by,
    endorsedAt: r.endorsed_at,
    approvedBy: r.approved_by,
    approvedAt: r.approved_at
  }));
}

/** Gate-based readiness for one subsystem. */
export function getReadiness(subsystemId: string): Readiness {
  const facts = loadFacts(subsystemId);
  return rollUp(facts, evaluateGates(facts, loadSignOffs(subsystemId)));
}

export interface SubsystemReadinessRow {
  id: string;
  code: string | null;
  name: string;
  slug: string;
  readiness: Readiness;
  partCount: number;
}

/**
 * Every subsystem, for the dashboard and the schematic.
 *
 * Includes subsystems with no parts — they are 0%, which is the true answer and
 * the whole reason the old metric was wrong.
 */
export function getAllReadiness(): SubsystemReadinessRow[] {
  const db = getDb();
  const subs = db
    .prepare(`SELECT id, code, name, slug FROM subsystems ORDER BY name`)
    .all() as Array<{ id: string; code: string | null; name: string; slug: string }>;

  return subs.map((s) => {
    const facts = loadFacts(s.id);
    return {
      ...s,
      readiness: rollUp(facts, evaluateGates(facts, loadSignOffs(s.id))),
      partCount: facts.parts.length
    };
  });
}

/** Keyed by workbook code, for BuildSchematic. */
export function getReadinessByCode(): Record<string, SubsystemReadinessRow> {
  const out: Record<string, SubsystemReadinessRow> = {};
  for (const row of getAllReadiness()) if (row.code) out[row.code] = row;
  return out;
}

function actorFor(subsystemId: string, user: { id: string; role: string }): Actor {
  const db = getDb();
  const leads = db
    .prepare(
      `SELECT 1 FROM subsystem_members
        WHERE user_id = ? AND subsystem_id = ? AND role_in_subsystem = 'LEADER'`
    )
    .get(user.id, subsystemId);
  // Whether ANYBODY leads it, so a Chief can stand in for an unled subsystem
  // without being able to bypass a lead who exists.
  const anyLead = db
    .prepare(`SELECT 1 FROM subsystem_members WHERE subsystem_id = ? AND role_in_subsystem = 'LEADER'`)
    .get(subsystemId);
  return {
    id: user.id,
    role: user.role as Actor["role"],
    leadsThisSubsystem: !!leads,
    subsystemHasLead: !!anyLead
  };
}

function log(subsystemId: string, gate: GateId, action: string, actorId: string, note: string | null) {
  getDb()
    .prepare(
      `INSERT INTO subsystem_gate_log (id, subsystem_id, gate, action, actor_id, note)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(newId("glog"), subsystemId, gate, action, actorId, note);
}

/** Either the refusal reason, or null and the write happened. */
export type WriteResult = { ok: true } | { ok: false; reason: string };

/**
 * A lead puts a gate forward.
 *
 * The evidence requirement is enforced here rather than in the pure module,
 * because "is there a document" is a database question.
 */
export function endorseGate(
  subsystemId: string,
  gate: GateId,
  user: { id: string; role: string },
  note: string | null,
  evidenceDocumentId: string | null
): WriteResult {
  const db = getDb();
  const current = getReadiness(subsystemId).gates.find((g) => g.gate === gate);
  if (!current) return { ok: false, reason: `Unknown gate ${gate}.` };

  const problem = endorseProblem(actorFor(subsystemId, user), current);
  if (problem) return { ok: false, reason: problem };

  if (GATE_BY_ID[gate].requiresEvidence && !evidenceDocumentId && !note?.trim()) {
    return {
      ok: false,
      reason:
        `${GATE_BY_ID[gate].label} needs evidence — attach a document, or write what was checked and how. ` +
        `This gate is one the design judges will ask about.`
    };
  }

  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  db.prepare(
    `INSERT INTO subsystem_gates (id, subsystem_id, gate, decision, reason, endorsed_by, endorsed_at, evidence_document_id, evidence_note)
     VALUES (?, ?, ?, 'PASSED', ?, ?, ?, ?, ?)
     ON CONFLICT (subsystem_id, gate) DO UPDATE SET
       decision = 'PASSED',
       reason = excluded.reason,
       endorsed_by = excluded.endorsed_by,
       endorsed_at = excluded.endorsed_at,
       -- Clears any previous approval. In practice endorseProblem refuses an
       -- already-decided gate, so this is a safety net rather than the normal
       -- path: changing an approved gate goes through reopenGate, which leaves
       -- a REOPENED row in the log. If this clause ever does fire, clearing the
       -- approval is the right behaviour — the thing that was approved has
       -- changed, so the old signature does not apply to it.
       approved_by = NULL,
       approved_at = NULL,
       evidence_document_id = excluded.evidence_document_id,
       evidence_note = excluded.evidence_note,
       updated_at = datetime('now')`
  ).run(newId("gate"), subsystemId, gate, note, user.id, now, evidenceDocumentId, note);

  log(subsystemId, gate, "ENDORSED", user.id, note);
  return { ok: true };
}

/** The Chief Engineer or an Admin closes it. */
export function approveGate(
  subsystemId: string,
  gate: GateId,
  user: { id: string; role: string },
  note: string | null
): WriteResult {
  const db = getDb();
  const readiness = getReadiness(subsystemId);
  const current = readiness.gates.find((g) => g.gate === gate);
  if (!current) return { ok: false, reason: `Unknown gate ${gate}.` };

  const row = db
    .prepare(`SELECT endorsed_by FROM subsystem_gates WHERE subsystem_id = ? AND gate = ?`)
    .get(subsystemId, gate) as { endorsed_by: string | null } | undefined;

  const problem = approveProblem(actorFor(subsystemId, user), current, row?.endorsed_by ?? null);
  if (problem) return { ok: false, reason: problem };

  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  db.prepare(
    `UPDATE subsystem_gates SET approved_by = ?, approved_at = ?, updated_at = datetime('now')
      WHERE subsystem_id = ? AND gate = ?`
  ).run(user.id, now, subsystemId, gate);

  log(subsystemId, gate, "APPROVED", user.id, note);
  return { ok: true };
}

/**
 * Withdraw an endorsement that went in too early.
 *
 * The lead who endorsed can take it back, and so can a Chief. Without this the
 * only route out of a premature endorsement was for the Chief to approve it
 * and then reopen it — which puts a signature in the log that nobody meant,
 * and leaves the history saying the gate passed when it never did.
 *
 * Only an UNAPPROVED endorsement can be withdrawn. Once it is approved the
 * route is reopenGate, which is deliberately louder and demands a reason.
 */
export function withdrawEndorsement(
  subsystemId: string,
  gate: GateId,
  user: { id: string; role: string }
): WriteResult {
  const db = getDb();
  const row = db
    .prepare(`SELECT endorsed_by, approved_by, decision FROM subsystem_gates WHERE subsystem_id = ? AND gate = ?`)
    .get(subsystemId, gate) as
    | { endorsed_by: string | null; approved_by: string | null; decision: string }
    | undefined;

  if (!row || !row.endorsed_by) return { ok: false, reason: "That gate has not been endorsed." };
  if (row.approved_by) {
    return {
      ok: false,
      reason:
        "That gate has already been approved, so withdrawing the endorsement would not change " +
        "anything. Reopen it instead — that asks for a reason and records it."
    };
  }

  const actor = actorFor(subsystemId, user);
  const isApproverRole = user.role === "ADMIN" || user.role === "CHIEF_ENGINEER";
  if (row.endorsed_by !== user.id && !isApproverRole) {
    return { ok: false, reason: "Only the person who endorsed it, or the Chief Engineer, can withdraw it." };
  }

  db.prepare(`DELETE FROM subsystem_gates WHERE subsystem_id = ? AND gate = ?`).run(subsystemId, gate);
  log(subsystemId, gate, "REOPENED", user.id, "endorsement withdrawn");
  return { ok: true };
}

/** Put a closed gate back into play. */
export function reopenGate(
  subsystemId: string,
  gate: GateId,
  user: { id: string; role: string },
  reason: string
): WriteResult {
  if (user.role !== "ADMIN" && user.role !== "CHIEF_ENGINEER") {
    return { ok: false, reason: "Only the Chief Engineer or an Admin can reopen a gate." };
  }
  if (reason.trim().length < 10) {
    return { ok: false, reason: "Say why it is being reopened. It goes in the gate history." };
  }
  getDb()
    .prepare(`DELETE FROM subsystem_gates WHERE subsystem_id = ? AND gate = ?`)
    .run(subsystemId, gate);
  log(subsystemId, gate, "REOPENED", user.id, reason);
  return { ok: true };
}

/** Mark a gate out of scope for the season, with a published reason. */
export function markNotApplicable(
  subsystemId: string,
  gate: GateId,
  user: { id: string; role: string },
  reason: string
): WriteResult {
  const current = getReadiness(subsystemId).gates.find((g) => g.gate === gate);
  if (!current) return { ok: false, reason: `Unknown gate ${gate}.` };

  const problem = notApplicableProblem(actorFor(subsystemId, user), current, reason);
  if (problem) return { ok: false, reason: problem };

  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  getDb()
    .prepare(
      `INSERT INTO subsystem_gates (id, subsystem_id, gate, decision, reason, approved_by, approved_at)
       VALUES (?, ?, ?, 'NOT_APPLICABLE', ?, ?, ?)
       ON CONFLICT (subsystem_id, gate) DO UPDATE SET
         decision = 'NOT_APPLICABLE', reason = excluded.reason,
         approved_by = excluded.approved_by, approved_at = excluded.approved_at,
         endorsed_by = NULL, endorsed_at = NULL, updated_at = datetime('now')`
    )
    .run(newId("gate"), subsystemId, gate, reason, user.id, now);

  log(subsystemId, gate, "MARKED_NA", user.id, reason);
  return { ok: true };
}

/**
 * Declare the part list complete. This is what the SCOPED gate derives from,
 * and it is a lead's assertion, not a count.
 */
export function declarePartListComplete(
  subsystemId: string,
  user: { id: string; role: string },
  complete: boolean
): WriteResult {
  const actor = actorFor(subsystemId, user);
  if (actor.role === "TEAM_MEMBER") {
    return { ok: false, reason: "Only the subsystem lead can declare the part list complete." };
  }
  if (actor.role === "TEAM_LEADER" && !actor.leadsThisSubsystem) {
    return { ok: false, reason: "You lead a different subsystem." };
  }
  getDb()
    .prepare(`UPDATE subsystems SET part_list_declared_complete = ? WHERE id = ?`)
    .run(complete ? 1 : 0, subsystemId);
  return { ok: true };
}

/**
 * One side agrees an interface. Both sides must, independently.
 *
 * The lead of subsystem A can only set A's agreement, and B's lead only B's —
 * which is what makes `agreedBothSides` mean something. A Chief or Admin can
 * set either side, since they can already approve any gate.
 */
export function agreeInterface(
  interfaceRef: string,
  user: { id: string; role: string }
): WriteResult {
  const db = getDb();
  const row = db
    .prepare(`SELECT id, subsystem_a_id, subsystem_b_id, agreed_by_a, agreed_by_b FROM interfaces WHERE interface_ref = ?`)
    .get(interfaceRef) as
    | { id: string; subsystem_a_id: string | null; subsystem_b_id: string | null; agreed_by_a: string | null; agreed_by_b: string | null }
    | undefined;
  if (!row) return { ok: false, reason: `No interface ${interfaceRef}.` };

  const isChief = user.role === "ADMIN" || user.role === "CHIEF_ENGINEER";
  const leadsA = !!row.subsystem_a_id && actorFor(row.subsystem_a_id, user).leadsThisSubsystem;
  const leadsB = !!row.subsystem_b_id && actorFor(row.subsystem_b_id, user).leadsThisSubsystem;

  if (!isChief && !leadsA && !leadsB) {
    return {
      ok: false,
      reason: "Only the leads of the two subsystems either side of this interface can agree it."
    };
  }

  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  // A lead agrees their own side. A Chief filling in for an unled subsystem
  // takes whichever side is still outstanding.
  const side = leadsA ? "a" : leadsB ? "b" : row.agreed_by_a ? "b" : "a";
  db.prepare(
    `UPDATE interfaces SET agreed_by_${side} = ?, agreed_${side}_at = ?,
            status = CASE WHEN agreed_by_a IS NOT NULL AND agreed_by_b IS NOT NULL THEN 'AGREED' ELSE 'IN_WORK' END,
            updated_at = datetime('now')
      WHERE id = ?`
  ).run(user.id, now, row.id);

  // Re-read: the CASE above evaluated against the pre-update values, so the
  // second side's agreement needs one more pass to flip the status to AGREED.
  // Doing it as a separate statement rather than cleverly, because a status
  // that says AGREED when only one side has signed is the exact bug this
  // whole column pair exists to prevent.
  db.prepare(
    `UPDATE interfaces SET status = 'AGREED'
      WHERE id = ? AND agreed_by_a IS NOT NULL AND agreed_by_b IS NOT NULL AND status != 'CLOSED'`
  ).run(row.id);

  return { ok: true };
}

/**
 * Vehicle-wide readiness: the mean of every subsystem's gate percentage.
 *
 * A mean of percentages, NOT total gates closed over total gates. Weighting by
 * gate count would let a subsystem with many parts dominate the headline, which
 * is the same category of mistake as the part-count metric this replaces: the
 * number would move when somebody typed, not when work got done.
 *
 * Subsystems with no parts are included, at 0%. Excluding them would make the
 * vehicle look more finished for every subsystem nobody had started — exactly
 * backwards.
 */
export function getVehicleReadiness(): {
  pct: number;
  subsystems: number;
  fullyClosed: number;
  capped: number;
  stale: number;
} {
  const all = getAllReadiness();
  if (all.length === 0) return { pct: 0, subsystems: 0, fullyClosed: 0, capped: 0, stale: 0 };
  const sum = all.reduce((s, r) => s + r.readiness.pct, 0);
  return {
    pct: Math.round(sum / all.length),
    subsystems: all.length,
    fullyClosed: all.filter((r) => r.readiness.pct === 100).length,
    capped: all.filter((r) => r.readiness.ceiling !== null).length,
    stale: all.reduce((s, r) => s + r.readiness.stale.length, 0)
  };
}

/**
 * Mass standing for one subsystem: what it is committed to against its budget.
 *
 * Quantity matters here where it does not in the gate. The gate asks whether a
 * part's mass is KNOWN, which is a per-unit question. The budget asks what the
 * car will weigh, which means four uprights at 1.2 kg is 4.8 kg.
 */
export function getMassStanding(subsystemId: string): {
  budgetKg: number | null;
  committedKg: number;
  measuredKg: number;
  allocatedOnlyKg: number;
  excusedParts: number;
  unknownParts: number;
  overBy: number | null;
} {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT weight_kg, allocated_mass_kg, mass_not_applicable, quantity_required, status
         FROM parts WHERE subsystem_id = ?`
    )
    .all(subsystemId) as Array<{
    weight_kg: number | null;
    allocated_mass_kg: number | null;
    mass_not_applicable: number;
    quantity_required: number;
    status: string;
  }>;

  const budget = (
    db.prepare(`SELECT mass_budget_kg FROM subsystems WHERE id = ?`).get(subsystemId) as
      | { mass_budget_kg: number | null }
      | undefined
  )?.mass_budget_kg ?? null;

  let measured = 0;
  let allocatedOnly = 0;
  let excused = 0;
  let unknown = 0;

  for (const r of rows) {
    if (r.status === "NO_LONGER_NEEDED") continue;
    if (r.mass_not_applicable) {
      excused++;
      continue;
    }
    const qty = r.quantity_required > 0 ? r.quantity_required : 1;
    if (typeof r.weight_kg === "number") measured += r.weight_kg * qty;
    else if (typeof r.allocated_mass_kg === "number") allocatedOnly += r.allocated_mass_kg * qty;
    else unknown++;
  }

  const committed = measured + allocatedOnly;
  return {
    budgetKg: budget,
    committedKg: committed,
    measuredKg: measured,
    allocatedOnlyKg: allocatedOnly,
    excusedParts: excused,
    unknownParts: unknown,
    overBy: budget && committed > budget ? committed - budget : null
  };
}

/** Vehicle-wide mass: every subsystem's budget and what is committed against it. */
export function getVehicleMass(): {
  budgetKg: number;
  committedKg: number;
  unbudgetedSubsystems: number;
  overBudgetSubsystems: number;
} {
  const db = getDb();
  const subs = db.prepare(`SELECT id, mass_budget_kg FROM subsystems`).all() as Array<{
    id: string;
    mass_budget_kg: number | null;
  }>;
  let budget = 0;
  let committed = 0;
  let unbudgeted = 0;
  let over = 0;
  for (const s of subs) {
    const m = getMassStanding(s.id);
    if (s.mass_budget_kg) budget += s.mass_budget_kg;
    else if (m.committedKg > 0) unbudgeted++;
    committed += m.committedKg;
    if (m.overBy !== null) over++;
  }
  return { budgetKg: budget, committedKg: committed, unbudgetedSubsystems: unbudgeted, overBudgetSubsystems: over };
}

/** A lead revising their own subsystem's mass budget. */
export function setMassBudget(
  subsystemId: string,
  user: { id: string; role: string },
  budgetKg: number | null
): WriteResult {
  const actor = actorFor(subsystemId, user);
  const isChief = user.role === "ADMIN" || user.role === "CHIEF_ENGINEER";
  if (!actor.leadsThisSubsystem && !isChief) {
    return { ok: false, reason: "Only this subsystem's lead or the Chief Engineer can change its mass budget." };
  }
  if (budgetKg !== null && (!Number.isFinite(budgetKg) || budgetKg <= 0)) {
    return { ok: false, reason: "A mass budget has to be a positive number of kilograms." };
  }
  getDb().prepare(`UPDATE subsystems SET mass_budget_kg = ? WHERE id = ?`).run(budgetKg, subsystemId);
  return { ok: true };
}

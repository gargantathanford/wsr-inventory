import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";
import { getSession, canEditSubsystem } from "@/lib/auth";
import { getPartById, getRuleCitations } from "@/lib/queries";
import { checkPartGates } from "@/lib/partRules";
import { awardQuietly, reverse } from "@/lib/xp/store";

const EDITABLE_FIELDS = [
  "part_name",
  "part_number",
  "manufacturer",
  "category",
  "subsystem_id",
  "description",
  "quantity_required",
  "quantity_owned",
  "status",
  "importance",
  "priority_score",
  "estimated_cost",
  "actual_cost",
  "shipping_cost",
  "lead_time_days",
  "estimated_delivery_date",
  "date_ordered",
  "date_received",
  "purchase_order_number",
  "purchase_url",
  "manufacturer_url",
  "supplier",
  "supplier_part_number",
  "weight_kg",
  "dimensions",
  "material",
  "operating_specifications",
  "required_by_date",
  "cad_status",
  "documentation_status",
  "purchase_status",
  "approval_status",
  "requested_by",
  // v2 workbook fields
  "design_status",
  "estimated_cost_low",
  "estimated_cost_high",
  "governing_rule",
  "driving_target",
  "acceptance_criterion",
  "sponsor_ask",
  "unit_of_measure",
  "allocated_mass_kg",
  "subteam_id"
];

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const part = getPartById(params.id);
  if (!part) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ part });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const existing = getPartById(params.id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canEditSubsystem(user, existing.subsystem_id)) {
    return NextResponse.json({ error: "You do not have edit access to this subsystem." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const updates: Record<string, any> = {};
  for (const field of EDITABLE_FIELDS) {
    if (field in body) updates[field] = body[field];
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
  }
  if (updates.subsystem_id && !canEditSubsystem(user, updates.subsystem_id)) {
    return NextResponse.json({ error: "You do not lead the target subsystem." }, { status: 403 });
  }

  // The gate belongs here as much as on create — otherwise a part is created
  // as PLACEHOLDER and patched straight to SELECTED, which is exactly how the
  // requirement would get bypassed in practice. Checked against the record as
  // it WILL be after the patch, with the real count of cited clauses.
  const merged = { ...existing, ...updates };
  const gates = checkPartGates({
    design_status: merged.design_status,
    acceptance_criterion: merged.acceptance_criterion,
    cited_rule_count: getRuleCitations("PART", params.id).length,
    governing_rule: merged.governing_rule,
    allocated_mass_kg: merged.allocated_mass_kg,
    weight_kg: merged.weight_kg
  });
  if (gates.errors.length) {
    return NextResponse.json({ error: gates.errors.join(" "), gate_errors: gates.errors }, { status: 422 });
  }

  const db = getDb();
  const setClause = Object.keys(updates)
    .map((k) => `${k} = @${k}`)
    .join(", ");
  db.prepare(`UPDATE parts SET ${setClause}, updated_at = @updated_at WHERE id = @id`).run({
    ...updates,
    updated_at: new Date().toISOString(),
    id: params.id
  });

  db.prepare(
    `INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, 'UPDATE', 'PART', ?, ?)`
  ).run(newId("log"), user.id, params.id, JSON.stringify(Object.keys(updates)));

  // --- XP on real design transitions, compared against the record BEFORE the
  // patch so re-saving an unchanged part pays nothing.

  // Design freeze: the highest-value transition in the build, and already gated
  // on an acceptance criterion and a cited rule. Approval-tier.
  if (merged.design_status === "FROZEN" && existing.design_status !== "FROZEN") {
    awardQuietly({
      userId: user.id,
      kind: "part.designFrozen",
      sourceType: "part",
      sourceId: params.id,
      transition: "frozen",
      at: new Date().toISOString(),
      subsystemId: merged.subsystem_id ?? null,
      selfVerified: existing.owner_user_id === user.id
    });
  }
  // Un-freezing means the award no longer describes reality.
  if (existing.design_status === "FROZEN" && merged.design_status !== "FROZEN") {
    reverse("part", params.id, "frozen", `Design status moved from FROZEN to ${merged.design_status}`);
  }

  // Sourced: vendor, cost AND lead time together. Any one of the three alone
  // is not sourcing, which is why this checks all three and fires on the
  // transition rather than on each edit.
  const sourced = (p: any) =>
    !!p.supplier && (p.estimated_cost != null || p.estimated_cost_low != null) && p.lead_time_days != null;
  if (sourced(merged) && !sourced(existing)) {
    awardQuietly({
      userId: user.id,
      kind: "part.sourced",
      sourceType: "part",
      sourceId: params.id,
      transition: "sourced",
      at: new Date().toISOString(),
      subsystemId: merged.subsystem_id ?? null
    });
  }

  // Long lead flagged early enough to matter: over 4 weeks of lead time, more
  // than 6 weeks before it is needed. Both numbers have to be present, which is
  // the point — this rewards knowing, not guessing.
  if (merged.lead_time_days != null && merged.required_by_date && !existing.required_by_date) {
    const weeksOfLead = merged.lead_time_days / 7;
    const daysUntilNeeded = (new Date(merged.required_by_date).getTime() - Date.now()) / 86_400_000;
    if (weeksOfLead > 4 && daysUntilNeeded > 42) {
      awardQuietly({
        userId: user.id,
        kind: "part.longLeadFlagged",
        sourceType: "part",
        sourceId: params.id,
        transition: "longLeadFlagged",
        at: new Date().toISOString(),
        subsystemId: merged.subsystem_id ?? null
      });
    }
  }

  return NextResponse.json({ ok: true, warnings: gates.warnings });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role === "TEAM_MEMBER") {
    return NextResponse.json({ error: "Team members cannot delete parts." }, { status: 403 });
  }
  const existing = getPartById(params.id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canEditSubsystem(user, existing.subsystem_id)) {
    return NextResponse.json({ error: "You do not have edit access to this subsystem." }, { status: 403 });
  }
  const db = getDb();
  db.prepare(`DELETE FROM parts WHERE id = ?`).run(params.id);
  db.prepare(
    `INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, 'DELETE', 'PART', ?, ?)`
  ).run(newId("log"), user.id, params.id, existing.part_name);
  return NextResponse.json({ ok: true });
}

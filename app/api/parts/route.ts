import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";
import { getSession, canEditSubsystem } from "@/lib/auth";
import { getAllParts } from "@/lib/queries";
import { checkPartGates, DESIGN_STATUSES, SPONSOR_ASKS } from "@/lib/partRules";
import { invalid, dbError, optionalRef, optionalText } from "@/lib/apiValidation";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const parts = getAllParts({
    subsystemId: searchParams.get("subsystem") || undefined,
    status: searchParams.get("status") || undefined,
    importance: searchParams.get("importance") || undefined,
    search: searchParams.get("q") || undefined
  });
  return NextResponse.json({ parts });
}

const PartInput = z.object({
  part_name: z.string().min(1),
  subsystem_id: z.string().min(1),
  quantity_required: z.coerce.number().int().min(1).default(1),
  quantity_owned: z.coerce.number().int().min(0).default(0),
  status: z.string().default("NEEDED"),
  importance: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).default("MEDIUM"),
  priority_score: z.coerce.number().int().min(1).max(10).default(5),
  part_number: z.string().optional().nullable(),
  manufacturer: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  estimated_cost: z.coerce.number().optional().nullable(),
  lead_time_days: z.coerce.number().int().optional().nullable(),
  purchase_url: z.string().optional().nullable(),
  supplier: z.string().optional().nullable(),
  purchase_status: z.string().default("NEEDED"),
  approval_status: z.string().default("APPROVED"),

  // ---- v2 workbook fields ----
  design_status: z.enum(DESIGN_STATUSES).default("PLACEHOLDER"),
  // Cost is a range until a quote lands. estimated_cost stays the single
  // working figure; if only the range is given, the midpoint is derived below.
  estimated_cost_low: z.coerce.number().optional().nullable(),
  estimated_cost_high: z.coerce.number().optional().nullable(),
  governing_rule: z.string().max(500).optional().nullable(),
  driving_target: z.string().max(300).optional().nullable(),
  acceptance_criterion: z.string().max(1000).optional().nullable(),
  // An empty select posts "", which is not a valid enum value — treat it as unset.
  sponsor_ask: z.preprocess((v) => (v === "" || v == null ? null : v), z.enum(SPONSOR_ASKS).nullable()).optional(),
  // Display preference only — storage is always kilograms. See lib/units.ts.
  mass_unit: z.enum(["kg", "g", "lb", "oz"]).default("kg"),
  mass_not_applicable: z.preprocess((v) => v === true || v === "true" || v === 1, z.boolean()).default(false),
  unit_of_measure: z.string().max(16).optional().nullable(),
  allocated_mass_kg: z.coerce.number().optional().nullable(),
  weight_kg: z.coerce.number().optional().nullable(),
  required_by_date: z.string().max(32).optional().nullable(),
  subteam_id: z.preprocess((v) => (v === "" ? null : v), z.string().nullable()).optional()
});

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role === "TEAM_MEMBER") {
    return NextResponse.json(
      { error: "Team members can propose parts but cannot add directly. Ask your subsystem leader." },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = PartInput.safeParse(body);
  if (!parsed.success) {
    return invalid(parsed.error);
  }
  const data = parsed.data;

  if (!canEditSubsystem(user, data.subsystem_id)) {
    return NextResponse.json({ error: "You do not lead this subsystem." }, { status: 403 });
  }

  // A new part cannot carry rule citations yet — they are attached from the
  // part page once it exists — so a SELECTED/FROZEN part created in one step
  // may satisfy the rule gate with the free-text governing_rule field.
  const gates = checkPartGates({
    design_status: data.design_status,
    acceptance_criterion: data.acceptance_criterion,
    cited_rule_count: 0,
    governing_rule: data.governing_rule,
    allocated_mass_kg: data.allocated_mass_kg,
    weight_kg: data.weight_kg
  });
  if (gates.errors.length) {
    return NextResponse.json({ error: gates.errors.join(" "), gate_errors: gates.errors }, { status: 422 });
  }

  // Keep the three cost figures consistent: a midpoint is derived when only the
  // range was given, and a single figure fills an absent range.
  const lo = data.estimated_cost_low ?? null;
  const hi = data.estimated_cost_high ?? null;
  const mid = data.estimated_cost ?? (lo != null && hi != null ? (lo + hi) / 2 : (lo ?? hi));

  const db = getDb();
  const id = newId("part");
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO parts (
      id, part_name, part_number, manufacturer, category, subsystem_id, description,
      quantity_required, quantity_owned, status, importance, priority_score,
      estimated_cost, lead_time_days, purchase_url, supplier, owner_user_id, requested_by,
      purchase_status, approval_status, created_at, updated_at,
      design_status, estimated_cost_low, estimated_cost_high, governing_rule, driving_target,
      acceptance_criterion, sponsor_ask, unit_of_measure, allocated_mass_kg, weight_kg,
      mass_unit, mass_not_applicable,
      required_by_date, subteam_id
    ) VALUES (@id, @part_name, @part_number, @manufacturer, @category, @subsystem_id, @description,
      @quantity_required, @quantity_owned, @status, @importance, @priority_score,
      @estimated_cost, @lead_time_days, @purchase_url, @supplier, @owner_user_id, @requested_by,
      @purchase_status, @approval_status, @created_at, @updated_at,
      @design_status, @estimated_cost_low, @estimated_cost_high, @governing_rule, @driving_target,
      @acceptance_criterion, @sponsor_ask, @unit_of_measure, @allocated_mass_kg, @weight_kg,
      @mass_unit, @mass_not_applicable,
      @required_by_date, @subteam_id)`
  ).run({
    id,
    part_name: data.part_name,
    part_number: data.part_number ?? null,
    manufacturer: data.manufacturer ?? null,
    category: data.category ?? null,
    subsystem_id: data.subsystem_id,
    description: data.description ?? null,
    quantity_required: data.quantity_required,
    quantity_owned: data.quantity_owned,
    status: data.status,
    importance: data.importance,
    priority_score: data.priority_score,
    estimated_cost: mid,
    lead_time_days: data.lead_time_days ?? null,
    purchase_url: data.purchase_url ?? null,
    supplier: data.supplier ?? null,
    owner_user_id: user.id,
    requested_by: user.id,
    purchase_status: data.purchase_status,
    approval_status: data.approval_status,
    created_at: now,
    updated_at: now,
    design_status: data.design_status,
    estimated_cost_low: lo,
    estimated_cost_high: hi,
    governing_rule: data.governing_rule ?? null,
    driving_target: data.driving_target ?? null,
    acceptance_criterion: data.acceptance_criterion ?? null,
    sponsor_ask: data.sponsor_ask ?? null,
    mass_unit: data.mass_unit,
    mass_not_applicable: data.mass_not_applicable ? 1 : 0,
    unit_of_measure: data.unit_of_measure ?? null,
    allocated_mass_kg: data.allocated_mass_kg ?? null,
    weight_kg: data.weight_kg ?? null,
    required_by_date: data.required_by_date ?? null,
    subteam_id: data.subteam_id ?? null
  });

  db.prepare(
    `INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, 'CREATE', 'PART', ?, ?)`
  ).run(newId("log"), user.id, id, data.part_name);

  // Warnings are advisory — the part is already saved. The form surfaces them
  // so a lead sees an over-allocation rather than discovering it at weigh-in.
  return NextResponse.json({ id, warnings: gates.warnings }, { status: 201 });
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";
import { getSession, canEditSubsystem } from "@/lib/auth";
import { getAllParts } from "@/lib/queries";

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
  approval_status: z.string().default("APPROVED")
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
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  if (!canEditSubsystem(user, data.subsystem_id)) {
    return NextResponse.json({ error: "You do not lead this subsystem." }, { status: 403 });
  }

  const db = getDb();
  const id = newId("part");
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO parts (
      id, part_name, part_number, manufacturer, category, subsystem_id, description,
      quantity_required, quantity_owned, status, importance, priority_score,
      estimated_cost, lead_time_days, purchase_url, supplier, owner_user_id, requested_by,
      purchase_status, approval_status, created_at, updated_at
    ) VALUES (@id, @part_name, @part_number, @manufacturer, @category, @subsystem_id, @description,
      @quantity_required, @quantity_owned, @status, @importance, @priority_score,
      @estimated_cost, @lead_time_days, @purchase_url, @supplier, @owner_user_id, @requested_by,
      @purchase_status, @approval_status, @created_at, @updated_at)`
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
    estimated_cost: data.estimated_cost ?? null,
    lead_time_days: data.lead_time_days ?? null,
    purchase_url: data.purchase_url ?? null,
    supplier: data.supplier ?? null,
    owner_user_id: user.id,
    requested_by: user.id,
    purchase_status: data.purchase_status,
    approval_status: data.approval_status,
    created_at: now,
    updated_at: now
  });

  db.prepare(
    `INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, 'CREATE', 'PART', ?, ?)`
  ).run(newId("log"), user.id, id, data.part_name);

  return NextResponse.json({ id }, { status: 201 });
}

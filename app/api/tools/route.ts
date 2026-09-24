import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";
import { getSession } from "@/lib/auth";
import { getAllTools } from "@/lib/queries";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tools = getAllTools({
    search: searchParams.get("q") || undefined,
    status: searchParams.get("status") || undefined
  });
  return NextResponse.json({ tools });
}

const ToolInput = z.object({
  tool_name: z.string().min(1),
  tool_category: z.string().optional().nullable(),
  manufacturer: z.string().optional().nullable(),
  model_number: z.string().optional().nullable(),
  serial_number: z.string().optional().nullable(),
  asset_number: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  quantity_owned: z.coerce.number().int().min(0).default(1),
  storage_location: z.string().optional().nullable(),
  storage_area: z.string().optional().nullable(),
  responsible_subsystem_id: z.string().optional().nullable(),
  condition: z.string().default("GOOD"),
  status: z.string().default("AVAILABLE"),
  date_acquired: z.string().optional().nullable(),
  purchase_cost: z.coerce.number().optional().nullable(),
  replacement_cost: z.coerce.number().optional().nullable(),
  notes: z.string().optional().nullable(),
  instructions: z.string().optional().nullable(),
  safety_requirements: z.string().optional().nullable(),
  subsystem_ids: z.array(z.string()).optional().default([])
});

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role === "TEAM_MEMBER") {
    return NextResponse.json({ error: "Team members cannot add tools." }, { status: 403 });
  }
  const parsed = ToolInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const data = parsed.data;

  const db = getDb();
  const id = newId("tool");
  db.prepare(
    `INSERT INTO tools (
      id, tool_name, tool_category, manufacturer, model_number, serial_number, asset_number, description,
      quantity_owned, storage_location, storage_area, responsible_subsystem_id, condition, status,
      date_acquired, purchase_cost, replacement_cost, notes, instructions, safety_requirements, created_by
    ) VALUES (@id, @tool_name, @tool_category, @manufacturer, @model_number, @serial_number, @asset_number, @description,
      @quantity_owned, @storage_location, @storage_area, @responsible_subsystem_id, @condition, @status,
      @date_acquired, @purchase_cost, @replacement_cost, @notes, @instructions, @safety_requirements, @created_by)`
  ).run({
    id,
    tool_name: data.tool_name,
    tool_category: data.tool_category ?? null,
    manufacturer: data.manufacturer ?? null,
    model_number: data.model_number ?? null,
    serial_number: data.serial_number ?? null,
    asset_number: data.asset_number ?? null,
    description: data.description ?? null,
    quantity_owned: data.quantity_owned,
    storage_location: data.storage_location ?? null,
    storage_area: data.storage_area ?? null,
    responsible_subsystem_id: data.responsible_subsystem_id ?? null,
    condition: data.condition,
    status: data.status,
    date_acquired: data.date_acquired ?? null,
    purchase_cost: data.purchase_cost ?? null,
    replacement_cost: data.replacement_cost ?? null,
    notes: data.notes ?? null,
    instructions: data.instructions ?? null,
    safety_requirements: data.safety_requirements ?? null,
    created_by: user.id
  });
  const insertSub = db.prepare(`INSERT INTO tool_subsystems (id, tool_id, subsystem_id) VALUES (?, ?, ?)`);
  for (const sid of data.subsystem_ids) insertSub.run(newId("tsub"), id, sid);

  db.prepare(
    `INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, 'CREATE', 'TOOL', ?, ?)`
  ).run(newId("log"), user.id, id, data.tool_name);

  return NextResponse.json({ id }, { status: 201 });
}

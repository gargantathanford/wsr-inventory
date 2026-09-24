import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";
import { getSession } from "@/lib/auth";
import { getToolById } from "@/lib/queries";

const EDITABLE_FIELDS = [
  "tool_name",
  "tool_category",
  "manufacturer",
  "model_number",
  "quantity_owned",
  "storage_location",
  "condition",
  "calibration_date",
  "status",
  "instructions",
  "safety_requirements"
];

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const tool = getToolById(params.id);
  if (!tool) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ tool });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role === "TEAM_MEMBER") {
    return NextResponse.json({ error: "Team members cannot edit tools." }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const updates: Record<string, any> = {};
  for (const field of EDITABLE_FIELDS) if (field in body) updates[field] = body[field];
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
  }
  const db = getDb();
  const setClause = Object.keys(updates)
    .map((k) => `${k} = @${k}`)
    .join(", ");
  db.prepare(`UPDATE tools SET ${setClause} WHERE id = @id`).run({ ...updates, id: params.id });
  db.prepare(
    `INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, 'UPDATE', 'TOOL', ?, ?)`
  ).run(newId("log"), user.id, params.id, JSON.stringify(Object.keys(updates)));
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ error: "Admin only." }, { status: 403 });
  const db = getDb();
  const tool = db.prepare(`SELECT tool_name FROM tools WHERE id = ?`).get(params.id) as { tool_name: string } | undefined;
  db.prepare(`DELETE FROM tools WHERE id = ?`).run(params.id);
  db.prepare(
    `INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, 'DELETE', 'TOOL', ?, ?)`
  ).run(newId("log"), user.id, params.id, tool?.tool_name || params.id);
  return NextResponse.json({ ok: true });
}

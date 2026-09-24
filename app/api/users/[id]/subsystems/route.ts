import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";
import { getSession } from "@/lib/auth";

async function requireAdmin() {
  const user = await getSession();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (user.role !== "ADMIN") return { error: NextResponse.json({ error: "Admin only." }, { status: 403 }) };
  return { user };
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  const body = await req.json().catch(() => ({}));
  const subsystemId = body.subsystem_id;
  const roleInSubsystem = body.role_in_subsystem === "LEADER" ? "LEADER" : "MEMBER";
  if (!subsystemId) return NextResponse.json({ error: "subsystem_id required" }, { status: 400 });

  const db = getDb();
  const existing = db
    .prepare(`SELECT id FROM subsystem_members WHERE user_id = ? AND subsystem_id = ?`)
    .get(params.id, subsystemId) as { id: string } | undefined;

  if (existing) {
    db.prepare(`UPDATE subsystem_members SET role_in_subsystem = ? WHERE id = ?`).run(roleInSubsystem, existing.id);
  } else {
    db.prepare(
      `INSERT INTO subsystem_members (id, subsystem_id, user_id, role_in_subsystem) VALUES (?, ?, ?, ?)`
    ).run(newId("mem"), subsystemId, params.id, roleInSubsystem);
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  const subsystemId = new URL(req.url).searchParams.get("subsystem_id");
  if (!subsystemId) return NextResponse.json({ error: "subsystem_id required" }, { status: 400 });

  const db = getDb();
  db.prepare(`DELETE FROM subsystem_members WHERE user_id = ? AND subsystem_id = ?`).run(params.id, subsystemId);
  return NextResponse.json({ ok: true });
}

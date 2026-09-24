import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";
import { getSession, canEditSubsystem } from "@/lib/auth";
import { getPartById } from "@/lib/queries";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const part = getPartById(params.id);
  if (!part) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canEditSubsystem(user, part.subsystem_id)) {
    return NextResponse.json({ error: "You do not have edit access to this subsystem." }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const dependsOnId = body.depends_on_part_id;
  if (!dependsOnId || dependsOnId === params.id) {
    return NextResponse.json({ error: "Choose a different part to depend on." }, { status: 400 });
  }
  const target = getPartById(dependsOnId);
  if (!target) return NextResponse.json({ error: "Target part not found." }, { status: 404 });

  const db = getDb();
  try {
    db.prepare(
      `INSERT INTO part_dependencies (id, part_id, depends_on_part_id) VALUES (?, ?, ?)`
    ).run(newId("dep"), params.id, dependsOnId);
  } catch {
    return NextResponse.json({ error: "That dependency already exists." }, { status: 409 });
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const part = getPartById(params.id);
  if (!part) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canEditSubsystem(user, part.subsystem_id)) {
    return NextResponse.json({ error: "You do not have edit access to this subsystem." }, { status: 403 });
  }
  const dependsOnId = new URL(req.url).searchParams.get("depends_on_part_id");
  if (!dependsOnId) return NextResponse.json({ error: "Missing depends_on_part_id" }, { status: 400 });

  const db = getDb();
  db.prepare(`DELETE FROM part_dependencies WHERE part_id = ? AND depends_on_part_id = ?`).run(params.id, dependsOnId);
  return NextResponse.json({ ok: true });
}

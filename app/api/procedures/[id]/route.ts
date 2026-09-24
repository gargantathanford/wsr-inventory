import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";
import { getSession, canEditSubsystem, canReviewSubsystem } from "@/lib/auth";
import { getProcedureById } from "@/lib/queries";

const EDITABLE_FIELDS = [
  "title",
  "category",
  "description",
  "purpose",
  "applicable_teams",
  "required_documentation",
  "supporting_links",
  "safety_warning",
  "revision_number"
];

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const proc = getProcedureById(params.id);
  if (!proc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ procedure: proc });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const proc = getProcedureById(params.id);
  if (!proc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const db = getDb();

  // Approval workflow — restricted to leadership over the procedure's team.
  if (body.approval_status) {
    if (!canReviewSubsystem(user, proc.subsystem_id)) {
      return NextResponse.json({ error: "You cannot approve procedures for this team." }, { status: 403 });
    }
    const status = body.approval_status;
    if (!["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED"].includes(status)) {
      return NextResponse.json({ error: "Invalid approval status." }, { status: 400 });
    }
    db.prepare(
      `UPDATE procedures SET approval_status = ?, approved_by = ?, approved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
    ).run(status, status === "APPROVED" || status === "REJECTED" ? user.id : null, params.id);
    return NextResponse.json({ ok: true });
  }

  // Content edits — author, subsystem leader, chief engineer, or admin.
  const canEditContent =
    user.role === "ADMIN" ||
    user.role === "CHIEF_ENGINEER" ||
    proc.author_id === user.id ||
    (proc.subsystem_id ? canEditSubsystem(user, proc.subsystem_id) : user.role !== "TEAM_MEMBER");
  if (!canEditContent) {
    return NextResponse.json({ error: "You cannot edit this procedure." }, { status: 403 });
  }

  const updates: Record<string, any> = {};
  for (const field of EDITABLE_FIELDS) if (field in body) updates[field] = body[field];
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
  }
  const setClause = Object.keys(updates)
    .map((k) => `${k} = @${k}`)
    .join(", ");
  db.prepare(`UPDATE procedures SET ${setClause}, updated_at = datetime('now') WHERE id = @id`).run({
    ...updates,
    id: params.id
  });

  db.prepare(
    `INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, 'UPDATE', 'PROCEDURE', ?, ?)`
  ).run(newId("log"), user.id, params.id, JSON.stringify(Object.keys(updates)));

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const proc = getProcedureById(params.id);
  if (!proc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const canDelete =
    user.role === "ADMIN" ||
    user.role === "CHIEF_ENGINEER" ||
    proc.author_id === user.id ||
    (proc.subsystem_id ? canEditSubsystem(user, proc.subsystem_id) : false);
  if (!canDelete) return NextResponse.json({ error: "You cannot delete this procedure." }, { status: 403 });

  const db = getDb();
  db.prepare(`DELETE FROM procedures WHERE id = ?`).run(params.id);
  return NextResponse.json({ ok: true });
}

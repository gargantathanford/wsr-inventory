import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getTaskById } from "@/lib/queries";

const BLOCKED_STATUSES = new Set(["SUBMITTED_FOR_REVIEW", "COMPLETED"]);

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const task = getTaskById(params.id);
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));

  if (body.status && BLOCKED_STATUSES.has(body.status)) {
    return NextResponse.json(
      {
        error:
          "Tasks can't be marked Submitted for Review or Completed here. Use \u201cMark complete\u201d to submit documentation, then leadership review."
      },
      { status: 400 }
    );
  }
  if (BLOCKED_STATUSES.has(task.status) && body.status) {
    return NextResponse.json({ error: "This task is awaiting review or already completed." }, { status: 400 });
  }

  const allowed = ["title", "status", "due_date", "assigned_to"];
  const updates: Record<string, any> = {};
  for (const f of allowed) if (f in body) updates[f] = body[f];
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields." }, { status: 400 });
  }
  const db = getDb();
  const setClause = Object.keys(updates)
    .map((k) => `${k} = @${k}`)
    .join(", ");
  db.prepare(`UPDATE tasks SET ${setClause} WHERE id = @id`).run({ ...updates, id: params.id });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role === "TEAM_MEMBER") {
    return NextResponse.json({ error: "Team members cannot delete tasks." }, { status: 403 });
  }
  const db = getDb();
  db.prepare(`DELETE FROM tasks WHERE id = ?`).run(params.id);
  return NextResponse.json({ ok: true });
}

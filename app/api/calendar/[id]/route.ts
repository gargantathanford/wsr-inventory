import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";
import { getSession, canReviewSubsystem } from "@/lib/auth";
import { getCalendarEventById } from "@/lib/queries";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const event = getCalendarEventById(params.id);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ event });
}

const EDITABLE = ["title", "description", "event_type", "deadline_date", "deadline_time", "priority", "links", "notify_scope"];
const BLOCKED_STATUSES = new Set(["SUBMITTED_FOR_REVIEW", "COMPLETED"]);

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const event = getCalendarEventById(params.id);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const db = getDb();

  if (body.status) {
    if (BLOCKED_STATUSES.has(body.status)) {
      return NextResponse.json({ error: "Use the completion/review endpoints for this transition." }, { status: 400 });
    }
    db.prepare(`UPDATE calendar_events SET status = ? WHERE id = ?`).run(body.status, params.id);
    return NextResponse.json({ ok: true });
  }

  if (!canReviewSubsystem(user, event.subsystem_id) && event.created_by !== user.id) {
    return NextResponse.json({ error: "You cannot edit this event." }, { status: 403 });
  }
  const updates: Record<string, any> = {};
  for (const f of EDITABLE) if (f in body) updates[f] = body[f];
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: "No valid fields." }, { status: 400 });
  const setClause = Object.keys(updates).map((k) => `${k} = @${k}`).join(", ");
  db.prepare(`UPDATE calendar_events SET ${setClause} WHERE id = @id`).run({ ...updates, id: params.id });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const event = getCalendarEventById(params.id);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canReviewSubsystem(user, event.subsystem_id) && event.created_by !== user.id && user.role !== "ADMIN") {
    return NextResponse.json({ error: "You cannot delete this event." }, { status: 403 });
  }
  const db = getDb();
  db.prepare(`DELETE FROM calendar_events WHERE id = ?`).run(params.id);
  db.prepare(
    `INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, 'DELETE', 'CALENDAR_EVENT', ?, ?)`
  ).run(newId("log"), user.id, params.id, event.title);
  return NextResponse.json({ ok: true });
}

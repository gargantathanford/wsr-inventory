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

  // Authorization FIRST. The status branch used to sit above this check and
  // return early, so any signed-in account could move any event to any state
  // — not just start one. Nothing in the UI offered it, which is exactly why
  // it went unnoticed: the hole was only reachable by calling the API.
  const mayManage =
    canReviewSubsystem(user, event.subsystem_id) ||
    user.role === "ADMIN" ||
    user.role === "CHIEF_ENGINEER";

  if (body.status) {
    if (BLOCKED_STATUSES.has(body.status)) {
      return NextResponse.json({ error: "Use the completion/review endpoints for this transition." }, { status: 400 });
    }
    // Starting an event commits the team to a deadline being worked on, so it
    // belongs to whoever is accountable for it. A member who wants one started
    // asks their lead, the same way they raise a purchase request rather than
    // an order.
    if (!mayManage) {
      return NextResponse.json(
        {
          error:
            "Only the responsible team lead, the Chief Engineer or an Admin can start or change the " +
            "status of a calendar event. Ask your lead to start it."
        },
        { status: 403 }
      );
    }
    // Logged because "who started this, and who un-started it" is a question
    // that gets asked about a deadline that slipped, and the status column
    // only holds the answer until the next change.
    db.transaction(() => {
      db.prepare(`UPDATE calendar_events SET status = ? WHERE id = ?`).run(body.status, params.id);
      db.prepare(
        `INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, details)
         VALUES (?, ?, 'UPDATE', 'CALENDAR_EVENT', ?, ?)`
      ).run(
        newId("log"),
        user.id,
        params.id,
        `"${event.title}" ${event.status} → ${body.status}`
      );
    })();
    return NextResponse.json({ ok: true });
  }

  if (!mayManage && event.created_by !== user.id) {
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

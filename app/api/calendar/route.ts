import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";
import { getSession } from "@/lib/auth";
import { getAllCalendarEvents } from "@/lib/queries";
import { invalid, dbError, optionalRef, optionalText } from "@/lib/apiValidation";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const events = getAllCalendarEvents({
    subsystemId: searchParams.get("subsystem") || undefined,
    status: searchParams.get("status") || undefined
  });
  return NextResponse.json({ events });
}

const EVENT_TYPES = [
  "DEADLINE", "MEETING", "MILESTONE", "REVIEW",
  "COMPETITION", "MANUFACTURING", "TESTING", "ADMINISTRATIVE"
] as const;
const NOTIFY_SCOPES = ["EVERYONE", "TEAM", "SUBSYSTEM", "ASSIGNED_USER", "TEAM_LEADS", "ADMINS"] as const;

const EventInput = z.object({
  title: z.string().min(1),
  description: optionalText.optional(),
  // Enumerated rather than z.string(): the column has a CHECK constraint, and a
  // value that passes here only to fail in SQLite becomes a 500 instead of a
  // message naming the field.
  event_type: z.enum(EVENT_TYPES).default("DEADLINE"),
  // optionalRef, not z.string().optional().nullable(). The form's "All Teams"
  // option has value="" and FormData sends it as the empty string, which a
  // plain optional string accepts and `?? null` does not catch — so "" reached
  // this FK column and SQLite raised FOREIGN KEY constraint failed as a 500.
  subsystem_id: optionalRef.optional(),
  responsible_user_id: optionalRef.optional(),
  deadline_date: z.string().min(1),
  deadline_time: optionalText.optional(),
  priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).default("MEDIUM"),
  links: optionalText.optional(),
  is_actionable: z.boolean().default(true),
  reminder_intervals: z.array(z.number()).default([7, 1]),
  notify_scope: z.enum(NOTIFY_SCOPES).default("TEAM")
});

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role === "TEAM_MEMBER") {
    return NextResponse.json({ error: "Team members cannot create calendar events." }, { status: 403 });
  }
  const parsed = EventInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalid(parsed.error, "Could not create event");
  const data = parsed.data;

  const db = getDb();
  const id = newId("cal");
  try {
  db.prepare(
    `INSERT INTO calendar_events (
      id, title, description, event_type, subsystem_id, responsible_user_id, deadline_date, deadline_time,
      priority, links, is_actionable, status, reminder_intervals, notify_scope, created_by
    ) VALUES (@id, @title, @description, @event_type, @subsystem_id, @responsible_user_id, @deadline_date, @deadline_time,
      @priority, @links, @is_actionable, @status, @reminder_intervals, @notify_scope, @created_by)`
  ).run({
    id,
    title: data.title,
    description: data.description ?? null,
    event_type: data.event_type,
    subsystem_id: data.subsystem_id ?? null,
    responsible_user_id: data.responsible_user_id ?? null,
    deadline_date: data.deadline_date,
    deadline_time: data.deadline_time ?? null,
    priority: data.priority,
    links: data.links ?? null,
    is_actionable: data.is_actionable ? 1 : 0,
    status: data.is_actionable ? "UPCOMING" : "UPCOMING",
    reminder_intervals: JSON.stringify(data.reminder_intervals),
    notify_scope: data.notify_scope,
    created_by: user.id
  });

  db.prepare(
    `INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, 'CREATE', 'CALENDAR_EVENT', ?, ?)`
  ).run(newId("log"), user.id, id, data.title);
  } catch (e) {
    return dbError(e, "Could not create event");
  }

  return NextResponse.json({ id }, { status: 201 });
}

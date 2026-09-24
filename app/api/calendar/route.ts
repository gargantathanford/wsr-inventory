import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";
import { getSession } from "@/lib/auth";
import { getAllCalendarEvents } from "@/lib/queries";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const events = getAllCalendarEvents({
    subsystemId: searchParams.get("subsystem") || undefined,
    status: searchParams.get("status") || undefined
  });
  return NextResponse.json({ events });
}

const EventInput = z.object({
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  event_type: z.string().default("DEADLINE"),
  subsystem_id: z.string().optional().nullable(),
  responsible_user_id: z.string().optional().nullable(),
  deadline_date: z.string().min(1),
  deadline_time: z.string().optional().nullable(),
  priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).default("MEDIUM"),
  links: z.string().optional().nullable(),
  is_actionable: z.boolean().default(true),
  reminder_intervals: z.array(z.number()).default([7, 1]),
  notify_scope: z.string().default("TEAM")
});

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role === "TEAM_MEMBER") {
    return NextResponse.json({ error: "Team members cannot create calendar events." }, { status: 403 });
  }
  const parsed = EventInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const data = parsed.data;

  const db = getDb();
  const id = newId("cal");
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

  return NextResponse.json({ id }, { status: 201 });
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";
import { getSession } from "@/lib/auth";
import { getAllTasksDetailed } from "@/lib/queries";
import { invalid, dbError, optionalRef, optionalText } from "@/lib/apiValidation";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tasks = getAllTasksDetailed({
    status: searchParams.get("status") || undefined,
    subsystemId: searchParams.get("subsystem") || undefined
  });
  return NextResponse.json({ tasks });
}

const TaskInput = z.object({
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).default("MEDIUM"),
  subsystem_id: optionalRef.optional(),
  subteam_id: optionalRef.optional(),
  part_id: optionalRef.optional(),
  procedure_id: optionalRef.optional(),
  assigned_to: z.string().optional().nullable(),
  extra_assignee_ids: z.array(z.string()).optional().default([]),
  assignment_scope: z.enum(["USER", "TEAM", "SUBSYSTEM"]).default("USER"),
  estimated_hours: z.coerce.number().optional().nullable(),
  due_date: z.string().optional().nullable(),
  due_time: z.string().optional().nullable(),
  blocked_by_task_ids: z.array(z.string()).optional().default([])
});

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = TaskInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalid(parsed.error);
  const data = parsed.data;
  const db = getDb();
  const id = newId("task");
  db.prepare(
    `INSERT INTO tasks (
      id, title, description, priority, subsystem_id, subteam_id, part_id, procedure_id,
      assigned_to, assignment_scope, estimated_hours, created_by, status, due_date, due_time
    ) VALUES (@id, @title, @description, @priority, @subsystem_id, @subteam_id, @part_id, @procedure_id,
      @assigned_to, @assignment_scope, @estimated_hours, @created_by, 'OPEN', @due_date, @due_time)`
  ).run({
    id,
    title: data.title,
    description: data.description ?? null,
    priority: data.priority,
    subsystem_id: data.subsystem_id ?? null,
    subteam_id: data.subteam_id ?? null,
    part_id: data.part_id ?? null,
    procedure_id: data.procedure_id ?? null,
    assigned_to: data.assigned_to ?? null,
    assignment_scope: data.assignment_scope,
    estimated_hours: data.estimated_hours ?? null,
    created_by: user.id,
    due_date: data.due_date ?? null,
    due_time: data.due_time ?? null
  });

  const insertAssignee = db.prepare(`INSERT OR IGNORE INTO task_assignees (id, task_id, user_id) VALUES (?, ?, ?)`);
  for (const uid of data.extra_assignee_ids) insertAssignee.run(newId("ta"), id, uid);

  const insertDep = db.prepare(`INSERT OR IGNORE INTO task_dependencies (id, task_id, blocked_by_task_id) VALUES (?, ?, ?)`);
  for (const depId of data.blocked_by_task_ids) insertDep.run(newId("tdep"), id, depId);

  db.prepare(
    `INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, 'CREATE', 'TASK', ?, ?)`
  ).run(newId("log"), user.id, id, data.title);

  return NextResponse.json({ id }, { status: 201 });
}

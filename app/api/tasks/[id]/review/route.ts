import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";
import { getSession, canReviewSubsystem } from "@/lib/auth";
import { awardQuietly, reverse } from "@/lib/xp/store";
import { getTaskById } from "@/lib/queries";
import { invalid, dbError, optionalRef, optionalText } from "@/lib/apiValidation";

const ReviewInput = z.object({
  // "reject" is not "return". Return means do more work; reject means the task
  // should not exist — somebody filing noise, or farming XP by raising and
  // closing their own make-work. Returning those keeps them in the queue
  // forever and gives the filer exactly the attention they wanted.
  action: z.enum(["approve", "return", "reject"]),
  return_reason: z.string().optional().nullable()
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const task = getTaskById(params.id);
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (task.status !== "SUBMITTED_FOR_REVIEW") {
    return NextResponse.json({ error: "This task is not awaiting review." }, { status: 400 });
  }
  if (!canReviewSubsystem(user, task.subsystem_id)) {
    return NextResponse.json({ error: "You cannot review tasks for this team." }, { status: 403 });
  }

  const parsed = ReviewInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalid(parsed.error);
  const data = parsed.data;

  if (data.action === "return" && !data.return_reason?.trim()) {
    return NextResponse.json({ error: "Explain what needs additional work." }, { status: 400 });
  }

  if (data.action === "reject") {
    // Deliberately narrower than review. A lead can send work back; deleting
    // somebody's task outright is a bigger call and belongs with the people
    // who answer for the whole build.
    if (user.role !== "ADMIN" && user.role !== "CHIEF_ENGINEER") {
      return NextResponse.json(
        {
          error:
            "Only the Chief Engineer or an Admin can reject a task outright. You can return it for " +
            "more work, or ask them to remove it."
        },
        { status: 403 }
      );
    }
    const reason = data.return_reason?.trim() ?? "";
    if (reason.length < 10) {
      return NextResponse.json(
        {
          error:
            "Say why this task is being rejected. It is the only record that will survive — the task " +
            "itself is deleted."
        },
        { status: 422 }
      );
    }

    const db = getDb();
    try {
      const tx = db.transaction(() => {
        // Any XP this task paid out is reversed FIRST, while the rows that
        // explain it still exist. Rejecting a task somebody farmed points from
        // and leaving the points behind would reward exactly the behaviour
        // this is here to stop.
        // Both transitions a task can pay out, matching the "return" branch
        // below. Each is a no-op when that award was never made.
        for (const transition of ["completed", "criticalPath"]) {
          try {
            reverse("task", params.id, transition, `Task rejected: ${reason}`);
          } catch {
            // XP must never block the real operation. See awardQuietly.
          }
        }
        // The log entry outlives the task, so there is a record of a task
        // having existed and been rejected, by whom, and why.
        db.prepare(
          `INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, details)
           VALUES (?, ?, 'REJECT', 'TASK', ?, ?)`
        ).run(newId("log"), user.id, params.id, `"${task.title}" rejected: ${reason}`);
        db.prepare(`DELETE FROM tasks WHERE id = ?`).run(params.id);
      });
      tx();
    } catch (e) {
      return dbError(e, "Could not reject that task");
    }
    return NextResponse.json({ ok: true, deleted: true });
  }

  const db = getDb();
  if (data.action === "approve") {
    db.prepare(
      `UPDATE tasks SET status = 'COMPLETED', reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?`
    ).run(user.id, params.id);
    db.prepare(
      `INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, 'APPROVE', 'TASK', ?, ?)`
    ).run(newId("log"), user.id, params.id, task.title);

    // XP attaches HERE — to a lead approving completed work with evidence
    // attached — never to creating or self-closing a task. The person who did
    // the work is task.submitted_by, not whoever is approving.
    //
    // Self-verified when one person both raised the task and closed it: paid at
    // 40% and labelled, because nobody else confirmed the work existed.
    const worker = task.submitted_by ?? task.assigned_to ?? null;
    if (worker) {
      const selfVerified = !!task.created_by && task.created_by === worker;
      awardQuietly({
        userId: worker,
        kind: "task.completed",
        sourceType: "task",
        sourceId: params.id,
        transition: "completed",
        at: new Date().toISOString(),
        subsystemId: task.subsystem_id ?? null,
        selfVerified
      });

      // Critical-path work closed on time is approval-tier: anyone can mark
      // their own task critical-path, so the points wait for a human.
      const onTime = !task.due_date || new Date().toISOString().slice(0, 10) <= task.due_date;
      if (task.priority === "CRITICAL" && onTime) {
        awardQuietly({
          userId: worker,
          kind: "task.criticalPath",
          sourceType: "task",
          sourceId: params.id,
          transition: "criticalPath",
          at: new Date().toISOString(),
          subsystemId: task.subsystem_id ?? null,
          selfVerified
        });
      }
    }
  } else {
    db.prepare(
      `UPDATE tasks SET status = 'IN_PROGRESS', reviewed_by = ?, reviewed_at = datetime('now'), return_reason = ? WHERE id = ?`
    ).run(user.id, data.return_reason, params.id);
    db.prepare(
      `INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, 'RETURN', 'TASK', ?, ?)`
    ).run(newId("log"), user.id, params.id, task.title);

    // Returned for more work: the award is no longer true, so compensate it.
    // The original event stays in the ledger as the audit trail, and the
    // deferred first-time-right bonus will never pay for this task now.
    reverse("task", params.id, "completed", `Returned for additional work: ${data.return_reason}`);
    reverse("task", params.id, "criticalPath", "Returned for additional work");
  }

  return NextResponse.json({ ok: true });
}

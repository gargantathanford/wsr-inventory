import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";
import { getSession, canReviewSubsystem } from "@/lib/auth";
import { getCalendarEventById } from "@/lib/queries";
import { invalid, dbError, optionalRef, optionalText } from "@/lib/apiValidation";

const ReviewInput = z.object({
  action: z.enum(["approve", "return"]),
  return_reason: z.string().optional().nullable()
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const event = getCalendarEventById(params.id);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (event.status !== "SUBMITTED_FOR_REVIEW") {
    return NextResponse.json({ error: "This item is not awaiting review." }, { status: 400 });
  }
  if (!canReviewSubsystem(user, event.subsystem_id)) {
    return NextResponse.json({ error: "You cannot review items for this team." }, { status: 403 });
  }
  const parsed = ReviewInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalid(parsed.error);
  const data = parsed.data;
  if (data.action === "return" && !data.return_reason?.trim()) {
    return NextResponse.json({ error: "Explain what needs additional work." }, { status: 400 });
  }

  const db = getDb();
  if (data.action === "approve") {
    db.prepare(`UPDATE calendar_events SET status = 'COMPLETED', reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?`).run(user.id, params.id);
  } else {
    db.prepare(
      `UPDATE calendar_events SET status = 'IN_PROGRESS', reviewed_by = ?, reviewed_at = datetime('now'), return_reason = ? WHERE id = ?`
    ).run(user.id, data.return_reason, params.id);
  }
  db.prepare(
    `INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, 'CALENDAR_EVENT', ?, ?)`
  ).run(newId("log"), user.id, data.action === "approve" ? "APPROVE" : "RETURN", params.id, event.title);

  return NextResponse.json({ ok: true });
}

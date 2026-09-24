import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";
import { getSession } from "@/lib/auth";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const comment = (body.comment || "").trim();
  if (!comment) return NextResponse.json({ error: "Comment cannot be empty." }, { status: 400 });
  const eventType = body.event_type === "INFO_REQUESTED" ? "INFO_REQUESTED" : "COMMENT";

  const db = getDb();
  const exists = db.prepare(`SELECT id FROM purchase_requests WHERE id = ?`).get(params.id);
  if (!exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

  db.prepare(
    `INSERT INTO purchase_request_events (id, request_id, user_id, event_type, comment) VALUES (?, ?, ?, ?, ?)`
  ).run(newId("prev"), params.id, user.id, eventType, comment);

  return NextResponse.json({ ok: true }, { status: 201 });
}

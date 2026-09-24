import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";
import { getSession } from "@/lib/auth";
import { getCalendarEventById } from "@/lib/queries";
import { saveUploadedFile, MAX_UPLOAD_BYTES, UnsupportedFileTypeError } from "@/lib/storage";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const event = getCalendarEventById(params.id);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (event.status === "SUBMITTED_FOR_REVIEW" || event.status === "COMPLETED") {
    return NextResponse.json({ error: "This item is already awaiting review or completed." }, { status: 400 });
  }
  if (!event.is_actionable) {
    return NextResponse.json({ error: "This calendar item is informational and has no completion workflow." }, { status: 400 });
  }

  const contentType = req.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });
  }
  const form = await req.formData();
  const summary = ((form.get("completion_summary") as string) || "").trim();
  if (summary.length < 20) {
    return NextResponse.json(
      { error: "Completion summary must be a meaningful paragraph (20+ characters) describing what was accomplished." },
      { status: 400 }
    );
  }

  const db = getDb();
  db.prepare(
    `UPDATE calendar_events SET
      status = 'SUBMITTED_FOR_REVIEW', completion_summary = ?, submitted_by = ?, submitted_at = datetime('now'),
      return_reason = NULL, reviewed_by = NULL, reviewed_at = NULL
     WHERE id = ?`
  ).run(summary, user.id, params.id);

  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  for (const file of files) {
    if (file.size > MAX_UPLOAD_BYTES) continue;
    let saved;
    try {
      saved = await saveUploadedFile(file);
    } catch (e) {
      if (e instanceof UnsupportedFileTypeError) continue;
      throw e;
    }
    db.prepare(
      `INSERT INTO documents (id, title, doc_type, calendar_event_id, source, file_path, mime_type, file_size, original_filename, uploaded_by)
       VALUES (?, ?, ?, ?, 'UPLOAD', ?, ?, ?, ?, ?)`
    ).run(
      newId("doc"),
      file.name,
      file.type.startsWith("image/") ? "IMAGE" : "OTHER",
      params.id,
      saved.filePath,
      saved.mimeType,
      saved.size,
      file.name,
      user.id
    );
  }

  db.prepare(
    `INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, 'SUBMIT', 'CALENDAR_EVENT', ?, ?)`
  ).run(newId("log"), user.id, params.id, event.title);

  return NextResponse.json({ ok: true });
}

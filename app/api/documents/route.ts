import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";
import { getSession } from "@/lib/auth";
import { getAllDocuments } from "@/lib/queries";
import { saveUploadedFile, MAX_UPLOAD_BYTES, UnsupportedFileTypeError } from "@/lib/storage";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const documents = getAllDocuments({
    search: searchParams.get("q") || undefined,
    subsystemId: searchParams.get("subsystem") || undefined
  });
  return NextResponse.json({ documents });
}

const DocInput = z.object({
  title: z.string().min(1),
  doc_type: z.string().default("OTHER"),
  url: z.string().optional().nullable(),
  subsystem_id: z.string().optional().nullable(),
  part_id: z.string().optional().nullable(),
  procedure_id: z.string().optional().nullable(),
  calendar_event_id: z.string().optional().nullable(),
  manufacturer: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  notes: z.string().optional().nullable()
});

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role === "TEAM_MEMBER") {
    return NextResponse.json({ error: "Team members cannot upload documentation." }, { status: 403 });
  }

  const contentType = req.headers.get("content-type") || "";
  const db = getDb();
  const id = newId("doc");

  // ---- File upload path (multipart/form-data) ----
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "No file provided." }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "File exceeds 25MB limit." }, { status: 413 });
    }
    const title = (form.get("title") as string) || file.name;
    const docType = (form.get("doc_type") as string) || "OTHER";
    const subsystemId = (form.get("subsystem_id") as string) || null;
    const partId = (form.get("part_id") as string) || null;
    const procedureId = (form.get("procedure_id") as string) || null;
    const calendarEventId = (form.get("calendar_event_id") as string) || null;
    const manufacturer = (form.get("manufacturer") as string) || null;
    const category = (form.get("category") as string) || null;
    const notes = (form.get("notes") as string) || null;

    let saved;
    try {
      saved = await saveUploadedFile(file);
    } catch (e) {
      if (e instanceof UnsupportedFileTypeError) {
        return NextResponse.json({ error: e.message }, { status: 415 });
      }
      throw e;
    }

    db.prepare(
      `INSERT INTO documents (
        id, title, doc_type, subsystem_id, part_id, procedure_id, calendar_event_id, manufacturer, category, notes,
        source, file_path, mime_type, file_size, original_filename, uploaded_by
      ) VALUES (@id, @title, @doc_type, @subsystem_id, @part_id, @procedure_id, @calendar_event_id, @manufacturer, @category, @notes,
        'UPLOAD', @file_path, @mime_type, @file_size, @original_filename, @uploaded_by)`
    ).run({
      id,
      title,
      doc_type: docType,
      subsystem_id: subsystemId || null,
      part_id: partId || null,
      procedure_id: procedureId || null,
      calendar_event_id: calendarEventId || null,
      manufacturer,
      category,
      notes,
      file_path: saved.filePath,
      mime_type: saved.mimeType,
      file_size: saved.size,
      original_filename: file.name,
      uploaded_by: user.id
    });

    db.prepare(
      `INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, 'UPLOAD', 'DOCUMENT', ?, ?)`
    ).run(newId("log"), user.id, id, title);

    return NextResponse.json({ id }, { status: 201 });
  }

  // ---- Link-based path (JSON body) ----
  const parsed = DocInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const data = parsed.data;

  db.prepare(
    `INSERT INTO documents (id, title, doc_type, url, subsystem_id, part_id, procedure_id, calendar_event_id, manufacturer, category, notes, source, uploaded_by)
     VALUES (@id, @title, @doc_type, @url, @subsystem_id, @part_id, @procedure_id, @calendar_event_id, @manufacturer, @category, @notes, 'LINK', @uploaded_by)`
  ).run({
    id,
    title: data.title,
    doc_type: data.doc_type,
    url: data.url ?? null,
    subsystem_id: data.subsystem_id ?? null,
    part_id: data.part_id ?? null,
    procedure_id: data.procedure_id ?? null,
    calendar_event_id: data.calendar_event_id ?? null,
    manufacturer: data.manufacturer ?? null,
    category: data.category ?? null,
    notes: data.notes ?? null,
    uploaded_by: user.id
  });

  db.prepare(
    `INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, 'CREATE', 'DOCUMENT', ?, ?)`
  ).run(newId("log"), user.id, id, data.title);

  return NextResponse.json({ id }, { status: 201 });
}

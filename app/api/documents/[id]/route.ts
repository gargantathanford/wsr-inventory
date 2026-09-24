import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";
import { getSession } from "@/lib/auth";
import { deleteUploadedFile } from "@/lib/storage";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role === "TEAM_MEMBER") {
    return NextResponse.json({ error: "Team members cannot delete documentation." }, { status: 403 });
  }
  const db = getDb();
  const doc = db.prepare(`SELECT * FROM documents WHERE id = ?`).get(params.id) as any;
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (doc.source === "UPLOAD" && doc.file_path) {
    deleteUploadedFile(doc.file_path);
  }
  db.prepare(`DELETE FROM documents WHERE id = ?`).run(params.id);
  db.prepare(
    `INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, 'DELETE', 'DOCUMENT', ?, ?)`
  ).run(newId("log"), user.id, params.id, doc.title);

  return NextResponse.json({ ok: true });
}

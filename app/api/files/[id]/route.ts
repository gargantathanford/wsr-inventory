import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { getDb } from "@/lib/db";
import { readUploadedFile, isActiveContentRisk } from "@/lib/storage";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = getDb();
  const doc = db.prepare(`SELECT * FROM documents WHERE id = ?`).get(params.id) as any;
  if (!doc || doc.source !== "UPLOAD" || !doc.file_path) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const buffer = readUploadedFile(doc.file_path);
    const ext = path.extname(doc.file_path).toLowerCase();
    const safeFilename = (doc.original_filename || doc.title).replace(/"/g, "");

    // SVG is XML and can carry a <script> tag. Rendered inline in a browser tab, that
    // script executes in this origin's context — a real stored-XSS vector for any app
    // that lets users upload SVGs and serves them back inline, not a theoretical one.
    // Forcing a download instead of inline rendering neutralizes it: the browser never
    // parses the file as a document in this origin, it just saves the bytes.
    const disposition = isActiveContentRisk(ext) ? "attachment" : "inline";
    const contentType = isActiveContentRisk(ext) ? "application/octet-stream" : doc.mime_type || "application/octet-stream";

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `${disposition}; filename="${safeFilename}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=3600"
      }
    });
  } catch {
    return NextResponse.json({ error: "File missing on disk" }, { status: 404 });
  }
}

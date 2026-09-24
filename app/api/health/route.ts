import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// Without this, Next pre-renders this handler at build time: the build opens the
// database, and the Docker HEALTHCHECK gets a frozen "ok" instead of a live DB check.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getDb();
    db.prepare("SELECT 1").get();
    return NextResponse.json({ status: "ok", db: "ok", time: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json(
      { status: "error", error: err instanceof Error ? err.message : "unknown" },
      { status: 503 }
    );
  }
}

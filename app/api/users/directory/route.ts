import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";

/**
 * Minimal name directory for assignment pickers (tasks, calendar events, etc).
 * Deliberately excludes email, phone, role, and every other field the full
 * /api/users (admin-only) endpoint returns — any authenticated user can see
 * who exists to assign work to, nothing more.
 */
export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  const users = db.prepare(`SELECT id, name FROM users WHERE is_active = 1 ORDER BY name ASC`).all();
  return NextResponse.json({ users });
}

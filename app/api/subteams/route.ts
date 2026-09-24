import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";
import { getSession, canEditSubsystem } from "@/lib/auth";
import { getSubteams } from "@/lib/queries";

export async function GET(req: NextRequest) {
  const subsystemId = new URL(req.url).searchParams.get("subsystem") || undefined;
  return NextResponse.json({ subteams: getSubteams(subsystemId) });
}

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const subsystemId = body.subsystem_id;
  const name = (body.name || "").trim();
  if (!subsystemId || !name) return NextResponse.json({ error: "subsystem_id and name required" }, { status: 400 });
  if (!canEditSubsystem(user, subsystemId)) {
    return NextResponse.json({ error: "You do not lead this subsystem." }, { status: 403 });
  }
  const db = getDb();
  const id = newId("subteam");
  try {
    db.prepare(`INSERT INTO subteams (id, subsystem_id, name) VALUES (?, ?, ?)`).run(id, subsystemId, name);
  } catch {
    return NextResponse.json({ error: "A subteam with that name already exists for this subsystem." }, { status: 409 });
  }
  return NextResponse.json({ id }, { status: 201 });
}

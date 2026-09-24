import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";
import { getSession, hashPassword } from "@/lib/auth";
import { presenceStatus } from "@/lib/presence";

async function requireAdmin() {
  const user = await getSession();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (user.role !== "ADMIN") return { error: NextResponse.json({ error: "Admin only." }, { status: 403 }) };
  return { user };
}

export async function GET() {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  const db = getDb();
  const users = db
    .prepare(`SELECT id, name, email, phone_number, role, is_active, last_active, created_at FROM users ORDER BY role, name`)
    .all() as any[];
  const memberships = db
    .prepare(
      `SELECT sm.user_id, sm.subsystem_id, s.name as subsystem_name, sm.role_in_subsystem
       FROM subsystem_members sm JOIN subsystems s ON s.id = sm.subsystem_id`
    )
    .all() as any[];

  const byUser = new Map<string, any[]>();
  for (const m of memberships) {
    if (!byUser.has(m.user_id)) byUser.set(m.user_id, []);
    byUser.get(m.user_id)!.push(m);
  }

  return NextResponse.json({
    users: users.map((u) => ({ ...u, memberships: byUser.get(u.id) || [], presence: presenceStatus(u.last_active) }))
  });
}

const UserInput = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone_number: z.string().optional().nullable(),
  password: z.string().min(6),
  role: z.enum(["ADMIN", "CHIEF_ENGINEER", "TEAM_LEADER", "TEAM_MEMBER"]),
  team_led: z.string().optional().nullable()
});

export async function POST(req: NextRequest) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  const parsed = UserInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const data = parsed.data;

  const db = getDb();
  const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(data.email.toLowerCase());
  if (existing) return NextResponse.json({ error: "A user with that email already exists." }, { status: 409 });

  const id = newId("usr");
  db.prepare(
    `INSERT INTO users (id, name, email, phone_number, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, data.name, data.email.toLowerCase(), data.phone_number || null, hashPassword(data.password), data.role);

  if (data.role === "TEAM_LEADER" && data.team_led) {
    db.prepare(
      `INSERT INTO subsystem_members (id, subsystem_id, user_id, role_in_subsystem) VALUES (?, ?, ?, 'LEADER')`
    ).run(newId("mem"), data.team_led, id);
  }

  db.prepare(
    `INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, 'CREATE', 'USER', ?, ?)`
  ).run(newId("log"), gate.user!.id, id, data.email);

  return NextResponse.json({ id }, { status: 201 });
}

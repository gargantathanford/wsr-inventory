import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";
import { getSession, hashPassword } from "@/lib/auth";
import { checkPassword } from "@/lib/password";
import { invalid, dbError, optionalRef, optionalText } from "@/lib/apiValidation";

async function requireAdmin() {
  const user = await getSession();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (user.role !== "ADMIN") return { error: NextResponse.json({ error: "Admin only." }, { status: 403 }) };
  return { user };
}

const UpdateInput = z.object({
  name: z.string().min(1).optional(),
  phone_number: z.string().optional().nullable(),
  role: z.enum(["ADMIN", "CHIEF_ENGINEER", "TEAM_LEADER", "TEAM_MEMBER"]).optional(),
  is_active: z.union([z.boolean(), z.literal(0), z.literal(1)]).optional(),
  password: z.string().min(1).optional(),
  team_led: z.string().optional().nullable()
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  const parsed = UpdateInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalid(parsed.error);
  const data = parsed.data;

  if (params.id === gate.user!.id && (
    (data.role && data.role !== "ADMIN") ||
    data.is_active === false ||
    data.is_active === 0
  )) {
    return NextResponse.json({ error: "You cannot demote or deactivate your own account." }, { status: 400 });
  }

  const db = getDb();
  const updates: Record<string, any> = {};
  if (data.name) updates.name = data.name;
  if (data.phone_number !== undefined) updates.phone_number = data.phone_number || null;
  if (data.role) updates.role = data.role;
  if (data.is_active !== undefined) updates.is_active = data.is_active ? 1 : 0;
  if (data.password) {
    // The edit payload carries no email, so the guessability context comes from
    // the stored record — otherwise an admin could set a password that is just
    // that person's own email and nothing would catch it.
    const target = db.prepare(`SELECT name, email FROM users WHERE id = ?`).get(params.id) as
      | { name: string; email: string }
      | undefined;
    if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const pw = checkPassword(data.password, { name: data.name ?? target.name, email: target.email });
    if (!pw.ok) return NextResponse.json({ error: pw.problems.join(" ") }, { status: 400 });
    updates.password_hash = hashPassword(data.password);
    // Signs that person out everywhere — an admin resetting a password is
    // often doing it BECAUSE the old one is compromised.
    updates.password_changed_at = new Date().toISOString().replace("T", " ").slice(0, 19);
  }

  if (Object.keys(updates).length > 0) {
    const setClause = Object.keys(updates)
      .map((k) => `${k} = @${k}`)
      .join(", ");
    const result = db.prepare(`UPDATE users SET ${setClause} WHERE id = @id`).run({ ...updates, id: params.id });
    if (result.changes === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (data.team_led) {
    const existing = db
      .prepare(`SELECT id FROM subsystem_members WHERE user_id = ? AND subsystem_id = ?`)
      .get(params.id, data.team_led) as { id: string } | undefined;
    if (existing) {
      db.prepare(`UPDATE subsystem_members SET role_in_subsystem = 'LEADER' WHERE id = ?`).run(existing.id);
    } else {
      db.prepare(
        `INSERT INTO subsystem_members (id, subsystem_id, user_id, role_in_subsystem) VALUES (?, ?, ?, 'LEADER')`
      ).run(newId("mem"), data.team_led, params.id);
    }
  }

  if (Object.keys(updates).length === 0 && !data.team_led) {
    return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
  }

  db.prepare(
    `INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, 'UPDATE', 'USER', ?, ?)`
  ).run(newId("log"), gate.user!.id, params.id, JSON.stringify([...Object.keys(updates), data.team_led ? "team_led" : null].filter(Boolean)));

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  if (params.id === gate.user!.id) {
    return NextResponse.json({ error: "You cannot delete your own account." }, { status: 400 });
  }
  const db = getDb();
  const result = db.prepare(`DELETE FROM users WHERE id = ?`).run(params.id);
  if (result.changes === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

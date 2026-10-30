import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession, hashPassword, verifyPassword, findUserByEmail, SESSION_COOKIE, signSession } from "@/lib/auth";
import { checkPassword } from "@/lib/password";
import { checkRateLimit } from "@/lib/rateLimit";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";

const Input = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(1)
});

/**
 * Change your own password.
 *
 * Requires the current password even though the caller already holds a valid
 * session: a session is "this browser was logged in once", which is exactly
 * what an unattended laptop gives an attacker. Proving the current password is
 * what makes this a change rather than a takeover.
 */
export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Rate limited per account: the current-password field is a guessing oracle
  // otherwise, and the attacker here already has a session.
  if (!checkRateLimit(`pwchange:${user.id}`, 5, 15 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });
  }

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Both the current and new password are required." }, { status: 400 });
  }
  const { current_password, new_password } = parsed.data;

  const row = findUserByEmail(user.email);
  if (!row) return NextResponse.json({ error: "Account not found." }, { status: 404 });

  if (!verifyPassword(current_password, row.password_hash)) {
    return NextResponse.json({ error: "That is not your current password." }, { status: 403 });
  }
  if (current_password === new_password) {
    return NextResponse.json({ error: "The new password is the same as the current one." }, { status: 400 });
  }

  const check = checkPassword(new_password, { name: user.name, email: user.email });
  if (!check.ok) return NextResponse.json({ error: check.problems.join(" ") }, { status: 400 });

  const db = getDb();
  db.prepare(`UPDATE users SET password_hash = ?, password_changed_at = datetime('now') WHERE id = ?`).run(
    hashPassword(new_password),
    user.id
  );
  db.prepare(
    `INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, details)
     VALUES (?, ?, 'PASSWORD_CHANGE', 'USER', ?, 'Changed their own password')`
  ).run(newId("log"), user.id, user.id);

  // password_changed_at just retired every existing session, including this
  // one. Issue a fresh token so the person who just changed their password is
  // not immediately bounced to the login screen — every OTHER device is.
  const token = await signSession({ id: user.id, name: user.name, email: user.email, role: user.role });
  const res = NextResponse.json({ ok: true, signedOutElsewhere: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30
  });
  return res;
}

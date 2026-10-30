import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";
import { issueSetupToken, SETUP_TOKEN_TTL_HOURS } from "@/lib/setupTokens";
import { mailIsConfigured, sendMail } from "@/lib/mailer";

/**
 * Issue a one-time setup link for a user. Admin only.
 *
 * Returns the raw link ONCE — it is not stored and cannot be retrieved again.
 * Reissuing revokes any outstanding link for that person, which is how a link
 * sent to the wrong place gets killed.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ error: "Admin only." }, { status: 403 });

  const db = getDb();
  const target = db.prepare(`SELECT id, name, email, is_active FROM users WHERE id = ?`).get(params.id) as
    | { id: string; name: string; email: string; is_active: number }
    | undefined;
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!target.is_active) {
    return NextResponse.json({ error: "That account is deactivated. Reactivate it first." }, { status: 400 });
  }

  const issued = issueSetupToken(target.id, user.id);
  const origin = req.headers.get("origin") || `${req.nextUrl.protocol}//${req.headers.get("host")}`;
  const url = `${origin}${issued.path}`;

  db.prepare(
    `INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, details)
     VALUES (?, ?, 'ISSUE_SETUP_LINK', 'USER', ?, ?)`
  ).run(newId("log"), user.id, target.id, `Setup link issued for ${target.email}`);

  // Attempt mail if a provider is wired up. The link is returned either way —
  // sending must never be the only delivery path, or a deliverability problem
  // becomes an account nobody can access.
  let emailed = false;
  if (mailIsConfigured()) {
    const result = await sendMail({
      to: target.email,
      subject: "Set up your Warp Speed Racing dashboard account",
      text:
        `Hi ${target.name},\n\n` +
        `Use this link to set your password. It works once and expires in ${SETUP_TOKEN_TTL_HOURS} hours:\n\n` +
        `${url}\n\n` +
        `If you did not expect this, ignore it and tell a team admin.\n`
    });
    emailed = result.ok;
  }

  return NextResponse.json({
    url,
    expiresAt: issued.expiresAt,
    emailed,
    ttlHours: SETUP_TOKEN_TTL_HOURS
  });
}

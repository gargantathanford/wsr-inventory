import { NextRequest, NextResponse } from "next/server";
import { findUserByEmail, verifyPassword, signSession, SESSION_COOKIE } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rateLimit";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";
import { shouldUseSecureCookie } from "@/lib/cookieScope";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.ip || "unknown";
  // 10 attempts per 5 minutes per IP — generous enough for a fumbled password, tight
  // enough to blunt credential-stuffing / brute-force against this endpoint.
  if (!checkRateLimit(`login:${ip}`, 10, 5 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many login attempts. Try again in a few minutes." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const email = body?.email?.toString().trim().toLowerCase();
  const password = body?.password?.toString();

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password required." }, { status: 400 });
  }

  const user = findUserByEmail(email);
  // Deliberately identical error for "no such user" and "wrong password" — don't leak
  // which emails have accounts.
  if (!user || !verifyPassword(password, user.password_hash)) {
    return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
  }
  if (!user.is_active) {
    return NextResponse.json({ error: "This account has been deactivated." }, { status: 403 });
  }

  const token = await signSession({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role
  });

  const db = getDb();
  db.prepare(
    `INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, 'LOGIN', 'USER', ?, ?)`
  ).run(newId("log"), user.id, user.id, ip);

  const res = NextResponse.json({
    ok: true,
    user: { id: user.id, name: user.name, email: user.email, role: user.role }
  });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // Secure in production, EXCEPT over a private LAN address — otherwise
    // testing on a phone over the shop Wi-Fi logs in successfully and then
    // bounces back to the sign-in page, because the browser silently discards
    // a Secure cookie delivered over plain http. See lib/cookieScope.ts: a
    // real deployment is reached by its domain name, so this can never relax
    // anything in production.
    secure: shouldUseSecureCookie(req.headers.get("host"), req.headers.get("x-forwarded-proto")),
    path: "/",
    maxAge: 60 * 60 * 24 * 30
  });
  return res;
}

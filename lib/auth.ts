import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { getDb } from "./db";
import { getSessionSecretString } from "./env";

export const SESSION_COOKIE = "wsr_session";

const secretKey = new TextEncoder().encode(getSessionSecretString());

export type Role = "ADMIN" | "CHIEF_ENGINEER" | "TEAM_LEADER" | "TEAM_MEMBER";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export async function signSession(user: SessionUser): Promise<string> {
  return new SignJWT({ ...user })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secretKey);
}

export async function verifySession(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey);
    return payload as unknown as SessionUser;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionUser | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await verifySession(token);
  if (!session) return null;
  // Defense in depth: a deactivated account should lose access immediately,
  // not just at next login, even if their JWT hasn't expired yet.
  const db = getDb();
  const row = db.prepare("SELECT is_active FROM users WHERE id = ?").get(session.id) as
    | { is_active: number }
    | undefined;
  if (!row || row.is_active === 0) return null;
  // Every authenticated request is evidence of activity — this is what
  // powers the live online/away/offline presence indicators.
  db.prepare(`UPDATE users SET last_active = datetime('now') WHERE id = ?`).run(session.id);
  return session;
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function findUserByEmail(email: string) {
  const db = getDb();
  return db.prepare("SELECT * FROM users WHERE email = ?").get(email) as
    | {
        id: string;
        name: string;
        email: string;
        password_hash: string;
        role: Role;
        is_active: number;
      }
    | undefined;
}

/** Returns the subsystem ids a user leads (empty for admin, meaning "all") */
export function subsystemsLedBy(userId: string): string[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT subsystem_id FROM subsystem_members WHERE user_id = ? AND role_in_subsystem = 'LEADER'`
    )
    .all(userId) as { subsystem_id: string }[];
  return rows.map((r) => r.subsystem_id);
}

export function subsystemsMemberOf(userId: string): string[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT subsystem_id FROM subsystem_members WHERE user_id = ?`)
    .all(userId) as { subsystem_id: string }[];
  return rows.map((r) => r.subsystem_id);
}

export function canEditSubsystem(user: SessionUser, subsystemId: string): boolean {
  if (user.role === "ADMIN" || user.role === "CHIEF_ENGINEER") return true;
  if (user.role === "TEAM_LEADER") return subsystemsLedBy(user.id).includes(subsystemId);
  return false;
}

/** Admin + Chief Engineer + any Team Leader (of any team) count as "leadership" for review/approval gates. */
export function isLeadership(user: SessionUser): boolean {
  if (user.role === "ADMIN" || user.role === "CHIEF_ENGINEER") return true;
  if (user.role === "TEAM_LEADER") return subsystemsLedBy(user.id).length > 0;
  return false;
}

/** Can this user review/approve a task or procedure scoped to this subsystem? */
export function canReviewSubsystem(user: SessionUser, subsystemId: string | null): boolean {
  if (user.role === "ADMIN" || user.role === "CHIEF_ENGINEER") return true;
  if (user.role === "TEAM_LEADER" && subsystemId) return subsystemsLedBy(user.id).includes(subsystemId);
  return false;
}

export function touchLastActive(userId: string) {
  const db = getDb();
  db.prepare(`UPDATE users SET last_active = datetime('now') WHERE id = ?`).run(userId);
}

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

/** Session plus the JWT's issued-at, used to retire tokens older than a password change. */
export interface VerifiedSession extends SessionUser {
  iat?: number;
}

export async function verifySession(token: string): Promise<VerifiedSession | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey);
    return payload as unknown as VerifiedSession;
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
  const row = db
    .prepare("SELECT is_active, password_changed_at, role, name, email FROM users WHERE id = ?")
    .get(session.id) as
    | { is_active: number; password_changed_at: string | null; role: Role; name: string; email: string }
    | undefined;
  if (!row || row.is_active === 0) return null;

  // Retire sessions issued before the password changed. Without this a stolen
  // or shared token keeps working for the rest of its 30 days and changing the
  // password accomplishes nothing — which is the opposite of what anyone
  // changing a password expects.
  //
  // Checked here rather than in middleware because middleware cannot reach the
  // database. Middleware will still pass an old token through, but every page
  // and API route calls getSession, so the request is rejected a step later.
  if (row.password_changed_at && session.iat) {
    const changedAtSec = Math.floor(new Date(row.password_changed_at + "Z").getTime() / 1000);
    if (Number.isFinite(changedAtSec) && session.iat < changedAtSec) return null;
  }
  // Every authenticated request is evidence of activity — this is what
  // powers the live online/away/offline presence indicators.
  db.prepare(`UPDATE users SET last_active = datetime('now') WHERE id = ?`).run(session.id);

  // Role, name and email come from the DATABASE, not from the token.
  //
  // They used to come from the JWT, which meant a role change did nothing for
  // up to thirty days. Promoting somebody looked broken — Jonathan made Harper
  // an admin and she still could not see the admin controls. DEMOTING somebody
  // was worse and silent: a lead stripped of their role kept every power they
  // had until their token happened to expire.
  //
  // The row is already being read two lines up for is_active, so this costs
  // three more columns on a query that was happening anyway.
  return { ...session, role: row.role, name: row.name, email: row.email };
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

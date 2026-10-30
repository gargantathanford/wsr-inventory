/**
 * Database layer for the XP ledger. All the scoring decisions live in
 * rules.ts and ledger.ts; this file only reads rows, hands them to those pure
 * functions, and writes back what they return.
 *
 * Nothing here recomputes points. If a number looks wrong, the bug is in the
 * pure modules and there is a test for it.
 */
import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";
import {
  deriveTotals,
  dueDeferredAwards,
  prepareAward,
  prepareReversal,
  type AwardRequest,
  type AwardOutcome,
  type DeferredCandidate,
  type Totals,
  type XpEvent
} from "./ledger";
import {
  awardKey,
  computeStreak,
  isStale,
  localDay,
  PRESENCE_XP_ENABLED,
  settleShopSession,
  SHOP,
  type StreakResult
} from "./rules";

/**
 * The team works in one place, so one configured timezone IS everyone's local
 * timezone — which is both simpler and more reliable than trusting a browser
 * offset. Override with WSR_TIMEZONE if the team ever spans zones; a per-user
 * column can come later without changing any call site, since every function
 * here takes the zone as an argument.
 */
export const TEAM_TIMEZONE = process.env.WSR_TIMEZONE || "America/Chicago";

interface XpRow {
  id: string;
  user_id: string;
  kind: string;
  points: number;
  awarded_at: string;
  subsystem_id: string | null;
  source_type: string;
  source_id: string;
  transition: string;
  self_verified: number;
  status: XpEvent["status"];
  approved_by: string | null;
  approved_at: string | null;
  reverses: string | null;
  note: string | null;
}

const toEvent = (r: XpRow): XpEvent => ({
  id: r.id,
  userId: r.user_id,
  kind: r.kind,
  points: r.points,
  at: r.awarded_at,
  subsystemId: r.subsystem_id,
  sourceType: r.source_type,
  sourceId: r.source_id,
  transition: r.transition,
  selfVerified: !!r.self_verified,
  status: r.status,
  approvedBy: r.approved_by,
  approvedAt: r.approved_at,
  reverses: r.reverses,
  note: r.note
});

export function getUserEvents(userId: string): XpEvent[] {
  const db = getDb();
  return (
    db
      .prepare(`SELECT * FROM xp_events WHERE user_id = ? ORDER BY awarded_at DESC, id`)
      .all(userId) as XpRow[]
  ).map(toEvent);
}

function insert(e: XpEvent): void {
  getDb()
    .prepare(
      `INSERT INTO xp_events
         (id, user_id, kind, points, awarded_at, subsystem_id, source_type, source_id,
          transition, self_verified, status, approved_by, approved_at, reverses, note)
       VALUES (@id, @userId, @kind, @points, @at, @subsystemId, @sourceType, @sourceId,
          @transition, @selfVerified, @status, @approvedBy, @approvedAt, @reverses, @note)`
    )
    .run({
      ...e,
      selfVerified: e.selfVerified ? 1 : 0,
      approvedBy: e.approvedBy ?? null,
      approvedAt: e.approvedAt ?? null,
      reverses: e.reverses ?? null,
      note: e.note ?? null,
      subsystemId: e.subsystemId ?? null
    });
}

/**
 * Award XP for a real-world state transition.
 *
 * Never throws on a duplicate — a transition firing twice is normal (a retried
 * request, a double-clicked button) and must be a silent no-op, not an error
 * that breaks the surrounding operation. XP is a side effect of the real work;
 * it must never be able to fail the real work.
 */
export function award(req: Omit<AwardRequest, "timeZone"> & { timeZone?: string }): AwardOutcome {
  const full: AwardRequest = { ...req, timeZone: req.timeZone ?? TEAM_TIMEZONE };
  const existing = getUserEvents(full.userId);
  const outcome = prepareAward(existing, full);
  if (!outcome.ok) return outcome;

  try {
    insert(outcome.event);
  } catch (err: any) {
    // The PRIMARY KEY is the real idempotency guarantee; this catch covers the
    // race where two concurrent requests both passed the in-memory check.
    if (String(err?.code).includes("CONSTRAINT")) {
      return { ok: false, reason: "duplicate", existingId: outcome.event.id };
    }
    throw err;
  }
  return outcome;
}

/**
 * Award without letting a failure propagate. Use this at call sites inside a
 * real operation — reconciling a PO, approving a task — so a problem in the
 * gamification layer can never roll back the thing the user actually did.
 */
export function awardQuietly(req: Parameters<typeof award>[0]): AwardOutcome | null {
  try {
    return award(req);
  } catch (err) {
    console.error("[xp] award failed, continuing:", err);
    return null;
  }
}

/**
 * Compensate an award that is no longer true — a task reopened, a receipt
 * un-reconciled. The original row is never touched.
 */
export function reverse(
  sourceType: string,
  sourceId: string,
  transition: string,
  note: string,
  at = new Date().toISOString()
): XpEvent | null {
  const db = getDb();
  const id = awardKey(sourceType, sourceId, transition);
  const row = db.prepare(`SELECT * FROM xp_events WHERE id = ?`).get(id) as XpRow | undefined;
  if (!row) return null;
  const already = db.prepare(`SELECT 1 FROM xp_events WHERE reverses = ?`).get(id);
  if (already) return null; // already compensated

  const rev = prepareReversal(toEvent(row), at, note);
  insert(rev);
  return rev;
}

/** Approve a PENDING award. Approval is the only mutation this table allows. */
export function approve(eventId: string, approverId: string, at = new Date().toISOString()): boolean {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM xp_events WHERE id = ? AND status = 'PENDING'`).get(eventId) as
    | XpRow
    | undefined;
  if (!row) return false;

  // Someone approving their own award defeats the point of the tier.
  if (row.user_id === approverId) return false;

  db.prepare(`UPDATE xp_events SET status = 'AWARDED', approved_by = ?, approved_at = ? WHERE id = ?`).run(
    approverId,
    at,
    eventId
  );
  db.prepare(
    `INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, details)
     VALUES (?, ?, 'APPROVE_XP', 'XP_EVENT', ?, ?)`
  ).run(newId("log"), approverId, eventId, `${row.kind} +${row.points} for ${row.user_id}`);
  return true;
}

/** Reject a PENDING award outright. Pays nothing; the row stays as the record. */
export function rejectAward(eventId: string, approverId: string, note: string): boolean {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM xp_events WHERE id = ? AND status = 'PENDING'`).get(eventId) as
    | XpRow
    | undefined;
  if (!row) return false;
  db.prepare(`UPDATE xp_events SET status = 'VOID', approved_by = ?, approved_at = ?, note = ? WHERE id = ?`).run(
    approverId,
    new Date().toISOString(),
    note,
    eventId
  );
  return true;
}

export function getTotals(userId: string): Totals {
  return deriveTotals(getUserEvents(userId));
}

/** Pending approval-tier awards, for the leads' queue. Never one's own. */
export function getPendingApprovals(excludeUserId?: string) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT x.*, u.name AS user_name, s.name AS subsystem_name
         FROM xp_events x
         JOIN users u ON u.id = x.user_id
         LEFT JOIN subsystems s ON s.id = x.subsystem_id
        WHERE x.status = 'PENDING' ${excludeUserId ? "AND x.user_id != ?" : ""}
        ORDER BY x.awarded_at`
    )
    .all(...(excludeUserId ? [excludeUserId] : [])) as Array<XpRow & { user_name: string; subsystem_name: string | null }>;
  return rows.map((r) => ({ ...toEvent(r), userName: r.user_name, subsystemName: r.subsystem_name }));
}

/**
 * Engineering Days.
 *
 * A day qualifies on either of: a non-reversed, non-self-verified XP event, or
 * a settled shop session of an hour or more. That second clause is load-bearing
 * — plenty of the best people spend Saturday on the mill and never open the
 * dashboard, and a system that only sees dashboard activity reads them as
 * inactive, which is both wrong and insulting.
 */
export function getStreak(userId: string, timeZone = TEAM_TIMEZONE): StreakResult {
  const db = getDb();

  const reversed = new Set(
    (db.prepare(`SELECT reverses FROM xp_events WHERE reverses IS NOT NULL`).all() as Array<{ reverses: string }>).map(
      (r) => r.reverses
    )
  );

  const events = db
    .prepare(
      `SELECT id, awarded_at FROM xp_events
        WHERE user_id = ? AND status = 'AWARDED' AND self_verified = 0 AND reverses IS NULL`
    )
    .all(userId) as Array<{ id: string; awarded_at: string }>;

  const days = new Set<string>();
  for (const e of events) if (!reversed.has(e.id)) days.add(localDay(e.awarded_at, timeZone));

  const sessions = db
    .prepare(
      `SELECT closed_at, verified_minutes, unverified_minutes FROM shop_sessions
        WHERE user_id = ? AND state = 'settled' AND closed_at IS NOT NULL`
    )
    .all(userId) as Array<{ closed_at: string; verified_minutes: number; unverified_minutes: number }>;

  for (const s of sessions) {
    if (s.verified_minutes + s.unverified_minutes >= 60) days.add(localDay(s.closed_at, timeZone));
  }

  const graceUsedByMonth: Record<string, number> = {};
  return computeStreak([...days], localDay(new Date().toISOString(), timeZone), { graceUsedByMonth });
}

/**
 * Settle a shop session and award its presence XP.
 * Hours are recorded on the session regardless of any XP cap — leads need real
 * hours for competition documentation and for spotting burnout.
 */
export function settleSession(sessionId: string, timeZone = TEAM_TIMEZONE): { points: number; reason: string } | null {
  const db = getDb();
  const s = db.prepare(`SELECT * FROM shop_sessions WHERE id = ?`).get(sessionId) as any;
  if (!s) return null;

  const today = localDay(s.closed_at ?? new Date().toISOString(), timeZone);
  const events = getUserEvents(s.user_id);
  const presenceToday = events
    .filter((e) => e.kind === "shop.sessionSettled" && localDay(e.at, timeZone) === today && e.status === "AWARDED")
    .reduce((a, e) => a + e.points, 0);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const presenceWeek = events
    .filter((e) => e.kind === "shop.sessionSettled" && e.at >= weekAgo && e.status === "AWARDED")
    .reduce((a, e) => a + e.points, 0);

  const settlement = settleShopSession({
    verifiedMinutes: s.verified_minutes,
    unverifiedMinutes: s.unverified_minutes,
    openFactors: JSON.parse(s.open_factors || "[]"),
    closeMethod: s.close_method ?? "manual",
    state: s.state,
    alreadyEarnedToday: presenceToday,
    alreadyEarnedThisWeek: presenceWeek
  });

  if (settlement.points > 0 && PRESENCE_XP_ENABLED) {
    awardQuietly({
      userId: s.user_id,
      kind: "shop.sessionSettled",
      sourceType: "shop",
      sourceId: sessionId,
      transition: "settled",
      at: s.closed_at ?? new Date().toISOString(),
      timeZone
    });
    // The pure table has no points for this kind — the amount is per session —
    // so correct the row to the settled figure.
    db.prepare(`UPDATE xp_events SET points = ?, note = ? WHERE id = ?`).run(
      settlement.points,
      settlement.reason,
      awardKey("shop", sessionId, "settled")
    );
  }
  // With presence XP off, the hours are the deliverable. Report what the
  // session WOULD have earned so the number is visible when the flag flips,
  // but pay nothing.
  if (!PRESENCE_XP_ENABLED) {
    return {
      points: 0,
      reason:
        settlement.points > 0
          ? `${settlement.recordedMinutes} minutes recorded. Presence XP is not enabled yet.`
          : settlement.reason
    };
  }
  return { points: settlement.points, reason: settlement.reason };
}

// ---------------------------------------------------------------------------
// SHOP SESSIONS
// ---------------------------------------------------------------------------

export interface ShopSessionRow {
  id: string;
  user_id: string;
  opened_at: string;
  closed_at: string | null;
  open_factors: string;
  close_method: string | null;
  verified_minutes: number;
  unverified_minutes: number;
  state: "open" | "settled" | "void";
  correction_note: string | null;
}

const minutesBetween = (a: string, b: string): number =>
  Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000));

export function getOpenSession(userId: string): ShopSessionRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM shop_sessions WHERE user_id = ? AND state = 'open' ORDER BY opened_at DESC LIMIT 1`)
    .get(userId) as ShopSessionRow | undefined;
}

/**
 * Open a session.
 *
 * One open session per person globally: opening a second closes the first as
 * void. Without that rule a forgotten session on a laptop quietly accumulates
 * while the person works from their phone.
 *
 * No verification factors in v1 — everything lands in unverified_minutes and
 * open_factors stays empty. The columns exist so turning verification on later
 * is a feature, not a migration.
 */
export function openSession(userId: string, at = new Date().toISOString()): ShopSessionRow {
  const db = getDb();
  const existing = getOpenSession(userId);
  if (existing) {
    db.prepare(
      `UPDATE shop_sessions SET state = 'void', closed_at = ?, close_method = 'auto',
         correction_note = 'Voided automatically because a newer session was opened.' WHERE id = ?`
    ).run(at, existing.id);
  }

  const id = newId("shop");
  db.prepare(
    `INSERT INTO shop_sessions (id, user_id, opened_at, open_factors, state) VALUES (?, ?, ?, '[]', 'open')`
  ).run(id, userId, at);
  db.prepare(
    `INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, details)
     VALUES (?, ?, 'SHOP_OPEN', 'SHOP_SESSION', ?, 'Checked in')`
  ).run(newId("log"), userId, id);

  return getDb().prepare(`SELECT * FROM shop_sessions WHERE id = ?`).get(id) as ShopSessionRow;
}

/** Close the caller's open session and settle it. Returns null if none was open. */
export function closeSession(
  userId: string,
  at = new Date().toISOString(),
  timeZone = TEAM_TIMEZONE
): { session: ShopSessionRow; points: number; reason: string } | null {
  const db = getDb();
  const open = getOpenSession(userId);
  if (!open) return null;

  // Past the 04:00 boundary this session is no longer a credible record of a
  // single visit, so it voids rather than logging an implausible duration.
  const stale = isStale(open.opened_at, at, timeZone);
  const minutes = minutesBetween(open.opened_at, at);

  db.prepare(
    `UPDATE shop_sessions SET closed_at = ?, close_method = ?, state = ?,
       unverified_minutes = ?, correction_note = ? WHERE id = ?`
  ).run(
    at,
    stale ? "auto" : "manual",
    stale ? "void" : "settled",
    stale ? minutes : minutes,
    stale ? `Open past ${SHOP.autoVoidHourLocal}:00 local — voided. Ask a lead for a late close if the time is right.` : null,
    open.id
  );

  db.prepare(
    `INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, details)
     VALUES (?, ?, 'SHOP_CLOSE', 'SHOP_SESSION', ?, ?)`
  ).run(newId("log"), userId, open.id, `${minutes} minutes${stale ? " (voided, left open overnight)" : ""}`);

  const settled = settleSession(open.id, timeZone);
  const session = db.prepare(`SELECT * FROM shop_sessions WHERE id = ?`).get(open.id) as ShopSessionRow;
  return { session, points: settled?.points ?? 0, reason: settled?.reason ?? "" };
}

/**
 * Void every session left open past the local 04:00 boundary.
 *
 * Called opportunistically whenever the shop API is read, and available as
 * scripts/void-stale-sessions.ts for a cron job. Doing it on read means the
 * timesheet is never showing a 40-hour open session just because no scheduled
 * job ran.
 */
export function voidStaleSessions(now = new Date().toISOString(), timeZone = TEAM_TIMEZONE): number {
  const db = getDb();
  const open = db.prepare(`SELECT * FROM shop_sessions WHERE state = 'open'`).all() as ShopSessionRow[];
  let voided = 0;
  for (const s of open) {
    if (!isStale(s.opened_at, now, timeZone)) continue;
    db.prepare(
      `UPDATE shop_sessions SET state = 'void', closed_at = ?, close_method = 'auto',
         unverified_minutes = ?, correction_note = ? WHERE id = ?`
    ).run(
      now,
      minutesBetween(s.opened_at, now),
      `Left open past ${SHOP.autoVoidHourLocal}:00 local and voided. An unclosed session records no credited time.`,
      s.id
    );
    voided++;
  }
  return voided;
}

/** A person's own session history, newest first. */
export function getSessions(userId: string, limit = 50): ShopSessionRow[] {
  return getDb()
    .prepare(`SELECT * FROM shop_sessions WHERE user_id = ? ORDER BY opened_at DESC LIMIT ?`)
    .all(userId, limit) as ShopSessionRow[];
}

/**
 * Hours per person over a window, for leads. A person's session history is
 * visible to them and to leads — not to the whole team.
 */
export function getTeamHours(sinceIso: string) {
  return getDb()
    .prepare(
      `SELECT u.id, u.name,
              COUNT(s.id) AS sessions,
              COALESCE(SUM(CASE WHEN s.state = 'settled'
                   THEN s.verified_minutes + s.unverified_minutes ELSE 0 END), 0) AS minutes,
              COALESCE(SUM(CASE WHEN s.state = 'void' THEN 1 ELSE 0 END), 0) AS voided
         FROM users u
         LEFT JOIN shop_sessions s ON s.user_id = u.id AND s.opened_at >= ?
        WHERE u.is_active = 1
        GROUP BY u.id
        ORDER BY minutes DESC, u.name`
    )
    .all(sinceIso) as Array<{ id: string; name: string; sessions: number; minutes: number; voided: number }>;
}

/**
 * Deferred first-time-right awards, resolved on read rather than by a cron job.
 * Call this from the XP read path; it is cheap and idempotent.
 */
export function settleDeferred(userId: string, timeZone = TEAM_TIMEZONE): number {
  const db = getDb();
  // A task closes when a lead APPROVES it, which sets reviewed_at and status
  // COMPLETED. "Reopened" is a RETURN logged after that approval — the review
  // route writes RETURN when it sends a task back for additional work.
  const candidates = db
    .prepare(
      `SELECT t.id AS sourceId, t.reviewed_at AS closedAt, t.subsystem_id AS subsystemId,
              t.submitted_by AS userId,
              EXISTS(SELECT 1 FROM activity_log a
                      WHERE a.entity_type = 'TASK' AND a.entity_id = t.id
                        AND a.action = 'RETURN' AND a.created_at > t.reviewed_at) AS reopenedSince
         FROM tasks t
        WHERE t.status = 'COMPLETED' AND t.reviewed_at IS NOT NULL AND t.submitted_by = ?`
    )
    .all(userId) as Array<any>;

  const reqs = dueDeferredAwards(
    candidates.map((c) => ({
      userId: c.userId,
      sourceType: "task",
      sourceId: c.sourceId,
      closedAt: c.closedAt,
      reopenedSince: !!c.reopenedSince,
      subsystemId: c.subsystemId
    })) as DeferredCandidate[],
    getUserEvents(userId),
    new Date().toISOString(),
    timeZone
  );

  let paid = 0;
  for (const r of reqs) {
    const out = awardQuietly(r);
    if (out?.ok) paid++;
  }
  return paid;
}

/** Per-subsystem rollup. The team view compares subsystems, never individuals. */
export function getSubsystemXp() {
  const db = getDb();
  return db
    .prepare(
      `SELECT s.id, s.name, s.code, COALESCE(SUM(x.points), 0) AS points, COUNT(x.id) AS events
         FROM subsystems s
         LEFT JOIN xp_events x
           ON x.subsystem_id = s.id
          AND x.status = 'AWARDED'
          AND x.reverses IS NULL
          AND NOT EXISTS (SELECT 1 FROM xp_events r WHERE r.reverses = x.id)
        GROUP BY s.id
        ORDER BY points DESC, s.name`
    )
    .all() as Array<{ id: string; name: string; code: string | null; points: number; events: number }>;
}

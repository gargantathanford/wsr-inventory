/**
 * XP ledger — pure. Append-only events in, derived totals out.
 *
 * TOTALS ARE DERIVED, NEVER STORED. The freeze-readiness dashboard uses a
 * running counter and that was the wrong call: you cannot audit it, you cannot
 * recompute when the XP table changes, and a failed write silently loses
 * points. Store events; reduce them on read.
 *
 * Reversals are compensating events that reference the original. The original
 * is never deleted or mutated — the ledger IS the audit trail, and a person
 * looking at their own history needs to see that something was reversed rather
 * than find it quietly missing.
 */
import { DAILY_XP_CAP, XP_EVENTS, localDay, pointsFor, requiresApproval, awardKey } from "./rules";
import { applyMultiplier } from "./ranks";

export type XpStatus = "PENDING" | "AWARDED" | "REVERSED" | "VOID";

export interface XpEvent {
  /** Idempotency key for awards (`sourceType:sourceId:transition`), or
   *  `rev:<original id>` for a reversal. */
  id: string;
  userId: string;
  kind: string;
  /** Points as recorded. Already reduced for self-verification, already capped. */
  points: number;
  at: string;
  subsystemId?: string | null;
  sourceType: string;
  sourceId: string;
  transition: string;
  selfVerified: boolean;
  status: XpStatus;
  /** Set when status is PENDING -> AWARDED. */
  approvedBy?: string | null;
  approvedAt?: string | null;
  /** The event this one compensates, if any. */
  reverses?: string | null;
  note?: string | null;
}

/** Only AWARDED events count toward a total. Pending, reversed and void do not. */
export function countsTowardTotal(e: XpEvent): boolean {
  return e.status === "AWARDED";
}

/**
 * An event is cancelled if a reversal references it. Checked as a set rather
 * than per-event so deriving totals stays linear.
 */
export function reversedIds(events: XpEvent[]): Set<string> {
  const out = new Set<string>();
  for (const e of events) if (e.reverses) out.add(e.reverses);
  return out;
}

export interface Totals {
  total: number;
  pending: number;
  byKind: Record<string, number>;
  bySubsystem: Record<string, number>;
  /** Events that paid 40% because one person did all of it. Surfaced, not hidden. */
  selfVerifiedCount: number;
  reversedCount: number;
}

export function deriveTotals(events: XpEvent[]): Totals {
  const reversed = reversedIds(events);
  const t: Totals = {
    total: 0,
    pending: 0,
    byKind: {},
    bySubsystem: {},
    selfVerifiedCount: 0,
    reversedCount: 0
  };

  for (const e of events) {
    if (e.reverses) continue; // the compensating event itself is not an award
    if (reversed.has(e.id)) {
      t.reversedCount++;
      continue;
    }
    if (e.status === "PENDING") {
      t.pending += e.points;
      continue;
    }
    if (!countsTowardTotal(e)) continue;

    t.total += e.points;
    t.byKind[e.kind] = (t.byKind[e.kind] ?? 0) + e.points;
    if (e.subsystemId) t.bySubsystem[e.subsystemId] = (t.bySubsystem[e.subsystemId] ?? 0) + e.points;
    if (e.selfVerified) t.selfVerifiedCount++;
  }
  return t;
}

/** Awarded points for one person on one local day — what the cap is measured against. */
export function pointsOnDay(events: XpEvent[], day: string, timeZone: string): number {
  const reversed = reversedIds(events);
  let sum = 0;
  for (const e of events) {
    if (e.reverses || reversed.has(e.id) || !countsTowardTotal(e)) continue;
    if (localDay(e.at, timeZone) === day) sum += e.points;
  }
  return sum;
}

export interface AwardRequest {
  userId: string;
  kind: string;
  sourceType: string;
  sourceId: string;
  transition: string;
  at: string;
  timeZone: string;
  subsystemId?: string | null;
  /** True when the same person created the item, closed it and supplied its evidence. */
  selfVerified?: boolean;
  note?: string | null;
  /**
   * The multiplier in force at `at`, from an open window. 1 when none applies.
   *
   * Passed IN rather than looked up here, because this module is pure and the
   * windows live in a table. The caller resolves it with multiplierAt().
   */
  multiplier?: number;
}

export type AwardOutcome =
  | { ok: true; event: XpEvent; cappedFrom?: number }
  | { ok: false; reason: "duplicate" | "unknown-kind" | "cap-reached"; existingId?: string };

/**
 * Decide what a single award becomes. Pure: hand it the existing ledger and it
 * returns the event to append, or why it declined.
 *
 * The caller writes the returned event. Nothing here touches a database, which
 * is what makes the cap, the self-verify reduction and the idempotency check
 * testable without one.
 */
export function prepareAward(existing: XpEvent[], req: AwardRequest): AwardOutcome {
  const def = XP_EVENTS[req.kind];
  if (!def) return { ok: false, reason: "unknown-kind" };

  const id = awardKey(req.sourceType, req.sourceId, req.transition);

  // Idempotency: the same transition on the same object can never pay twice,
  // which is what defeats close-and-reopen farming.
  const already = existing.find((e) => e.id === id);
  if (already) return { ok: false, reason: "duplicate", existingId: already.id };

  const selfVerified = !!req.selfVerified;
  const base = pointsFor(req.kind, { selfVerified });

  // A multiplier window applies BEFORE the daily cap, never after. If it were
  // applied afterwards it would be the one way to escape the cap, and the cap
  // is the thing standing between the whole XP feature and somebody farming
  // it. A double-XP day is a better day, not an unbounded one.
  const multiplier = req.multiplier && req.multiplier > 1 ? req.multiplier : 1;
  const full = applyMultiplier(base, multiplier);

  // Approval-tier awards land PENDING and pay nothing yet, so they do not
  // consume cap room until a human approves them.
  if (requiresApproval(req.kind)) {
    return {
      ok: true,
      event: {
        id,
        userId: req.userId,
        kind: req.kind,
        points: full,
        at: req.at,
        subsystemId: req.subsystemId ?? null,
        sourceType: req.sourceType,
        sourceId: req.sourceId,
        transition: req.transition,
        selfVerified,
        status: "PENDING",
        reverses: null,
        note: req.note ?? null
      }
    };
  }

  const day = localDay(req.at, req.timeZone);
  const earnedToday = pointsOnDay(existing, day, req.timeZone);
  const room = Math.max(0, DAILY_XP_CAP - earnedToday);
  if (room === 0) return { ok: false, reason: "cap-reached" };

  const points = Math.min(full, room);

  return {
    ok: true,
    event: {
      id,
      userId: req.userId,
      kind: req.kind,
      points,
      at: req.at,
      subsystemId: req.subsystemId ?? null,
      sourceType: req.sourceType,
      sourceId: req.sourceId,
      transition: req.transition,
      selfVerified,
      status: "AWARDED",
      reverses: null,
      note: req.note ?? null
    },
    ...(points < full ? { cappedFrom: full } : {})
  };
}

/**
 * Build the compensating event for an award that is no longer true — a task
 * reopened, a receipt un-reconciled.
 *
 * Note the sign: the reversal records the SAME positive points and is excluded
 * from totals by reference, rather than storing a negative number. That keeps
 * the no-negative-XP rule true at the data level, so no display path can ever
 * render a person's score going down.
 */
export function prepareReversal(original: XpEvent, at: string, note: string): XpEvent {
  return {
    id: `rev:${original.id}`,
    userId: original.userId,
    kind: original.kind,
    points: original.points,
    at,
    subsystemId: original.subsystemId ?? null,
    sourceType: original.sourceType,
    sourceId: original.sourceId,
    transition: original.transition,
    selfVerified: original.selfVerified,
    status: "REVERSED",
    reverses: original.id,
    note
  };
}

/**
 * Deferred awards, recomputed on read rather than by a background job.
 *
 * `task.firstTimeRight` pays 7 days after a task closed, and only if it was
 * never reopened. The payout depends on the future, which is exactly why it
 * cannot be farmed — and why it is derived at read time instead of scheduled.
 */
export interface DeferredCandidate {
  userId: string;
  sourceType: string;
  sourceId: string;
  closedAt: string;
  reopenedSince: boolean;
  subsystemId?: string | null;
  selfVerified?: boolean;
}

export function dueDeferredAwards(
  candidates: DeferredCandidate[],
  existing: XpEvent[],
  now: string,
  timeZone: string
): AwardRequest[] {
  const kind = "task.firstTimeRight";
  const waitDays = XP_EVENTS[kind]?.deferredDays ?? 7;
  const nowMs = new Date(now).getTime();
  const out: AwardRequest[] = [];

  for (const c of candidates) {
    if (c.reopenedSince) continue;
    const elapsedDays = (nowMs - new Date(c.closedAt).getTime()) / 86_400_000;
    if (elapsedDays < waitDays) continue;
    const id = awardKey(c.sourceType, c.sourceId, kind);
    if (existing.some((e) => e.id === id)) continue;
    out.push({
      userId: c.userId,
      kind,
      sourceType: c.sourceType,
      sourceId: c.sourceId,
      transition: kind,
      at: now,
      timeZone,
      subsystemId: c.subsystemId ?? null,
      selfVerified: c.selfVerified
    });
  }
  return out;
}

/**
 * XP rules — pure. No React, no database, no clock of its own.
 *
 * Every function here takes its inputs explicitly (including "now") so the
 * scoring can be unit-tested without rendering anything or stubbing time.
 *
 * ---------------------------------------------------------------------------
 * The design constraint, restated because it is the whole point
 *
 * A project-management dashboard is trivially farmable. The five ways this
 * feature could damage the team:
 *
 *   1. Creating tasks in order to have tasks to close.
 *   2. Flipping a status field with no real-world change behind it.
 *   3. Closing and reopening the same task to re-earn.
 *   4. Splitting one job into six tickets.
 *   5. Racing to mark POs received before the parts are reconciled.
 *
 * The rules that defeat each:
 *
 *   - XP attaches to VERIFIED STATE TRANSITIONS of real-world objects, never to
 *     record creation. Drafting a PO earns nothing; reconciling one earns.
 *   - Every award carries an idempotency key `sourceType:sourceId:transition`,
 *     so the same transition can never pay twice (defeats 3).
 *   - Reversals are compensating events, never deletions. The ledger is the
 *     audit trail.
 *   - Self-dealing is paid at 40% and labelled, not hidden (defeats 1 and 4).
 *   - A daily cap means a bulk data-entry afternoon cannot outrank six weeks of
 *     shop work (defeats 4).
 *   - XP never scales with dollar amount. A $900 damper PO earns what a $12
 *     fastener PO earns, because scaling by money rewards spending.
 *   - No negative XP, ever. Overdue tools and missed dates get their own
 *     indicator. Penalty XP drives non-reporting, which is worse than the late
 *     return.
 * ---------------------------------------------------------------------------
 */

/** Daily ceiling per person, across every source including shop presence. */
export const DAILY_XP_CAP = 100;

/** Paid when one person created the item, closed it, and supplied its evidence. */
export const SELF_VERIFIED_MULTIPLIER = 0.4;

/**
 * How an award is authorised.
 *
 *   AUTO      — derivable from data the app already holds. Not worth a human's
 *               attention, and cheap to verify after the fact.
 *   EVIDENCE  — requires attached evidence. The existing task-completion flow
 *               already demands a summary or image; that IS the check.
 *   APPROVAL  — a lead, Chief Engineer or admin must approve. Lands as PENDING
 *               and pays nothing until approved. Reserved for the large awards
 *               and the ones most open to gaming.
 */
export type Tier = "AUTO" | "EVIDENCE" | "APPROVAL";

export interface XpEventDef {
  kind: string;
  points: number;
  tier: Tier;
  /** What real-world transition this pays for. */
  fires: string;
  /** Paid later, on a condition that cannot be known at award time. */
  deferredDays?: number;
}

/**
 * The table. Tiers follow the rule that anything heavily weighted needs
 * approval — the 30+ awards all sit behind a human.
 *
 * Approval-gated events deliberately hang off transitions the dashboard
 * ALREADY gates (tasks move Submitted for Review -> Completed via a lead;
 * purchase requests have approve/reject) rather than adding a new queue for
 * people to ignore.
 */
export const XP_EVENTS: Record<string, XpEventDef> = {
  "tool.returnedOnTime": {
    kind: "tool.returnedOnTime",
    points: 5,
    tier: "AUTO",
    fires: "Tool checked in on or before its due date"
  },
  "po.receiptAttached": {
    kind: "po.receiptAttached",
    points: 5,
    tier: "AUTO",
    fires: "Receipt or invoice image attached to a purchase order"
  },
  "part.sourced": {
    kind: "part.sourced",
    points: 10,
    tier: "AUTO",
    fires: "A part line gains vendor, cost AND lead time — all three"
  },
  "part.ruleCited": {
    kind: "part.ruleCited",
    points: 10,
    tier: "AUTO",
    fires: "A part gains a clause citation from the active ruleset"
  },
  "task.firstTimeRight": {
    kind: "task.firstTimeRight",
    points: 10,
    tier: "AUTO",
    deferredDays: 7,
    fires: "7 days after a task closed, only if it was never reopened"
  },
  "status.submittedOnTime": {
    kind: "status.submittedOnTime",
    points: 15,
    tier: "EVIDENCE",
    fires: "Weekly subsystem status filed before the deadline"
  },
  "task.completed": {
    kind: "task.completed",
    points: 20,
    tier: "EVIDENCE",
    fires: "Task approved by a lead with completion evidence attached"
  },
  "part.longLeadFlagged": {
    kind: "part.longLeadFlagged",
    points: 20,
    tier: "EVIDENCE",
    fires: "Part with lead time over 4 weeks flagged more than 6 weeks before need-by"
  },
  "po.reconciled": {
    kind: "po.reconciled",
    points: 25,
    tier: "EVIDENCE",
    fires: "Received quantities checked against the order, discrepancies recorded"
  },
  "task.criticalPath": {
    kind: "task.criticalPath",
    points: 30,
    tier: "APPROVAL",
    fires: "Critical-path task closed on or before its due date"
  },
  "blocker.resolved": {
    kind: "blocker.resolved",
    points: 35,
    tier: "APPROVAL",
    fires: "Resolved a blocker ANOTHER person raised"
  },
  "part.designFrozen": {
    kind: "part.designFrozen",
    points: 40,
    tier: "APPROVAL",
    fires: "A part reaches FROZEN with an acceptance criterion and a cited rule"
  },
  "shop.sessionSettled": {
    kind: "shop.sessionSettled",
    points: 0, // computed per session — see settleShopSession
    tier: "AUTO",
    fires: "A verified shop session that was properly closed"
  }
};

/** Confetti fires only for these. Everything else gets a quiet toast. */
export const CELEBRATED_TIERS: readonly Tier[] = ["APPROVAL", "EVIDENCE"];

export function isCelebrated(kind: string): boolean {
  const def = XP_EVENTS[kind];
  return !!def && CELEBRATED_TIERS.includes(def.tier) && def.points >= 20;
}

export function requiresApproval(kind: string): boolean {
  return XP_EVENTS[kind]?.tier === "APPROVAL";
}

/** Idempotency key. The same transition on the same object can never pay twice. */
export function awardKey(sourceType: string, sourceId: string, transition: string): string {
  return `${sourceType}:${sourceId}:${transition}`;
}

/**
 * Points for one award, before the daily cap is applied.
 * Rounded to an integer so the ledger never accumulates float drift.
 */
export function pointsFor(kind: string, opts: { selfVerified?: boolean } = {}): number {
  const def = XP_EVENTS[kind];
  if (!def) return 0;
  const base = def.points;
  return opts.selfVerified ? Math.round(base * SELF_VERIFIED_MULTIPLIER) : base;
}

// ---------------------------------------------------------------------------
// SHOP TIME
// ---------------------------------------------------------------------------

/**
 * Presence is necessary but not sufficient. A full day in the shop must be worth
 * less than a handful of real outcomes, or the system rewards loitering.
 */
export const SHOP = {
  /** XP per hour inside the geofence with heartbeat coverage. */
  verifiedRatePerHour: 6,
  /** XP per hour where heartbeats were missing. Mobile browsers throttle
   *  background tabs, so gaps are normal and are NOT evidence of fraud —
   *  they pay less rather than being voided. */
  unverifiedRatePerHour: 3,
  /** Full rate for the first 3 hours, half for hours 4-6, nothing beyond 6.
   *  Sleeping in the shop is not an achievement. */
  fullRateHours: 3,
  halfRateHours: 3,
  /** Drive-by scans pay nothing. */
  minimumSessionMinutes: 20,
  /** Presence caps, inside the overall daily cap. */
  dailyCap: 25,
  weeklyCap: 100,
  /** A late-close request on a voided session pays half. */
  lateCloseMultiplier: 0.5,
  lateCloseRequestHours: 48,
  lateClosesPerMonth: 2,
  /** Sessions still open at this local hour auto-void. */
  autoVoidHourLocal: 4,
  /** Outside the geofence this long and the session auto-closes at the last
   *  inside timestamp. This is what stops "check in, drive home, close at
   *  midnight". */
  outsideGeofenceMinutesBeforeAutoClose: 20
} as const;

export type ShopSessionState = "open" | "settled" | "void";
export type VerificationFactor = "geofence" | "doorCode" | "coPresence";

export interface ShopSessionInput {
  verifiedMinutes: number;
  unverifiedMinutes: number;
  /** Which factors verified the open. Two are required; one is never enough. */
  openFactors: VerificationFactor[];
  /** "auto" = geofence noticed they left. "manual-late" = approved late close. */
  closeMethod: "geofence" | "manual" | "auto" | "manual-late";
  state: ShopSessionState;
  /** Presence XP this person has already banked today and this week. */
  alreadyEarnedToday: number;
  alreadyEarnedThisWeek: number;
}

export interface ShopSettlement {
  points: number;
  /** True hours, recorded regardless of any cap — leads need real hours for
   *  competition documentation and for spotting burnout. The caps limit XP,
   *  never the timesheet. */
  recordedMinutes: number;
  reason: string;
  capped: boolean;
}

/**
 * Settlement arithmetic for one shop session.
 *
 * Jonathan's rule: an unclosed session pays nothing. Implemented as
 * WITHHOLDING, not penalty — the session never earns, rather than losing points
 * that were already banked. No negative XP is ever written here.
 */
export function settleShopSession(s: ShopSessionInput): ShopSettlement {
  const total = s.verifiedMinutes + s.unverifiedMinutes;
  const recordedMinutes = total;

  if (s.state === "open") {
    return { points: 0, recordedMinutes, reason: "Session still open — open sessions award nothing.", capped: false };
  }
  if (s.state === "void" && s.closeMethod !== "manual-late") {
    return {
      points: 0,
      recordedMinutes,
      reason: "Session was never closed and auto-voided. Request a late close within 48 hours for half credit.",
      capped: false
    };
  }
  if (s.openFactors.length < 2) {
    return {
      points: 0,
      recordedMinutes,
      reason: `Only ${s.openFactors.length} verification factor${s.openFactors.length === 1 ? "" : "s"} at check-in — two are required.`,
      capped: false
    };
  }
  if (total < SHOP.minimumSessionMinutes) {
    return {
      points: 0,
      recordedMinutes,
      reason: `Session under the ${SHOP.minimumSessionMinutes}-minute minimum.`,
      capped: false
    };
  }

  // Decaying rate by hour of the day's session, verified minutes consumed first
  // so a person is never penalised for the order their heartbeats landed in.
  let remainingVerified = s.verifiedMinutes;
  let remainingUnverified = s.unverifiedMinutes;
  let raw = 0;

  const bands: Array<{ hours: number; multiplier: number }> = [
    { hours: SHOP.fullRateHours, multiplier: 1 },
    { hours: SHOP.halfRateHours, multiplier: 0.5 }
  ];

  for (const band of bands) {
    let bandMinutes = band.hours * 60;
    const takeVerified = Math.min(remainingVerified, bandMinutes);
    remainingVerified -= takeVerified;
    bandMinutes -= takeVerified;
    const takeUnverified = Math.min(remainingUnverified, bandMinutes);
    remainingUnverified -= takeUnverified;

    raw +=
      (takeVerified / 60) * SHOP.verifiedRatePerHour * band.multiplier +
      (takeUnverified / 60) * SHOP.unverifiedRatePerHour * band.multiplier;
  }
  // Anything past hour 6 pays nothing — remaining minutes are simply dropped.

  if (s.closeMethod === "manual-late") raw *= SHOP.lateCloseMultiplier;

  let points = Math.round(raw);
  const beforeCaps = points;

  const dailyRoom = Math.max(0, SHOP.dailyCap - s.alreadyEarnedToday);
  const weeklyRoom = Math.max(0, SHOP.weeklyCap - s.alreadyEarnedThisWeek);
  points = Math.min(points, dailyRoom, weeklyRoom);

  const capped = points < beforeCaps;
  const reason = capped
    ? `${beforeCaps} XP earned, ${points} paid — presence cap reached (${SHOP.dailyCap}/day, ${SHOP.weeklyCap}/week).`
    : s.closeMethod === "manual-late"
    ? `Late close approved — paid at ${SHOP.lateCloseMultiplier * 100}%.`
    : "Settled.";

  return { points, recordedMinutes, reason, capped };
}

// ---------------------------------------------------------------------------
// ENGINEERING DAYS (the streak)
// ---------------------------------------------------------------------------

/**
 * One grace day per calendar month. A single missed day does not break the run,
 * and the UI marks it visibly as a grace day rather than pretending the person
 * was there.
 */
export const GRACE_DAYS_PER_MONTH = 1;

export interface StreakResult {
  current: number;
  longest: number;
  /** Local dates (YYYY-MM-DD) that counted. */
  activeDays: string[];
  /** Local dates covered by a grace day rather than real activity. */
  graceDays: string[];
}

/**
 * Local calendar date for an instant, in a named IANA timezone.
 *
 * Day boundaries MUST be computed in the user's own timezone. A UTC boundary
 * silently eats streaks for anyone working in the evening, and a streak bug
 * destroys trust in the whole feature — people stop believing any of the
 * numbers, including the ones that matter.
 */
export function localDay(iso: string, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD, which sorts correctly as a string.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(iso));
}

const addDays = (day: string, n: number): string => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * A day counts if the person did EITHER of:
 *   - generated at least one non-reversed, non-self-verified XP event, or
 *   - settled a verified shop session of an hour or more.
 *
 * That second clause is load-bearing. Plenty of the best people spend Saturday
 * on the mill and never open the dashboard; a system that only sees dashboard
 * activity reads them as inactive, which is both wrong and insulting.
 *
 * Viewing, filtering, commenting, editing a description or moving a due date
 * never counts.
 */
export function computeStreak(
  qualifyingDays: string[],
  today: string,
  opts: { graceUsedByMonth?: Record<string, number> } = {}
): StreakResult {
  const active = [...new Set(qualifyingDays)].sort();
  if (active.length === 0) return { current: 0, longest: 0, activeDays: [], graceDays: [] };

  const activeSet = new Set(active);
  const graceUsed: Record<string, number> = { ...(opts.graceUsedByMonth ?? {}) };
  const graceDays: string[] = [];

  // Walk backwards from today (or yesterday — the streak survives a day that is
  // simply not over yet) and stop at the first gap no grace day can cover.
  let cursor = activeSet.has(today) ? today : addDays(today, -1);
  let current = 0;
  while (true) {
    if (activeSet.has(cursor)) {
      current++;
      cursor = addDays(cursor, -1);
      continue;
    }
    const month = cursor.slice(0, 7);
    const used = graceUsed[month] ?? 0;
    // A grace day BRIDGES — it must have activity on both sides. Walking
    // backwards, the day after the gap is the one just counted, so only the day
    // before needs checking. Without this, returning after a two-month absence
    // scored 2 (the day back, plus a grace day bridging nothing).
    const bridges = activeSet.has(addDays(cursor, -1));
    if (used < GRACE_DAYS_PER_MONTH && bridges) {
      graceUsed[month] = used + 1;
      graceDays.push(cursor);
      current++;
      cursor = addDays(cursor, -1);
      continue;
    }
    break;
  }

  // Longest run over all history, applying the same one-grace-per-month rule.
  let longest = 0;
  let run = 0;
  const longestGrace: Record<string, number> = {};
  let day = active[0];
  const last = active[active.length - 1];
  while (day <= last) {
    if (activeSet.has(day)) {
      run++;
    } else {
      const month = day.slice(0, 7);
      const used = longestGrace[month] ?? 0;
      // Same bridging rule forwards: both neighbours must be active, so a
      // grace day cannot extend a run that had already ended.
      const bridges = activeSet.has(addDays(day, -1)) && activeSet.has(addDays(day, 1));
      if (used < GRACE_DAYS_PER_MONTH && bridges) {
        longestGrace[month] = used + 1;
        run++;
      } else {
        longest = Math.max(longest, run);
        run = 0;
      }
    }
    day = addDays(day, 1);
  }
  longest = Math.max(longest, run, current);

  return { current, longest, activeDays: active, graceDays };
}

/**
 * Ranks, achievements and multiplier windows.
 *
 * Pure module: no database, no React. The numbers are here to be argued with
 * before anything depends on them.
 *
 * THE DESIGN CONSTRAINT THAT SHAPES ALL OF THIS. XP must never become the thing
 * people optimise instead of the car. Everything below is built so that the
 * only way to climb is to do work somebody else signed off on:
 *
 *   - ranks come from APPROVED XP only, so pending points move nothing
 *   - achievements are mostly about VARIETY and FINISHING, not volume, because
 *     a volume target is farmable and a "close out what you started" target is
 *     exactly what a first-year team actually struggles with
 *   - multiplier windows are opened by a lead for a stated reason and are
 *     bounded in length, so a permanent 2x cannot quietly become the baseline
 *   - the daily cap applies AFTER the multiplier, so a double-XP day is a
 *     better day and not an unbounded one
 */

export interface Rank {
  /** Minimum approved lifetime XP to hold this rank. */
  at: number;
  name: string;
  /** What this rank says about the person, in one line, shown in the drawer. */
  means: string;
}

/**
 * Deliberately shop-floor language rather than fantasy tiers.
 *
 * The gaps widen as they go: the first three are reachable in a few good weeks
 * so a new member sees movement, and the last is a full season of signed-off
 * work. Nobody should hit the top in October.
 */
export const RANKS: readonly Rank[] = [
  { at: 0, name: "Rookie", means: "Signed up and getting oriented." },
  { at: 50, name: "Wrench", means: "Has closed real work with a lead's sign-off." },
  { at: 150, name: "Fabricator", means: "Makes things that end up on the car." },
  { at: 350, name: "Subsystem Hand", means: "Trusted across a whole subsystem." },
  { at: 700, name: "Build Lead", means: "Carries work other people depend on." },
  { at: 1200, name: "Veteran", means: "A season of signed-off contribution." },
  { at: 2000, name: "Founder's Mark", means: "Built the thing from nothing. Reserved for the first season's core." }
] as const;

export interface RankStanding {
  rank: Rank;
  next: Rank | null;
  /** XP still needed for the next rank, or 0 at the top. */
  toNext: number;
  /** 0-100 through the current band, for a progress bar. */
  bandPct: number;
}

export function rankFor(approvedXp: number): RankStanding {
  let idx = 0;
  for (let i = 0; i < RANKS.length; i++) if (approvedXp >= RANKS[i].at) idx = i;
  const rank = RANKS[idx];
  const next = idx + 1 < RANKS.length ? RANKS[idx + 1] : null;
  if (!next) return { rank, next: null, toNext: 0, bandPct: 100 };
  const span = next.at - rank.at;
  const into = approvedXp - rank.at;
  return {
    rank,
    next,
    toNext: next.at - approvedXp,
    bandPct: span <= 0 ? 100 : Math.min(100, Math.max(0, Math.round((into / span) * 100)))
  };
}

/* -------------------------------------------------------------------------
 * Achievements
 * ---------------------------------------------------------------------- */

/** Everything an achievement can be measured against. */
export interface AchievementFacts {
  /** Approved XP, lifetime. */
  approvedXp: number;
  /** Distinct XP event kinds this person has been awarded. */
  kinds: Set<string>;
  /** Count per kind, approved only. */
  countByKind: Record<string, number>;
  /** Distinct subsystems they have earned XP in. */
  subsystemsTouched: number;
  /** Longest run of engineering days. */
  longestStreak: number;
  /** Awards reversed because work was reopened or undone. */
  reversedCount: number;
  /** Awards paid at the self-verified rate. */
  selfVerifiedCount: number;
  /** Gates this person ENDORSED that went on to be approved. */
  gatesEndorsedAndApproved: number;
  /** Interfaces they agreed where the other side also agreed. */
  interfacesAgreedBothSides: number;
  /** Shop hours recorded, settled sessions only. */
  shopHours: number;
}

export interface Achievement {
  id: string;
  name: string;
  /** What you did to get it. Shown whether or not it is earned. */
  how: string;
  /** Why it is worth having. Kept honest — no inflated praise. */
  why: string;
  /** True when earned. */
  test: (f: AchievementFacts) => boolean;
  /** Progress toward it, 0-100, for the ones that are countable. */
  progress?: (f: AchievementFacts) => number;
  /** Hidden until earned. Used sparingly — two of them. */
  secret?: boolean;
}

const pct = (have: number, need: number) => Math.min(100, Math.round((have / need) * 100));

export const ACHIEVEMENTS: readonly Achievement[] = [
  {
    id: "first-blood",
    name: "First Sign-Off",
    how: "Earn your first approved XP.",
    why: "Somebody else looked at what you did and agreed it was done.",
    test: (f) => f.approvedXp > 0
  },
  {
    id: "generalist",
    name: "Generalist",
    how: "Earn XP in four different subsystems.",
    why: "A first-year team cannot afford specialists who cannot cover for each other.",
    test: (f) => f.subsystemsTouched >= 4,
    progress: (f) => pct(f.subsystemsTouched, 4)
  },
  {
    id: "closer",
    name: "Closer",
    how: "Close ten tasks with evidence attached.",
    why: "Starting things is easy. This is the one that correlates with a car existing.",
    test: (f) => (f.countByKind["task.closedWithEvidence"] ?? 0) >= 10,
    progress: (f) => pct(f.countByKind["task.closedWithEvidence"] ?? 0, 10)
  },
  {
    id: "freezer",
    name: "Design Freezer",
    how: "Have five part designs frozen.",
    why: "A frozen design is what makes ordering and manufacturing safe to start.",
    test: (f) => (f.countByKind["part.designFrozen"] ?? 0) >= 5,
    progress: (f) => pct(f.countByKind["part.designFrozen"] ?? 0, 5)
  },
  {
    id: "diplomat",
    name: "Diplomat",
    how: "Agree three interfaces where the other subsystem's lead agreed too.",
    why:
      "Interfaces are where the car fails to go together, because nobody owns them alone. " +
      "Three agreed is three places that will not surprise anyone at assembly.",
    test: (f) => f.interfacesAgreedBothSides >= 3,
    progress: (f) => pct(f.interfacesAgreedBothSides, 3)
  },
  {
    id: "rule-lawyer",
    name: "Rule Lawyer",
    how: "Attach fifteen rule citations to parts.",
    why: "Tech Inspection and the design judges both ask. Having the answer written down already is the difference between a good day and a bad one.",
    test: (f) => (f.countByKind["part.ruleCited"] ?? 0) >= 15,
    progress: (f) => pct(f.countByKind["part.ruleCited"] ?? 0, 15)
  },
  {
    id: "regular",
    name: "Regular",
    how: "Reach a fourteen-day engineering-day streak.",
    why: "Two weeks of showing up. Builds are won by the people who keep turning up, not the ones who sprint.",
    test: (f) => f.longestStreak >= 14,
    progress: (f) => pct(f.longestStreak, 14)
  },
  {
    id: "shop-rat",
    name: "Shop Rat",
    how: "Record forty hours of shop time.",
    why: "Hours in the shop, not points. The clock does not care how you felt about it.",
    test: (f) => f.shopHours >= 40,
    progress: (f) => pct(f.shopHours, 40)
  },
  {
    id: "vouched-for",
    name: "Vouched For",
    how: "Endorse five gates that the Chief Engineer then approved.",
    why:
      "You put your name to work being finished and somebody senior agreed every time. " +
      "This is the one that says a lead's judgement is trusted.",
    test: (f) => f.gatesEndorsedAndApproved >= 5,
    progress: (f) => pct(f.gatesEndorsedAndApproved, 5)
  },
  {
    id: "clean-record",
    name: "Nothing Undone",
    how: "Reach 300 XP with no award ever reversed.",
    why:
      "Nothing you closed was later reopened. Harder than it sounds, and worth more than closing " +
      "twice as much twice as fast.",
    test: (f) => f.approvedXp >= 300 && f.reversedCount === 0,
    progress: (f) => (f.reversedCount > 0 ? 0 : pct(f.approvedXp, 300))
  },
  {
    id: "honest-broker",
    name: "Honest Broker",
    how: "Earn 200 XP with fewer than a tenth of your awards self-verified.",
    why:
      "Most of what you closed was checked by somebody else. The system pays less for " +
      "self-verified work precisely because this is the harder and more useful habit.",
    test: (f) => {
      const total = Object.values(f.countByKind).reduce((s, n) => s + n, 0);
      return f.approvedXp >= 200 && total > 0 && f.selfVerifiedCount / total < 0.1;
    },
    secret: true
  },
  {
    id: "the-long-haul",
    name: "The Long Haul",
    how: "Hold a sixty-day engineering-day streak.",
    why: "Two months. At that point it is not motivation any more, it is just who you are.",
    test: (f) => f.longestStreak >= 60,
    secret: true
  }
] as const;

export interface AchievementStatus extends Omit<Achievement, "test" | "progress"> {
  earned: boolean;
  progressPct: number | null;
}

/**
 * Resolve every achievement. Secret ones are omitted entirely until earned —
 * a locked box labelled "???" is just an itch, and the honest version is not to
 * mention it at all.
 */
export function achievementsFor(f: AchievementFacts): AchievementStatus[] {
  const out: AchievementStatus[] = [];
  for (const a of ACHIEVEMENTS) {
    const earned = a.test(f);
    if (a.secret && !earned) continue;
    out.push({
      id: a.id,
      name: a.name,
      how: a.how,
      why: a.why,
      secret: a.secret,
      earned,
      progressPct: earned ? 100 : a.progress ? a.progress(f) : null
    });
  }
  // Earned first, then whatever is closest to being earned.
  return out.sort(
    (x, y) => Number(y.earned) - Number(x.earned) || (y.progressPct ?? -1) - (x.progressPct ?? -1)
  );
}

/* -------------------------------------------------------------------------
 * Multiplier windows — "double XP during shop days"
 * ---------------------------------------------------------------------- */

/**
 * The guard rails, and why each one exists.
 *
 * MAX_MULTIPLIER is 2. A 3x window makes the week it falls in worth more than
 * the three around it, and then the honest answer to "how do I help the team"
 * becomes "wait for Saturday".
 *
 * MAX_WINDOW_HOURS is 14 — a long shop day, not a long weekend. An open-ended
 * window becomes the baseline, and then the baseline has silently doubled.
 *
 * The daily cap is applied AFTER the multiplier, deliberately. A double-XP day
 * is a better day, not an unbounded one; without this, a multiplier window is
 * the one way to escape the cap, and the cap is the thing standing between this
 * feature and somebody farming it.
 */
export const MAX_MULTIPLIER = 2;
export const MAX_WINDOW_HOURS = 14;

export interface MultiplierWindow {
  id: string;
  label: string;
  /** 1.5 or 2. Stored as a number so a future 1.25 needs no migration. */
  multiplier: number;
  startsAt: string;
  endsAt: string;
  /** Who opened it. A window with no name attached is not accountable. */
  createdBy: string;
}

export interface WindowProblem {
  reason: string;
}

/**
 * Validate a window before it is stored. Returns the refusal, or null.
 *
 * `existing` is every other window, so overlaps can be refused: two 2x windows
 * covering the same hour would otherwise stack to 4x, which nobody intended and
 * which would only be noticed in the ledger afterwards.
 */
export function windowProblem(
  w: { multiplier: number; startsAt: string; endsAt: string; label: string },
  existing: Array<{ startsAt: string; endsAt: string }>
): WindowProblem | null {
  if (!w.label || w.label.trim().length < 3) {
    return { reason: "Give the window a name people will recognise, like “Saturday build day”." };
  }
  if (!Number.isFinite(w.multiplier) || w.multiplier <= 1) {
    return { reason: "A multiplier below 1 would penalise showing up. Use 1.5 or 2." };
  }
  if (w.multiplier > MAX_MULTIPLIER) {
    return {
      reason:
        `${MAX_MULTIPLIER}x is the ceiling. Above that, the week a window falls in is worth more ` +
        `than the three around it, and waiting becomes the smart play.`
    };
  }
  const start = Date.parse(w.startsAt);
  const end = Date.parse(w.endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return { reason: "Start and end must both be real times." };
  }
  if (end <= start) return { reason: "The window ends before it starts." };

  const hours = (end - start) / 3_600_000;
  if (hours > MAX_WINDOW_HOURS) {
    return {
      reason:
        `${MAX_WINDOW_HOURS} hours is the longest window. A long shop day qualifies; a long weekend ` +
        `does not, because an open-ended window quietly becomes the new baseline.`
    };
  }

  for (const e of existing) {
    const es = Date.parse(e.startsAt);
    const ee = Date.parse(e.endsAt);
    if (start < ee && es < end) {
      return {
        reason:
          "That overlaps an existing window. Two windows covering the same hour would multiply " +
          "together, which is never what anyone means."
      };
    }
  }
  return null;
}

/** The multiplier in force at a given instant. 1 when no window applies. */
export function multiplierAt(at: string, windows: MultiplierWindow[]): { multiplier: number; window: MultiplierWindow | null } {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return { multiplier: 1, window: null };
  // Highest wins rather than stacking, as a belt-and-braces against an overlap
  // that got into the database before windowProblem existed.
  let best: MultiplierWindow | null = null;
  for (const w of windows) {
    const s = Date.parse(w.startsAt);
    const e = Date.parse(w.endsAt);
    if (t >= s && t < e && (!best || w.multiplier > best.multiplier)) best = w;
  }
  return { multiplier: best ? best.multiplier : 1, window: best };
}

/**
 * Apply a multiplier to a base award.
 *
 * Rounded DOWN. A 1.5x on a 5-point event pays 7, not 8 — rounding a bonus up
 * means the cheapest events benefit most from the window, which is backwards.
 */
export function applyMultiplier(basePoints: number, multiplier: number): number {
  if (multiplier <= 1) return basePoints;
  return Math.floor(basePoints * multiplier);
}

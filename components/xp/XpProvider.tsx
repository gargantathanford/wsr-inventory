"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Confetti, burstConfetti } from "./Confetti";

export interface LedgerEntry {
  id: string;
  kind: string;
  label: string;
  points: number;
  at: string;
  status: "PENDING" | "AWARDED" | "REVERSED" | "VOID";
  selfVerified: boolean;
  reverses: string | null;
  sourceType: string;
  sourceId: string;
  note: string | null;
}

export interface RankStanding {
  rank: { at: number; name: string; means: string };
  next: { at: number; name: string; means: string } | null;
  toNext: number;
  bandPct: number;
}

export interface AchievementStatus {
  id: string;
  name: string;
  how: string;
  why: string;
  earned: boolean;
  progressPct: number | null;
  secret?: boolean;
}

export interface MultiplierWindow {
  id: string;
  label: string;
  multiplier: number;
  startsAt: string;
  endsAt: string;
}

export interface XpState {
  rank: RankStanding | null;
  achievements: AchievementStatus[];
  windows: MultiplierWindow[];
  total: number;
  pending: number;
  selfVerifiedCount: number;
  reversedCount: number;
  streak: { current: number; longest: number; graceDays: string[] };
  ledger: LedgerEntry[];
  ledgerTruncated: boolean;
  loading: boolean;
  /** Re-read the ledger. Call after an action that should have earned something. */
  refresh: () => Promise<void>;
}

const XpContext = createContext<XpState | null>(null);

export function useXp(): XpState {
  const ctx = useContext(XpContext);
  if (!ctx) throw new Error("useXp must be used inside <XpProvider>");
  return ctx;
}

const EMPTY: Omit<XpState, "refresh"> = {
  rank: null,
  achievements: [],
  windows: [],
  total: 0,
  pending: 0,
  selfVerifiedCount: 0,
  reversedCount: 0,
  streak: { current: 0, longest: 0, graceDays: [] },
  ledger: [],
  ledgerTruncated: false,
  loading: true
};

/**
 * Holds the person's own XP and notices when it changes.
 *
 * Polls rather than pushing, matching the rest of the app — presence and
 * messaging already poll, and adding a socket for a progress number would be
 * the wrong trade. 60 seconds is deliberately slow: XP is not time-critical,
 * and `refresh()` is called directly after an action that should have earned
 * something, so the poll only exists to catch awards granted elsewhere (a lead
 * approving a pending award, for instance).
 *
 * When the total rises, a toast appears. When it rises by a substantial award,
 * confetti fires too — see shouldCelebrate.
 */
export function XpProvider({ children, enabled = true }: { children: React.ReactNode; enabled?: boolean }) {
  const [state, setState] = useState(EMPTY);
  const [toast, setToast] = useState<{ points: number; label: string } | null>(null);
  const previousTotal = useRef<number | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/xp");
      if (!res.ok) {
        setState((s) => ({ ...s, loading: false }));
        return;
      }
      const data = await res.json();
      const next = {
        rank: data.rank ?? null,
        achievements: (data.achievements ?? []) as AchievementStatus[],
        windows: (data.windows ?? []) as MultiplierWindow[],
        total: data.total ?? 0,
        pending: data.pending ?? 0,
        selfVerifiedCount: data.selfVerifiedCount ?? 0,
        reversedCount: data.reversedCount ?? 0,
        streak: data.streak ?? EMPTY.streak,
        ledger: (data.ledger ?? []) as LedgerEntry[],
        ledgerTruncated: !!data.ledgerTruncated,
        loading: false
      };

      // First load establishes the baseline — otherwise signing in would fire
      // confetti for everything earned since the last visit.
      const before = previousTotal.current;
      previousTotal.current = next.total;

      if (before !== null && next.total > before) {
        const gained = next.total - before;
        const newest = next.ledger.find((e) => e.status === "AWARDED" && !e.reverses);
        setToast({ points: gained, label: newest?.label ?? "XP earned" });
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(null), 5000);
        // Substantial awards get the burst; a 5-point auto event does not, or
        // it becomes wallpaper and stops meaning anything.
        if (gained >= 20) burstConfetti();
      }

      setState(next);
    } catch {
      setState((s) => ({ ...s, loading: false }));
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setState((s) => ({ ...s, loading: false }));
      return;
    }
    load();
    const id = setInterval(load, 60_000);
    return () => {
      clearInterval(id);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [enabled, load]);

  const value = useMemo<XpState>(() => ({ ...state, refresh: load }), [state, load]);

  return (
    <XpContext.Provider value={value}>
      {children}
      <Confetti />
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] flex items-center gap-3
                     rounded border border-volt/40 bg-graphite-900/95 px-4 py-2.5 shadow-lg backdrop-blur"
        >
          <span className="font-mono text-sm font-semibold text-volt">+{toast.points} XP</span>
          <span className="text-xs text-graphite-300 max-w-xs truncate">{toast.label}</span>
        </div>
      )}
    </XpContext.Provider>
  );
}

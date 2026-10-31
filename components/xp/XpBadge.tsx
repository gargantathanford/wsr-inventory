"use client";

import { useState } from "react";
import { useXp, type LedgerEntry, type AchievementStatus } from "./XpProvider";
import { Portal } from "@/components/Portal";
import { formatDay, formatTime, weekday } from "@/lib/datetime";

/**
 * The XP surface in the nav. Deliberately small.
 *
 * XP is NEVER the headline number on any screen — schedule risk, open blockers
 * and long-lead exposure are. This is a quiet volt-coloured figure that opens
 * the person's own ledger, and volt is used for nothing else in the app, so
 * earned progress is visually distinct from status and from alerts.
 */
export function XpBadge() {
  const { total, pending, streak, loading } = useXp();
  const [open, setOpen] = useState(false);

  if (loading) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2.5 rounded px-2 py-1 hover:bg-graphite-800/60 transition-colors"
        title="Your XP and Engineering Days — click for the full history"
      >
        <span className="font-mono text-sm font-semibold" style={{ color: "#C7FF3D" }}>
          {total}
        </span>
        {pending > 0 && (
          <span className="font-mono text-[10px] text-graphite-500" title={`${pending} XP awaiting a lead's approval`}>
            +{pending}?
          </span>
        )}
        {streak.current > 0 && (
          <span className="font-mono text-[11px] text-graphite-400" title="Engineering Days — consecutive days of real work">
            {streak.current}d
          </span>
        )}
      </button>
      {open && <LedgerDrawer onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * The person's own event history, reversals and self-verified flags included.
 *
 * This is the component that makes the whole feature credible. A score nobody
 * can audit is a score nobody believes — and if someone's points go missing
 * because a task was reopened, they need to see that rather than quietly
 * conclude the system is broken or rigged.
 */
function LedgerDrawer({ onClose }: { onClose: () => void }) {
  const {
    total, pending, streak, ledger, ledgerTruncated, selfVerifiedCount, reversedCount,
    rank, achievements, windows
  } = useXp();
  const [full, setFull] = useState<LedgerEntry[] | null>(null);
  const [tab, setTab] = useState<"history" | "achievements">("history");

  async function loadFull() {
    const res = await fetch("/api/xp?ledger=1");
    if (!res.ok) return;
    const data = await res.json();
    setFull(data.ledger as LedgerEntry[]);
  }

  const rows = full ?? ledger;
  const reversedSet = new Set(rows.filter((r) => r.reverses).map((r) => r.reverses!));

  // Portal, not a bare `fixed`: TopBar has backdrop-blur, which makes the
  // header the containing block for fixed descendants and clipped this entire
  // drawer to a 56px strip. See components/Portal.tsx.
  return (
    <Portal>
    <div className="fixed inset-0 z-[80] flex justify-end" role="dialog" aria-label="Your XP history">
      <button type="button" className="absolute inset-0 bg-black/60" onClick={onClose} aria-label="Close" />
      <div className="relative w-full max-w-md h-full overflow-auto border-l border-graphite-700 bg-graphite-950 p-5 space-y-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="data-label">YOUR PROGRESS</div>
            <div className="mt-1 flex items-baseline gap-3">
              <span className="font-mono text-3xl font-semibold" style={{ color: "#C7FF3D" }}>
                {total}
              </span>
              <span className="text-xs text-graphite-500">XP</span>
            </div>
            {rank && (
              <div className="mt-1.5">
                <div className="text-sm text-graphite-100">{rank.rank.name}</div>
                <div className="text-[11px] text-graphite-500 leading-relaxed max-w-[16rem]">
                  {rank.rank.means}
                </div>
              </div>
            )}
          </div>
          <button type="button" onClick={onClose} className="text-graphite-500 hover:text-graphite-200 text-sm">
            close
          </button>
        </div>

        {rank?.next && (
          <div>
            <div className="h-1 rounded-full bg-graphite-850 overflow-hidden">
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{ width: `${rank.bandPct}%`, backgroundColor: "#C7FF3D" }}
              />
            </div>
            <div className="font-mono text-[10px] text-graphite-500 mt-1">
              {rank.toNext} XP TO {rank.next.name.toUpperCase()}
            </div>
          </div>
        )}

        {/* A window nobody knows about is not an incentive, it is a surprise in
            the ledger. Shown whenever one is open or coming. */}
        {windows.length > 0 && <WindowNotice windows={windows} />}

        <div className="grid grid-cols-3 gap-3 text-center">
          <Stat label="STREAK" value={`${streak.current}d`} hint="Engineering Days" />
          <Stat label="LONGEST" value={`${streak.longest}d`} />
          <Stat label="PENDING" value={String(pending)} hint="awaiting approval" />
        </div>

        {(selfVerifiedCount > 0 || reversedCount > 0) && (
          <p className="text-[11px] leading-relaxed text-graphite-500 border-l-2 border-graphite-700 pl-3">
            {selfVerifiedCount > 0 && (
              <>
                {selfVerifiedCount} award{selfVerifiedCount === 1 ? "" : "s"} paid at 40% because you raised and closed
                the item yourself.{" "}
              </>
            )}
            {reversedCount > 0 && (
              <>
                {reversedCount} award{reversedCount === 1 ? "" : "s"} reversed — the work was reopened or undone.
              </>
            )}
          </p>
        )}

        {streak.graceDays.length > 0 && (
          <p className="text-[11px] text-graphite-500">
            Grace day used: {streak.graceDays.join(", ")}. One per month keeps a single missed day from breaking the
            run.
          </p>
        )}

        <div className="flex gap-1 border-b border-graphite-800">
          {(["history", "achievements"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`font-mono text-[10px] px-3 py-2 -mb-px border-b-2 ${
                tab === t ? "border-volt text-graphite-100" : "border-transparent text-graphite-500"
              }`}
            >
              {t === "history" ? "HISTORY" : `ACHIEVEMENTS · ${achievements.filter((a) => a.earned).length}`}
            </button>
          ))}
        </div>

        {tab === "achievements" ? (
          <AchievementList achievements={achievements} />
        ) : (
        <div>
          {rows.length === 0 ? (
            <p className="text-xs text-graphite-500">
              Nothing yet. XP comes from finishing real things — reconciling an order, closing a task with evidence,
              freezing a design.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {rows
                .filter((e) => !e.reverses)
                .map((e) => {
                  const wasReversed = reversedSet.has(e.id);
                  return (
                    <li
                      key={e.id}
                      className={`flex items-start gap-3 rounded border px-3 py-2 ${
                        wasReversed ? "border-graphite-800 opacity-50" : "border-graphite-800"
                      }`}
                    >
                      <span
                        className="font-mono text-xs shrink-0 pt-0.5"
                        style={{ color: wasReversed ? "#6B7280" : e.status === "PENDING" ? "#FFB020" : "#C7FF3D" }}
                      >
                        {wasReversed ? "—" : `+${e.points}`}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-xs text-graphite-200">{e.label}</span>
                        <span className="block font-mono text-[10px] text-graphite-500 mt-0.5">
                          {formatDay(e.at)} · {e.sourceId}
                          {e.status === "PENDING" && " · awaiting approval"}
                          {e.selfVerified && " · self-verified"}
                          {wasReversed && " · reversed"}
                        </span>
                        {e.note && <span className="block text-[10px] text-graphite-600 mt-0.5">{e.note}</span>}
                      </span>
                    </li>
                  );
                })}
            </ul>
          )}
          {ledgerTruncated && !full && (
            <button type="button" onClick={loadFull} className="btn-ghost text-xs mt-3 w-full">
              Show everything
            </button>
          )}
        </div>
        )}
      </div>
    </div>
    </Portal>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded border border-graphite-800 px-2 py-2">
      <div className="data-label text-[9px]">{label}</div>
      <div className="font-mono text-lg text-graphite-100 mt-0.5">{value}</div>
      {hint && <div className="text-[9px] text-graphite-600">{hint}</div>}
    </div>
  );
}

/**
 * An open or upcoming multiplier window.
 *
 * Announced rather than left to be discovered: a window nobody knows about is
 * not an incentive, it is an unexplained number in somebody's ledger.
 */
/**
 * "Fri 11:25 PM – 7:25 AM" is ambiguous when a window crosses midnight, so the
 * weekday is repeated on the end when it lands on a different day.
 */
function formatSpan(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const time = (d: Date) => formatTime(d.toISOString());
  const day = (d: Date) => weekday(d.toISOString());
  const sameDay = start.toDateString() === end.toDateString();
  return sameDay
    ? `${day(start)} ${time(start)} – ${time(end)}`
    : `${day(start)} ${time(start)} – ${day(end)} ${time(end)}`;
}

function WindowNotice({ windows }: { windows: Array<{ id: string; label: string; multiplier: number; startsAt: string; endsAt: string }> }) {
  const now = Date.now();
  const live = windows.find((w) => Date.parse(w.startsAt) <= now && now < Date.parse(w.endsAt));
  const next = windows.find((w) => Date.parse(w.startsAt) > now);
  const w = live ?? next;
  if (!w) return null;

  return (
    <div
      className={`rounded border px-3 py-2 ${
        live ? "border-volt/50 bg-volt/[0.06]" : "border-graphite-800"
      }`}
    >
      <div className="font-mono text-[10px]" style={{ color: live ? "#C7FF3D" : undefined }}>
        {live ? `${w.multiplier}x LIVE NOW` : `${w.multiplier}x COMING`}
      </div>
      <div className="text-xs text-graphite-200 mt-0.5">{w.label}</div>
      <div className="font-mono text-[10px] text-graphite-500 mt-0.5">
        {formatSpan(w.startsAt, w.endsAt)}
      </div>
      {live && (
        <div className="text-[10px] text-graphite-500 mt-1 leading-relaxed">
          The daily cap still applies — a doubled day is a better day, not an unlimited one.
        </div>
      )}
    </div>
  );
}

/**
 * Achievements, earned first.
 *
 * Every one shows HOW and WHY, earned or not, because an achievement whose
 * condition is a mystery is a slot machine rather than a goal. Nothing here
 * rewards raw volume — the set is built around variety and finishing, which
 * are the habits a first-year team actually lacks.
 */
function AchievementList({ achievements }: { achievements: AchievementStatus[] }) {
  if (achievements.length === 0) {
    return (
      <p className="text-xs text-graphite-500 leading-relaxed">
        Nothing yet. These come from finishing things and from working across more than one
        subsystem — not from piling up points.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {achievements.map((a) => (
        <li
          key={a.id}
          className={`rounded border px-3 py-2.5 ${
            a.earned ? "border-volt/40" : "border-graphite-800"
          }`}
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className={`text-xs ${a.earned ? "text-graphite-100" : "text-graphite-300"}`}>
              {a.name}
            </span>
            {a.earned ? (
              <span className="font-mono text-[10px]" style={{ color: "#C7FF3D" }}>
                EARNED
              </span>
            ) : a.progressPct !== null ? (
              <span className="font-mono text-[10px] text-graphite-500">{a.progressPct}%</span>
            ) : null}
          </div>

          <p className="text-[11px] text-graphite-500 mt-1 leading-relaxed">{a.how}</p>

          {!a.earned && a.progressPct !== null && (
            <div className="h-0.5 rounded-full bg-graphite-850 overflow-hidden mt-1.5">
              <div
                className="h-full rounded-full"
                style={{ width: `${a.progressPct}%`, backgroundColor: "#4B5563" }}
              />
            </div>
          )}

          {a.earned && <p className="text-[11px] text-graphite-400 mt-1.5 leading-relaxed">{a.why}</p>}
        </li>
      ))}
    </ul>
  );
}

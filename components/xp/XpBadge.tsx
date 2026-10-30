"use client";

import { useState } from "react";
import { useXp, type LedgerEntry } from "./XpProvider";
import { Portal } from "@/components/Portal";

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
  const { total, pending, streak, ledger, ledgerTruncated, selfVerifiedCount, reversedCount } = useXp();
  const [full, setFull] = useState<LedgerEntry[] | null>(null);

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
          </div>
          <button type="button" onClick={onClose} className="text-graphite-500 hover:text-graphite-200 text-sm">
            close
          </button>
        </div>

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

        <div>
          <div className="data-label mb-2">HISTORY</div>
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
                          {new Date(e.at).toLocaleDateString()} · {e.sourceId}
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

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface OpenSession {
  id: string;
  openedAt: string;
}

const elapsed = (since: string): string => {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
};

/**
 * Shop check-in control for the nav.
 *
 * Shows elapsed time while a session is open so it is obvious the clock is
 * running — the most common failure is forgetting to check out, and a visible
 * counter is the cheapest fix for that.
 *
 * No geofence, no door code, no permission prompts. Hours are self-reported in
 * v1 and award no XP; the point is to learn whether they are honest before
 * building anything to verify them.
 */
export function CheckInControl() {
  const router = useRouter();
  const [open, setOpen] = useState<OpenSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [, forceTick] = useState(0);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/shop/sessions");
      if (!res.ok) return setLoading(false);
      const data = await res.json();
      setOpen(data.open ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Slow poll: catches the server-side sweep voiding a session left open
    // overnight, so the control does not keep counting a session that is gone.
    const id = setInterval(load, 120_000);
    return () => clearInterval(id);
  }, [load]);

  // Re-render once a minute to advance the elapsed figure. No data fetched.
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => forceTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, [open]);

  async function toggle() {
    setBusy(true);
    try {
      const res = await fetch("/api/shop/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: open ? "close" : "open" })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (open) {
          const h = Math.floor((data.minutes ?? 0) / 60);
          const m = (data.minutes ?? 0) % 60;
          setFlash(
            data.state === "void"
              ? "Session voided — it was left open overnight."
              : `Checked out — ${h > 0 ? `${h}h ${m}m` : `${m}m`} recorded.`
          );
        }
        await load();
        router.refresh();
      } else {
        setFlash(typeof data.error === "string" ? data.error : "That did not work.");
      }
    } finally {
      setBusy(false);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(null), 6000);
    }
  }

  if (loading) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        className={`flex items-center gap-2 rounded px-2.5 py-1 text-xs transition-colors ${
          open
            ? "border border-telemetry-green/40 bg-telemetry-green/10 text-telemetry-green hover:bg-telemetry-green/20"
            : "border border-graphite-700 text-graphite-400 hover:text-graphite-200 hover:border-graphite-600"
        }`}
        title={open ? "You are checked in to the shop — click to check out" : "Check in to the shop"}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${open ? "bg-telemetry-green" : "bg-graphite-600"}`}
          aria-hidden="true"
        />
        <span className="hidden sm:inline">{open ? "In shop" : "Check in"}</span>
        {open && <span className="font-mono">{elapsed(open.openedAt)}</span>}
      </button>

      {flash && (
        <div
          role="status"
          aria-live="polite"
          className="absolute right-0 top-full mt-2 w-60 rounded border border-graphite-700 bg-graphite-950 px-3 py-2 text-[11px] leading-snug text-graphite-300 shadow-lg z-50"
        >
          {flash}
        </div>
      )}
    </div>
  );
}

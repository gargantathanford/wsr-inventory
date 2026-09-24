"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const TYPES = ["DEADLINE", "MEETING", "MILESTONE", "REVIEW", "COMPETITION", "MANUFACTURING", "TESTING", "ADMINISTRATIVE"];
const SCOPES = [
  ["TEAM", "Responsible team"],
  ["EVERYONE", "Everyone"],
  ["ASSIGNED_USER", "Assigned user only"],
  ["TEAM_LEADS", "Team Leads"],
  ["ADMINS", "Admins"]
];
const INTERVAL_OPTIONS = [30, 14, 7, 3, 1];

export function NewCalendarEventForm({ subsystems }: { subsystems: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intervals, setIntervals] = useState<number[]>([7, 1]);
  const [actionable, setActionable] = useState(true);

  function toggleInterval(n: number) {
    setIntervals((prev) => (prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n].sort((a, b) => b - a)));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const payload: Record<string, any> = Object.fromEntries(fd.entries());
    payload.reminder_intervals = intervals;
    payload.is_actionable = actionable;

    const res = await fetch("/api/calendar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "Could not create event.");
      return;
    }
    (e.target as HTMLFormElement).reset();
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button className="btn-primary" onClick={() => setOpen(true)}>
        + New event
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="panel p-5 space-y-4">
      {error && <div className="text-sm text-telemetry-red font-mono">{error}</div>}
      <div className="grid sm:grid-cols-2 gap-3">
        <input className="input" name="title" placeholder="Event title" required />
        <select className="input" name="event_type" defaultValue="DEADLINE">
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <textarea className="input min-h-16" name="description" placeholder="Description (optional)" />
      <div className="grid sm:grid-cols-3 gap-3">
        <select className="input" name="subsystem_id" defaultValue="">
          <option value="">All Teams</option>
          {subsystems.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <input className="input" type="date" name="deadline_date" required />
        <input className="input" type="time" name="deadline_time" />
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <select className="input" name="priority" defaultValue="MEDIUM">
          {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select className="input" name="notify_scope" defaultValue="TEAM">
          {SCOPES.map(([v, l]) => (
            <option key={v} value={v}>
              Notify: {l}
            </option>
          ))}
        </select>
      </div>
      <input className="input" name="links" placeholder="Relevant links (optional)" />

      <div>
        <span className="data-label block mb-1.5">Remind (days before)</span>
        <div className="flex gap-2">
          {INTERVAL_OPTIONS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => toggleInterval(n)}
              className={`text-xs font-mono px-2 py-1 rounded-sm border ${
                intervals.includes(n) ? "border-signal text-signal bg-signal/10" : "border-graphite-700 text-graphite-500"
              }`}
            >
              {n}d
            </button>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs text-graphite-400 font-mono">
        <input type="checkbox" checked={actionable} onChange={(e) => setActionable(e.target.checked)} />
        Actionable deadline (requires completion documentation) — uncheck for purely informational events
      </label>

      <div className="flex gap-2">
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? "Creating…" : "Create event"}
        </button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

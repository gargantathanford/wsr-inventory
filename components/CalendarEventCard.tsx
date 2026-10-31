"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge, ImportanceBadge } from "@/components/StatusBadge";

const EVENT_ICON: Record<string, string> = {
  DEADLINE: "⏱",
  MEETING: "👥",
  MILESTONE: "🚩",
  REVIEW: "🔍",
  COMPETITION: "🏁",
  MANUFACTURING: "🔧",
  TESTING: "📊",
  ADMINISTRATIVE: "📋"
};

export function CalendarEventCard({
  event,
  currentUserId,
  canReview,
  canAct,
  canStart = false,
  attachments
}: {
  event: any;
  currentUserId: string;
  canReview: boolean;
  canAct: boolean;
  /** Starting an event is the responsible lead's call, not any member's. */
  canStart?: boolean;
  attachments: any[];
}) {
  const router = useRouter();
  const [showCompletion, setShowCompletion] = useState(false);
  const [returning, setReturning] = useState(false);
  const [reason, setReason] = useState("");
  const [summary, setSummary] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const daysRemaining = Math.round(
    (new Date(event.deadline_date + "T00:00:00").getTime() - new Date(new Date().toDateString()).getTime()) / 86400000
  );
  const overdue = daysRemaining < 0 && event.status !== "COMPLETED";

  async function start() {
    setLoading(true);
    await fetch(`/api/calendar/${event.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "IN_PROGRESS" })
    });
    setLoading(false);
    router.refresh();
  }

  async function submitCompletion(e: React.FormEvent) {
    e.preventDefault();
    if (summary.trim().length < 20) {
      setError("Write a real summary — at least 20 characters describing what was accomplished.");
      return;
    }
    setLoading(true);
    setError(null);
    const fd = new FormData();
    fd.set("completion_summary", summary.trim());
    if (files) Array.from(files).forEach((f) => fd.append("files", f));
    const res = await fetch(`/api/calendar/${event.id}/submit`, { method: "POST", body: fd });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not submit.");
      return;
    }
    setShowCompletion(false);
    router.refresh();
  }

  async function review(action: "approve" | "return") {
    if (action === "return" && !reason.trim()) {
      setError("Explain what needs additional work.");
      return;
    }
    setLoading(true);
    await fetch(`/api/calendar/${event.id}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, return_reason: reason.trim() || undefined })
    });
    setLoading(false);
    router.refresh();
  }

  return (
    <div className={`panel p-4 space-y-3 ${overdue ? "border-telemetry-red/50" : ""}`}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span>{EVENT_ICON[event.event_type] || "📌"}</span>
            <span className="text-sm text-graphite-100 font-medium">{event.title}</span>
            <ImportanceBadge importance={event.priority} />
            {overdue && <span className="pill border-telemetry-red/50 text-telemetry-red bg-telemetry-red/10">OVERDUE</span>}
          </div>
          {event.description && <p className="text-xs text-graphite-500 mt-1 max-w-lg">{event.description}</p>}
          <div className="font-mono text-[11px] text-graphite-500 mt-1.5">
            {event.deadline_date}
            {event.deadline_time ? ` ${event.deadline_time}` : ""}
            {event.subsystem_name ? ` · ${event.subsystem_name}` : " · All Teams"}
            {event.responsible_user_name ? ` · ${event.responsible_user_name}` : ""}
            {!overdue && event.status !== "COMPLETED" ? ` · ${daysRemaining >= 0 ? `${daysRemaining}d away` : ""}` : ""}
          </div>
        </div>
        {event.is_actionable ? <StatusBadge status={event.status} /> : <span className="pill border-graphite-600 text-graphite-400 bg-graphite-800">Informational</span>}
      </div>

      {error && <div className="text-xs text-telemetry-red font-mono">{error}</div>}

      {event.status === "IN_PROGRESS" && event.return_reason && (
        <div className="text-xs text-telemetry-amber border border-telemetry-amber/40 bg-telemetry-amber/10 rounded-sm px-3 py-2">
          Returned: {event.return_reason}
        </div>
      )}

      {(event.status === "SUBMITTED_FOR_REVIEW" || event.status === "COMPLETED") && event.completion_summary && (
        <div className="rounded-sm border border-graphite-700 bg-graphite-850/60 p-3 space-y-2">
          <p className="text-sm text-graphite-300 whitespace-pre-line">{event.completion_summary}</p>
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {attachments.map((a: any) => (
                <a key={a.id} href={a.source === "UPLOAD" ? `/api/files/${a.id}` : a.url} target="_blank" rel="noreferrer" className="pill border-telemetry-blue/50 text-telemetry-blue bg-telemetry-blue/10">
                  {a.title}
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {event.status === "SUBMITTED_FOR_REVIEW" && canReview && !returning && (
        <div className="flex gap-2">
          <button className="btn-primary text-xs py-1.5" disabled={loading} onClick={() => review("approve")}>
            Approve completion
          </button>
          <button className="btn-ghost text-xs py-1.5" onClick={() => setReturning(true)}>
            Return for more work
          </button>
        </div>
      )}
      {returning && (
        <div className="space-y-2">
          <textarea className="input min-h-16 text-xs" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What needs additional work?" />
          <div className="flex gap-2">
            <button className="btn-ghost text-xs border-telemetry-amber/50 text-telemetry-amber" onClick={() => review("return")}>
              Confirm return
            </button>
            <button className="btn-ghost text-xs" onClick={() => setReturning(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {canStart && event.is_actionable && event.status === "UPCOMING" && (
        <button className="btn-ghost text-xs" disabled={loading} onClick={start}>
          Start
        </button>
      )}
      {canAct && event.is_actionable && event.status === "IN_PROGRESS" && !showCompletion && (
        <button className="btn-primary text-xs" onClick={() => setShowCompletion(true)}>
          Mark complete
        </button>
      )}
      {showCompletion && (
        <form onSubmit={submitCompletion} className="space-y-2 border-t border-graphite-800 pt-3">
          <textarea
            className="input min-h-24 text-xs"
            placeholder="What was accomplished for this deadline? (required, 20+ characters)"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
          <input
            className="input text-xs file:mr-3 file:rounded-sm file:border-0 file:bg-graphite-700 file:px-2 file:py-1 file:text-graphite-100"
            type="file"
            multiple
            onChange={(e) => setFiles(e.target.files)}
          />
          <div className="flex gap-2">
            <button type="submit" disabled={loading} className="btn-primary text-xs">
              Submit for review
            </button>
            <button type="button" className="btn-ghost text-xs" onClick={() => setShowCompletion(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

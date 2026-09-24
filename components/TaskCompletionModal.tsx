"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function TaskCompletionModal({ taskId, taskTitle, onClose }: { taskId: string; taskTitle: string; onClose: () => void }) {
  const router = useRouter();
  const [summary, setSummary] = useState("");
  const [links, setLinks] = useState("");
  const [remaining, setRemaining] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const summaryValid = summary.trim().length >= 20;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!summaryValid) {
      setError("Completion summary must be a meaningful paragraph — at least 20 characters describing the work performed.");
      return;
    }
    setLoading(true);
    setError(null);
    const fd = new FormData();
    fd.set("completion_summary", summary.trim());
    fd.set("completion_links", links.trim());
    fd.set("remaining_work", remaining.trim());
    if (files) Array.from(files).forEach((f) => fd.append("files", f));

    const res = await fetch(`/api/tasks/${taskId}/submit`, { method: "POST", body: fd });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "Could not submit completion.");
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="panel w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div>
          <div className="data-label">MARK COMPLETE</div>
          <h2 className="text-lg font-semibold text-graphite-100 mt-1">{taskTitle}</h2>
          <p className="text-xs text-graphite-500 mt-1">
            A task can't be completed without documentation. This goes to your Team Lead for review before it's marked Completed.
          </p>
        </div>

        {error && (
          <div className="text-sm text-telemetry-red font-mono border border-telemetry-red/40 bg-telemetry-red/10 rounded-sm px-3 py-2">
            {error}
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <span className="data-label block mb-1.5">
              Completion summary <span className="text-signal">*</span>
            </span>
            <textarea
              className="input min-h-28"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="What was completed, what work was performed, any results, issues encountered, and remaining work."
              required
            />
            <div className={`text-[11px] font-mono mt-1 ${summaryValid ? "text-graphite-500" : "text-telemetry-amber"}`}>
              {summary.trim().length}/20 characters minimum
            </div>
          </div>

          <div>
            <span className="data-label block mb-1.5">Upload images / supporting documents</span>
            <input
              className="input file:mr-3 file:rounded-sm file:border-0 file:bg-graphite-700 file:px-2.5 file:py-1 file:text-graphite-100 file:text-xs"
              type="file"
              multiple
              onChange={(e) => setFiles(e.target.files)}
            />
          </div>

          <div>
            <span className="data-label block mb-1.5">Relevant links (optional)</span>
            <input className="input" value={links} onChange={(e) => setLinks(e.target.value)} placeholder="One per line" />
          </div>

          <div>
            <span className="data-label block mb-1.5">Remaining work (optional)</span>
            <textarea className="input min-h-16" value={remaining} onChange={(e) => setRemaining(e.target.value)} />
          </div>

          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={loading || !summaryValid} className="btn-primary">
              {loading ? "Submitting…" : "Submit for review"}
            </button>
            <button type="button" className="btn-ghost" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

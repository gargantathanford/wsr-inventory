"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function TaskReviewPanel({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [returning, setReturning] = useState(false);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function review(action: "approve" | "return") {
    if (action === "return" && !reason.trim()) {
      setError("Explain what needs additional work before returning.");
      return;
    }
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/tasks/${taskId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, return_reason: reason.trim() || undefined })
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not submit review.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="border border-telemetry-amber/40 bg-telemetry-amber/5 rounded-md p-3 space-y-2">
      <div className="text-telemetry-amber font-mono text-[11px] tracking-wide">AWAITING YOUR REVIEW</div>
      {error && <div className="text-xs text-telemetry-red font-mono">{error}</div>}
      {!returning ? (
        <div className="flex gap-2">
          <button className="btn-primary text-xs py-1.5" disabled={loading} onClick={() => review("approve")}>
            Approve completion
          </button>
          <button className="btn-ghost text-xs py-1.5" disabled={loading} onClick={() => setReturning(true)}>
            Return for more work
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <textarea
            className="input min-h-16 text-xs"
            placeholder="What needs additional work?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex gap-2">
            <button className="btn-ghost text-xs py-1.5 border-telemetry-amber/50 text-telemetry-amber" disabled={loading} onClick={() => review("return")}>
              Confirm return
            </button>
            <button className="btn-ghost text-xs py-1.5" onClick={() => setReturning(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

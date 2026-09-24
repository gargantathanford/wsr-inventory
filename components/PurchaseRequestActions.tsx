"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PurchaseRequestActions({
  request,
  isOwner,
  isApprover
}: {
  request: any;
  isOwner: boolean;
  isApprover: boolean;
}) {
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [decisionNote, setDecisionNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setStatus(status: string, note?: string) {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/purchase-requests/${request.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, decision_note: note })
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Action failed.");
      return;
    }
    router.refresh();
  }

  async function convert() {
    setLoading(true);
    const res = await fetch(`/api/purchase-requests/${request.id}/convert`, { method: "POST" });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not convert.");
      return;
    }
    const data = await res.json();
    router.push(`/purchase-orders/${data.id}`);
  }

  async function addComment(eventType: "COMMENT" | "INFO_REQUESTED" = "COMMENT") {
    if (!comment.trim()) return;
    setLoading(true);
    await fetch(`/api/purchase-requests/${request.id}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment: comment.trim(), event_type: eventType })
    });
    setLoading(false);
    setComment("");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-sm text-telemetry-red font-mono">{error}</div>}

      <div className="flex flex-wrap gap-2">
        {isOwner && request.status === "DRAFT" && (
          <button className="btn-primary text-xs" disabled={loading} onClick={() => setStatus("SUBMITTED")}>
            Submit request
          </button>
        )}
        {isOwner && ["DRAFT", "SUBMITTED"].includes(request.status) && (
          <button className="btn-ghost text-xs" disabled={loading} onClick={() => setStatus("CANCELLED")}>
            Cancel request
          </button>
        )}
        {isApprover && ["SUBMITTED", "UNDER_REVIEW"].includes(request.status) && (
          <>
            {request.status === "SUBMITTED" && (
              <button className="btn-ghost text-xs" disabled={loading} onClick={() => setStatus("UNDER_REVIEW")}>
                Mark under review
              </button>
            )}
            <button className="btn-primary text-xs" disabled={loading} onClick={() => setStatus("APPROVED", decisionNote)}>
              Approve
            </button>
            <button className="btn-ghost text-xs border-telemetry-red/50 text-telemetry-red" disabled={loading} onClick={() => setStatus("REJECTED", decisionNote)}>
              Reject
            </button>
          </>
        )}
        {isApprover && request.status === "APPROVED" && (
          <button className="btn-primary text-xs" disabled={loading} onClick={convert}>
            Convert to Purchase Order
          </button>
        )}
      </div>

      {isApprover && ["SUBMITTED", "UNDER_REVIEW"].includes(request.status) && (
        <input
          className="input text-xs"
          placeholder="Decision note (included with approve/reject)"
          value={decisionNote}
          onChange={(e) => setDecisionNote(e.target.value)}
        />
      )}

      <div className="border-t border-graphite-800 pt-4">
        <div className="data-label mb-2">ADD COMMENT</div>
        <div className="flex gap-2">
          <input className="input text-xs" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment or ask a question…" />
          <button className="btn-ghost text-xs" disabled={loading || !comment.trim()} onClick={() => addComment("COMMENT")}>
            Post
          </button>
          {isApprover && (
            <button className="btn-ghost text-xs" disabled={loading || !comment.trim()} onClick={() => addComment("INFO_REQUESTED")}>
              Request info
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

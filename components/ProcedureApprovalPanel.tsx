"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ProcedureApprovalPanel({ procedureId, canReview }: { procedureId: string; canReview: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  if (!canReview) return null;

  async function setStatus(status: string) {
    setLoading(true);
    await fetch(`/api/procedures/${procedureId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approval_status: status })
    });
    setLoading(false);
    router.refresh();
  }

  return (
    <div className="flex gap-2">
      <button className="btn-ghost text-xs border-telemetry-amber/50 text-telemetry-amber" disabled={loading} onClick={() => setStatus("PENDING_APPROVAL")}>
        Request approval
      </button>
      <button className="btn-ghost text-xs border-telemetry-green/50 text-telemetry-green" disabled={loading} onClick={() => setStatus("APPROVED")}>
        Approve
      </button>
      <button className="btn-ghost text-xs border-telemetry-red/50 text-telemetry-red" disabled={loading} onClick={() => setStatus("REJECTED")}>
        Reject
      </button>
    </div>
  );
}

export function DeleteProcedureButton({ procedureId }: { procedureId: string }) {
  const router = useRouter();
  async function onDelete() {
    if (!confirm("Delete this procedure? This cannot be undone.")) return;
    const res = await fetch(`/api/procedures/${procedureId}`, { method: "DELETE" });
    if (res.ok) router.push("/procedures");
  }
  return (
    <button onClick={onDelete} className="text-xs text-graphite-600 hover:text-telemetry-red">
      Delete
    </button>
  );
}

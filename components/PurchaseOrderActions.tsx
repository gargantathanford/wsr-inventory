"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const NEXT_STATUS: Record<string, string[]> = {
  DRAFT: ["AWAITING_APPROVAL", "CANCELLED"],
  AWAITING_APPROVAL: ["APPROVED", "CANCELLED"],
  APPROVED: ["ORDERED", "CANCELLED"],
  ORDERED: ["RECEIVED", "CANCELLED"],
  PARTIALLY_RECEIVED: ["RECEIVED"],
  RECEIVED: ["CLOSED"]
};

export function PurchaseOrderActions({ order, canEdit }: { order: any; canEdit: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receivingLine, setReceivingLine] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [condition, setCondition] = useState("GOOD");
  const [location, setLocation] = useState("");

  if (!canEdit) return null;

  async function setStatus(status: string) {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/purchase-orders/${order.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Action failed.");
      return;
    }
    router.refresh();
  }

  async function receive(lineItemId: string) {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/purchase-orders/${order.id}/receive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ line_item_id: lineItemId, quantity_received: qty, condition, storage_location: location })
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not log receipt.");
      return;
    }
    setReceivingLine(null);
    setQty(1);
    setLocation("");
    router.refresh();
  }

  const availableTransitions = NEXT_STATUS[order.status] || [];
  const receivableLines = order.line_items.filter((l: any) => l.received_quantity < l.quantity);

  return (
    <div className="space-y-3">
      {error && <div className="text-xs text-telemetry-red font-mono">{error}</div>}
      <div className="flex gap-2 flex-wrap">
        {availableTransitions.map((s) => (
          <button
            key={s}
            className={`btn-ghost text-xs ${s === "CANCELLED" ? "border-telemetry-red/50 text-telemetry-red" : ""}`}
            disabled={loading}
            onClick={() => setStatus(s)}
          >
            {s === "ORDERED" ? "Mark ordered" : s === "CLOSED" ? "Close order" : `Move to ${s.replace(/_/g, " ")}`}
          </button>
        ))}
      </div>

      {["ORDERED", "PARTIALLY_RECEIVED"].includes(order.status) && receivableLines.length > 0 && (
        <div className="border-t border-graphite-800 pt-3">
          <div className="data-label mb-2">RECEIVE ITEMS</div>
          <div className="space-y-2">
            {receivableLines.map((l: any) => (
              <div key={l.id} className="rounded-sm border border-graphite-700 p-2.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-graphite-200">{l.item_name}</span>
                  <span className="font-mono text-xs text-graphite-500">
                    {l.received_quantity}/{l.quantity} received
                  </span>
                </div>
                {receivingLine === l.id ? (
                  <div className="grid grid-cols-4 gap-2 mt-2">
                    <input className="input text-xs" type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} />
                    <select className="input text-xs" value={condition} onChange={(e) => setCondition(e.target.value)}>
                      <option value="GOOD">Good</option>
                      <option value="DAMAGED">Damaged</option>
                      <option value="INCORRECT_ITEM">Incorrect item</option>
                    </select>
                    <input className="input text-xs" placeholder="Storage location" value={location} onChange={(e) => setLocation(e.target.value)} />
                    <button className="btn-primary text-xs" disabled={loading} onClick={() => receive(l.id)}>
                      Log receipt
                    </button>
                  </div>
                ) : (
                  <button className="btn-ghost text-xs mt-2" onClick={() => setReceivingLine(l.id)}>
                    Log receipt
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

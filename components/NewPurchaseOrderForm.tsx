"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface LineItem {
  item_name: string;
  description: string;
  quantity: number;
  unit_cost: number;
  product_link: string;
}

const emptyLine = (): LineItem => ({ item_name: "", description: "", quantity: 1, unit_cost: 0, product_link: "" });

export function NewPurchaseOrderForm({ subsystems }: { subsystems: { id: string; name: string }[] }) {
  const router = useRouter();
  const [lines, setLines] = useState<LineItem[]>([emptyLine()]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateLine(i: number, field: keyof LineItem, value: any) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)));
  }

  const total = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0), 0);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const payload = {
      vendor: fd.get("vendor"),
      subsystem_id: fd.get("subsystem_id") || null,
      budget_category: fd.get("budget_category"),
      notes: fd.get("notes"),
      line_items: lines.filter((l) => l.item_name.trim())
    };
    const res = await fetch("/api/purchase-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "Could not create order.");
      return;
    }
    const data = await res.json();
    router.push(`/purchase-orders/${data.id}`);
  }

  return (
    <form onSubmit={onSubmit} className="panel p-6 space-y-4 max-w-3xl">
      {error && <div className="text-sm text-telemetry-red font-mono">{error}</div>}
      <div className="grid sm:grid-cols-3 gap-3">
        <input className="input" name="vendor" placeholder="Vendor" />
        <select className="input" name="subsystem_id" defaultValue="">
          <option value="">No responsible team</option>
          {subsystems.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <input className="input" name="budget_category" placeholder="Budget category" />
      </div>

      <div>
        <span className="data-label block mb-2">Line items</span>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center">
              <input className="input col-span-4" placeholder="Item name" value={l.item_name} onChange={(e) => updateLine(i, "item_name", e.target.value)} />
              <input className="input col-span-3" placeholder="Description" value={l.description} onChange={(e) => updateLine(i, "description", e.target.value)} />
              <input className="input col-span-1" type="number" min={1} placeholder="Qty" value={l.quantity} onChange={(e) => updateLine(i, "quantity", e.target.value)} />
              <input className="input col-span-2" type="number" step="0.01" placeholder="Unit cost" value={l.unit_cost} onChange={(e) => updateLine(i, "unit_cost", e.target.value)} />
              <span className="col-span-2 text-xs font-mono text-graphite-400 text-right">
                ${((Number(l.quantity) || 0) * (Number(l.unit_cost) || 0)).toFixed(2)}
              </span>
            </div>
          ))}
        </div>
        <button type="button" className="btn-ghost text-xs mt-2" onClick={() => setLines((prev) => [...prev, emptyLine()])}>
          + Add line item
        </button>
        <div className="text-right font-mono text-sm text-graphite-200 mt-2 border-t border-graphite-800 pt-2">
          Total: <span className="text-signal font-semibold">${total.toFixed(2)}</span>
        </div>
      </div>

      <textarea className="input min-h-16" name="notes" placeholder="Notes" />

      <button type="submit" disabled={loading} className="btn-primary">
        {loading ? "Creating…" : "Create Purchase Order"}
      </button>
    </form>
  );
}

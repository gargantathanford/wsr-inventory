"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Part } from "@/lib/queries";

const STATUSES = [
  "NEEDED",
  "PARTIALLY_OWNED",
  "OWNED",
  "ORDERED",
  "BACKORDERED",
  "MANUFACTURING",
  "AVAILABLE_FOR_INSTALLATION",
  "INSTALLED",
  "UNAVAILABLE",
  "NO_LONGER_NEEDED"
];
const IMPORTANCE = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
const PURCHASE_STATUSES = ["NEEDED", "RESEARCHING", "AWAITING_APPROVAL", "APPROVED", "ORDERED", "RECEIVED", "NO_LONGER_NEEDED"];
const APPROVAL_STATUSES = ["PENDING", "APPROVED", "REJECTED"];

export function PartEditPanel({ part, canEdit }: { part: Part; canEdit: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canEdit) return null;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const payload: Record<string, any> = {};
    for (const [k, v] of fd.entries()) {
      payload[k] = v === "" ? null : v;
    }
    const res = await fetch(`/api/parts/${part.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    setLoading(false);
    if (!res.ok) {
      setError("Update failed.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  async function onDelete() {
    if (!confirm(`Delete ${part.part_name}? This cannot be undone.`)) return;
    const res = await fetch(`/api/parts/${part.id}`, { method: "DELETE" });
    if (res.ok) router.push("/parts");
  }

  if (!open) {
    return (
      <div className="flex gap-2">
        <button className="btn-ghost text-xs" onClick={() => setOpen(true)}>
          Edit part
        </button>
        <button className="btn-ghost text-xs text-telemetry-red border-telemetry-red/40" onClick={onDelete}>
          Delete
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="panel p-5 space-y-4">
      {error && <div className="text-sm text-telemetry-red font-mono">{error}</div>}
      <div className="grid sm:grid-cols-3 gap-4">
        <Field label="Status">
          <select className="input" name="status" defaultValue={part.status}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Importance">
          <select className="input" name="importance" defaultValue={part.importance}>
            {IMPORTANCE.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Priority score">
          <input className="input" type="number" min={1} max={10} name="priority_score" defaultValue={part.priority_score} />
        </Field>
        <Field label="Purchase status (Shopping List)">
          <select className="input" name="purchase_status" defaultValue={part.purchase_status}>
            {PURCHASE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Approval status">
          <select className="input" name="approval_status" defaultValue={part.approval_status}>
            {APPROVAL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Quantity required">
          <input className="input" type="number" min={1} name="quantity_required" defaultValue={part.quantity_required} />
        </Field>
        <Field label="Quantity owned">
          <input className="input" type="number" min={0} name="quantity_owned" defaultValue={part.quantity_owned} />
        </Field>
        <Field label="Supplier">
          <input className="input" name="supplier" defaultValue={part.supplier ?? ""} />
        </Field>
        <Field label="Estimated cost">
          <input className="input" type="number" step="0.01" name="estimated_cost" defaultValue={part.estimated_cost ?? ""} />
        </Field>
        <Field label="Actual cost">
          <input className="input" type="number" step="0.01" name="actual_cost" defaultValue={part.actual_cost ?? ""} />
        </Field>
        <Field label="Lead time (days)">
          <input className="input" type="number" name="lead_time_days" defaultValue={part.lead_time_days ?? ""} />
        </Field>
        <Field label="Purchase URL">
          <input className="input" name="purchase_url" defaultValue={part.purchase_url ?? ""} />
        </Field>
        <Field label="Date ordered">
          <input className="input" type="date" name="date_ordered" defaultValue={part.date_ordered ?? ""} />
        </Field>
        <Field label="Date received">
          <input className="input" type="date" name="date_received" defaultValue={part.date_received ?? ""} />
        </Field>
        <Field label="Weight (kg)">
          <input className="input" type="number" step="0.01" name="weight_kg" defaultValue={part.weight_kg ?? ""} />
        </Field>
        <Field label="Dimensions">
          <input className="input" name="dimensions" defaultValue={part.dimensions ?? ""} placeholder="L x W x H mm" />
        </Field>
        <Field label="Material">
          <input className="input" name="material" defaultValue={part.material ?? ""} />
        </Field>
      </div>
      <Field label="Operating specifications">
        <textarea className="input min-h-20" name="operating_specifications" defaultValue={part.operating_specifications ?? ""} />
      </Field>
      <div className="flex gap-2">
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? "Saving…" : "Save changes"}
        </button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="data-label block mb-1.5">{label}</span>
      {children}
    </label>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function NewPurchaseRequestForm({
  subsystems,
  defaultPartId,
  defaultItemName
}: {
  subsystems: { id: string; name: string }[];
  defaultPartId?: string;
  defaultItemName?: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>, submit: boolean) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const payload: Record<string, any> = Object.fromEntries(fd.entries());
    payload.submit = submit;
    const res = await fetch("/api/purchase-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "Could not create request.");
      return;
    }
    const data = await res.json();
    router.push(`/purchase-requests/${data.id}`);
  }

  return (
    <form onSubmit={(e) => onSubmit(e, true)} className="panel p-6 space-y-4 max-w-2xl">
      {error && <div className="text-sm text-telemetry-red font-mono">{error}</div>}
      {defaultPartId && <input type="hidden" name="part_id" value={defaultPartId} />}

      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Item name" required>
          <input className="input" name="item_name" defaultValue={defaultItemName} required />
        </Field>
        <Field label="Responsible team">
          <select className="input" name="subsystem_id" defaultValue="">
            <option value="">None</option>
            {subsystems.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Quantity">
          <input className="input" type="number" min={1} name="quantity" defaultValue={1} />
        </Field>
        <Field label="Estimated cost">
          <input className="input" type="number" step="0.01" name="estimated_cost" />
        </Field>
        <Field label="Vendor">
          <input className="input" name="vendor" />
        </Field>
        <Field label="Product link">
          <input className="input" name="product_link" placeholder="https://" />
        </Field>
        <Field label="Required by">
          <input className="input" type="date" name="required_date" />
        </Field>
        <Field label="Priority">
          <select className="input" name="priority" defaultValue="MEDIUM">
            {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Item description">
        <textarea className="input min-h-16" name="item_description" />
      </Field>
      <Field label="Justification for purchase" required>
        <textarea className="input min-h-20" name="justification" placeholder="Why is this needed?" required />
      </Field>
      <Field label="Project / vehicle association">
        <input className="input" name="project_association" placeholder="e.g. 2027 IC car" />
      </Field>

      <div className="flex gap-2">
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? "Submitting…" : "Submit request"}
        </button>
        <button
          type="button"
          disabled={loading}
          className="btn-ghost"
          onClick={(e) => onSubmit(e as any, false)}
        >
          Save as draft
        </button>
      </div>
    </form>
  );
}

function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block">
      <span className="data-label block mb-1.5">
        {label}
        {required && <span className="text-signal"> *</span>}
      </span>
      {children}
    </label>
  );
}

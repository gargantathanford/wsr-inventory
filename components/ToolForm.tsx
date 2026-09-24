"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const STATUSES = ["AVAILABLE", "IN_USE", "CHECKED_OUT", "UNDER_MAINTENANCE", "MISSING", "DAMAGED", "RETIRED", "NEEDS_CALIBRATION"];
const CONDITIONS = ["GOOD", "WORN", "DAMAGED", "NEEDS_CALIBRATION"];

export function ToolForm({ subsystems }: { subsystems: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const payload = Object.fromEntries(fd.entries());
    const res = await fetch("/api/tools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "Could not create tool.");
      return;
    }
    const data = await res.json();
    setOpen(false);
    router.push(`/tools/${data.id}`);
  }

  if (!open) {
    return (
      <button className="btn-primary" onClick={() => setOpen(true)}>
        + Add Tool
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="panel p-6 space-y-4">
      {error && (
        <div className="text-sm text-telemetry-red font-mono border border-telemetry-red/40 bg-telemetry-red/10 rounded-sm px-3 py-2">
          {error}
        </div>
      )}
      <div className="grid sm:grid-cols-3 gap-4">
        <Field label="Tool name" required>
          <input className="input" name="tool_name" required />
        </Field>
        <Field label="Tool type / category">
          <input className="input" name="tool_category" placeholder="Hand tool, shop equipment, specialty…" />
        </Field>
        <Field label="Responsible team">
          <select className="input" name="responsible_subsystem_id" defaultValue="">
            <option value="">Unassigned</option>
            {subsystems.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Manufacturer">
          <input className="input" name="manufacturer" />
        </Field>
        <Field label="Model number">
          <input className="input" name="model_number" />
        </Field>
        <Field label="Serial number">
          <input className="input" name="serial_number" />
        </Field>
        <Field label="Asset number">
          <input className="input" name="asset_number" />
        </Field>
        <Field label="Location">
          <input className="input" name="storage_location" placeholder="e.g. Fab Shop" />
        </Field>
        <Field label="Storage area">
          <input className="input" name="storage_area" placeholder="e.g. Cabinet 3, Shelf B" />
        </Field>
        <Field label="Quantity owned">
          <input className="input" type="number" min={0} name="quantity_owned" defaultValue={1} />
        </Field>
        <Field label="Condition">
          <select className="input" name="condition" defaultValue="GOOD">
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {c.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Availability status">
          <select className="input" name="status" defaultValue="AVAILABLE">
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Date acquired">
          <input className="input" type="date" name="date_acquired" />
        </Field>
        <Field label="Purchase cost">
          <input className="input" type="number" step="0.01" name="purchase_cost" />
        </Field>
        <Field label="Replacement cost">
          <input className="input" type="number" step="0.01" name="replacement_cost" />
        </Field>
      </div>
      <Field label="Description">
        <textarea className="input min-h-16" name="description" />
      </Field>
      <Field label="Notes">
        <textarea className="input min-h-16" name="notes" />
      </Field>
      <div className="flex gap-2">
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? "Creating…" : "Create tool"}
        </button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
          Cancel
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

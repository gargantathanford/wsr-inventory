"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const STATUSES = ["AVAILABLE", "CHECKED_OUT", "MISSING", "DAMAGED", "NEEDS_CALIBRATION"];
const CONDITIONS = ["GOOD", "WORN", "DAMAGED", "NEEDS_CALIBRATION"];

export function ToolEditPanel({ tool, canEdit }: { tool: any; canEdit: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!canEdit) return null;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    const payload = Object.fromEntries(fd.entries());
    await fetch(`/api/tools/${tool.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    setLoading(false);
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button className="btn-ghost text-xs" onClick={() => setOpen(true)}>
        Edit tool
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="panel p-5 space-y-4">
      <div className="grid sm:grid-cols-3 gap-4">
        <Field label="Status">
          <select className="input" name="status" defaultValue={tool.status}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Condition">
          <select className="input" name="condition" defaultValue={tool.condition}>
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {c.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Quantity owned">
          <input className="input" type="number" min={0} name="quantity_owned" defaultValue={tool.quantity_owned} />
        </Field>
        <Field label="Storage location">
          <input className="input" name="storage_location" defaultValue={tool.storage_location ?? ""} />
        </Field>
        <Field label="Calibration date">
          <input className="input" type="date" name="calibration_date" defaultValue={tool.calibration_date ?? ""} />
        </Field>
      </div>
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

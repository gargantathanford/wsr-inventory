"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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

export function PartForm({ subsystems }: { subsystems: { id: string; name: string }[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const payload = Object.fromEntries(fd.entries());
    const res = await fetch("/api/parts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "Could not create part.");
      return;
    }
    const data = await res.json();
    router.push(`/parts/${data.id}`);
  }

  return (
    <form onSubmit={onSubmit} className="panel p-6 space-y-5 max-w-2xl">
      {error && (
        <div className="text-sm text-telemetry-red font-mono border border-telemetry-red/40 bg-telemetry-red/10 rounded-sm px-3 py-2">
          {error}
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Part name" required>
          <input className="input" name="part_name" required />
        </Field>
        <Field label="Subsystem" required>
          <select className="input" name="subsystem_id" required defaultValue="">
            <option value="" disabled>
              Select subsystem
            </option>
            {subsystems.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Part number">
          <input className="input" name="part_number" />
        </Field>
        <Field label="Manufacturer">
          <input className="input" name="manufacturer" />
        </Field>
        <Field label="Supplier">
          <input className="input" name="supplier" />
        </Field>
        <Field label="Quantity required">
          <input className="input" type="number" min={1} name="quantity_required" defaultValue={1} />
        </Field>
        <Field label="Quantity owned">
          <input className="input" type="number" min={0} name="quantity_owned" defaultValue={0} />
        </Field>
        <Field label="Status">
          <select className="input" name="status" defaultValue="NEEDED">
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Importance">
          <select className="input" name="importance" defaultValue="MEDIUM">
            {IMPORTANCE.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Priority score (1-10)">
          <input className="input" type="number" min={1} max={10} name="priority_score" defaultValue={5} />
        </Field>
        <Field label="Estimated cost (USD)">
          <input className="input" type="number" step="0.01" name="estimated_cost" />
        </Field>
        <Field label="Lead time (days)">
          <input className="input" type="number" name="lead_time_days" />
        </Field>
        <Field label="Purchase URL">
          <input className="input" name="purchase_url" placeholder="https://" />
        </Field>
      </div>

      <Field label="Description">
        <textarea className="input min-h-24" name="description" />
      </Field>

      <div className="flex gap-2">
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? "Creating…" : "Create part"}
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

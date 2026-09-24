"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const CATEGORIES: [string, string][] = [
  ["DASHBOARD_USAGE", "Dashboard Usage"],
  ["NAMING_CONVENTIONS", "Naming Conventions"],
  ["CAD_STANDARDS", "CAD Standards"],
  ["DESIGN_DOCUMENTATION", "Design Documentation"],
  ["DRAWING_RELEASE", "Drawing Release"],
  ["DESIGN_REVIEW", "Design Review"],
  ["PROCUREMENT", "Procurement"],
  ["MANUFACTURING", "Manufacturing"],
  ["TESTING", "Testing"],
  ["DESIGN_CHANGE", "Design Change"],
  ["FILE_STORAGE", "File Storage"],
  ["GENERAL", "General"]
];

export function ProcedureForm({ subsystems }: { subsystems: { id: string; name: string }[] }) {
  const router = useRouter();
  const [steps, setSteps] = useState<string[]>([""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateStep(i: number, value: string) {
    setSteps((prev) => prev.map((s, idx) => (idx === i ? value : s)));
  }
  function addStep() {
    setSteps((prev) => [...prev, ""]);
  }
  function removeStep(i: number) {
    setSteps((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const payload = Object.fromEntries(fd.entries());
    const cleanSteps = steps.map((s) => s.trim()).filter(Boolean);

    const res = await fetch("/api/procedures", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, steps: cleanSteps })
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "Could not create procedure.");
      return;
    }
    const data = await res.json();
    router.push(`/procedures/${data.id}`);
  }

  return (
    <form onSubmit={onSubmit} className="panel p-6 space-y-5 max-w-2xl">
      {error && (
        <div className="text-sm text-telemetry-red font-mono border border-telemetry-red/40 bg-telemetry-red/10 rounded-sm px-3 py-2">
          {error}
        </div>
      )}

      <Field label="Procedure title" required>
        <input className="input" name="title" required />
      </Field>

      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Procedure category" required>
          <select className="input" name="category" defaultValue="GENERAL">
            {CATEGORIES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Applicable team(s)">
          <select className="input" name="subsystem_id" defaultValue="">
            <option value="">All Teams</option>
            {subsystems.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Description">
        <textarea className="input min-h-20" name="description" placeholder="What this procedure covers" />
      </Field>
      <Field label="Purpose">
        <textarea className="input min-h-16" name="purpose" placeholder="Why this procedure exists — what it prevents or ensures" />
      </Field>

      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Required documentation">
          <textarea className="input min-h-16" name="required_documentation" placeholder="What must be attached / on file" />
        </Field>
        <Field label="Supporting files or links">
          <textarea className="input min-h-16" name="supporting_links" placeholder="One per line" />
        </Field>
      </div>

      <Field label="Safety warning (optional)">
        <input className="input" name="safety_warning" placeholder="Shown prominently if present" />
      </Field>

      <Field label="Revision number">
        <input className="input" name="revision_number" defaultValue="1.0" />
      </Field>

      <div>
        <span className="data-label block mb-2">Steps</span>
        <div className="space-y-2">
          {steps.map((step, i) => (
            <div key={i} className="flex gap-2">
              <span className="font-mono text-xs text-graphite-500 pt-2.5 w-5">{i + 1}.</span>
              <input
                className="input"
                value={step}
                onChange={(e) => updateStep(i, e.target.value)}
                placeholder={`Step ${i + 1}`}
              />
              {steps.length > 1 && (
                <button type="button" className="btn-ghost text-xs px-2" onClick={() => removeStep(i)}>
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
        <button type="button" className="btn-ghost text-xs mt-2" onClick={addStep}>
          + Add step
        </button>
      </div>

      <div className="flex gap-2 pt-2">
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? "Creating…" : "Create procedure"}
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

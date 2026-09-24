"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const DOC_TYPES = [
  "SERVICE_MANUAL",
  "INSTALLATION_INSTRUCTIONS",
  "CAD_MODEL",
  "DATASHEET",
  "WIRING_DIAGRAM",
  "SPREADSHEET",
  "VIDEO",
  "URL",
  "TECHNICAL_NOTE",
  "PDF",
  "OTHER"
];

export function DocumentUploadForm({
  subsystems,
  defaultSubsystemId,
  defaultPartId,
  defaultProcedureId
}: {
  subsystems: { id: string; name: string }[];
  defaultSubsystemId?: string;
  defaultPartId?: string;
  defaultProcedureId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"LINK" | "UPLOAD">("LINK");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const form = e.currentTarget;
    const fd = new FormData(form);

    let res: Response;
    if (mode === "UPLOAD") {
      res = await fetch("/api/documents", { method: "POST", body: fd });
    } else {
      const payload = Object.fromEntries(fd.entries());
      res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    }

    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "Could not save document.");
      return;
    }
    form.reset();
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button className="btn-primary" onClick={() => setOpen(true)}>
        + Add documentation
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="panel p-5 space-y-4">
      <div className="flex gap-2">
        <TabButton active={mode === "LINK"} onClick={() => setMode("LINK")}>
          Link a URL
        </TabButton>
        <TabButton active={mode === "UPLOAD"} onClick={() => setMode("UPLOAD")}>
          Upload a file
        </TabButton>
      </div>

      {error && (
        <div className="text-sm text-telemetry-red font-mono border border-telemetry-red/40 bg-telemetry-red/10 rounded-sm px-3 py-2">
          {error}
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Title" required>
          <input className="input" name="title" required />
        </Field>
        <Field label="Type">
          <select className="input" name="doc_type" defaultValue="OTHER">
            {DOC_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Subsystem">
          <select className="input" name="subsystem_id" defaultValue={defaultSubsystemId || ""}>
            <option value="">None</option>
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
        {defaultPartId && <input type="hidden" name="part_id" value={defaultPartId} />}
        {defaultProcedureId && <input type="hidden" name="procedure_id" value={defaultProcedureId} />}

        {mode === "LINK" ? (
          <Field label="URL" required>
            <input className="input" name="url" type="url" placeholder="https://" required />
          </Field>
        ) : (
          <Field label="File (PDF, image, CAD, etc. — max 25MB)" required>
            <input
              className="input file:mr-3 file:rounded-sm file:border-0 file:bg-graphite-700 file:px-2.5 file:py-1 file:text-graphite-100 file:text-xs"
              name="file"
              type="file"
              required
            />
          </Field>
        )}
      </div>

      <Field label="Notes">
        <textarea className="input min-h-16" name="notes" />
      </Field>

      <div className="flex gap-2">
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? "Saving…" : "Save"}
        </button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs font-mono px-3 py-1.5 rounded-sm border ${
        active ? "border-signal text-signal bg-signal/10" : "border-graphite-700 text-graphite-400 hover:text-graphite-200"
      }`}
    >
      {children}
    </button>
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

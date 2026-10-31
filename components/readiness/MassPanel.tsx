"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fromKg, MASS_UNITS, type MassUnit } from "@/lib/units";

/**
 * A subsystem's mass against its budget.
 *
 * Mass is the budget an FSAE team blows most reliably, and it blows it
 * quietly: every part individually reasonable, the total 30% over, and nobody
 * finds out until the car is on the scales in April. The number is shown
 * wherever a lead already is, not buried in a report they would have to go
 * looking for.
 *
 * Measured and allocated-only are separated on purpose. A subsystem that is
 * "under budget" entirely on the lead's own estimates has not demonstrated
 * anything yet — it has a plan. The split says which it is.
 */
export function MassPanel({
  subsystemId,
  standing,
  canEdit
}: {
  subsystemId: string;
  standing: {
    budgetKg: number | null;
    committedKg: number;
    measuredKg: number;
    allocatedOnlyKg: number;
    excusedParts: number;
    unknownParts: number;
    overBy: number | null;
  };
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(standing.budgetKg ? String(standing.budgetKg) : "");
  const [unit, setUnit] = useState<MassUnit>("kg");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { budgetKg, committedKg, measuredKg, allocatedOnlyKg, excusedParts, unknownParts, overBy } = standing;
  const pct = budgetKg && budgetKg > 0 ? Math.round((committedKg / budgetKg) * 100) : null;

  async function save(next: number | null) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/subsystems/${subsystemId}/mass`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ budget_kg: next })
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "Could not save that budget.");
      return;
    }
    setEditing(false);
    router.refresh();
  }

  return (
    <section className="panel p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-sm font-medium text-graphite-200">Mass</h2>
          <p className="text-[11px] text-graphite-500 mt-1 max-w-md leading-relaxed">
            Per-unit masses multiplied by quantity. Parts marked &ldquo;mass not applicable&rdquo; are
            excluded deliberately.
          </p>
        </div>
        <div className="text-right">
          <div
            className="font-mono text-2xl tabular-nums"
            style={{ color: overBy !== null ? "#FFB020" : undefined }}
          >
            {committedKg.toFixed(1)}
            <span className="text-sm text-graphite-500"> kg</span>
          </div>
          {budgetKg ? (
            <div className="font-mono text-[11px] text-graphite-500">
              of {budgetKg.toFixed(1)} kg budget{pct !== null ? ` · ${pct}%` : ""}
            </div>
          ) : (
            <div className="font-mono text-[11px] text-graphite-500">no budget set</div>
          )}
        </div>
      </div>

      {budgetKg ? (
        <div>
          <div className="h-1.5 rounded-full bg-graphite-850 overflow-hidden flex">
            {/* Measured and estimated are drawn separately. A bar that is all
                estimate looks exactly like a bar that is all weighed, and they
                mean very different things. */}
            <div
              className="h-full"
              style={{
                width: `${Math.min(100, (measuredKg / budgetKg) * 100)}%`,
                backgroundColor: overBy !== null ? "#FFB020" : "#2ED573"
              }}
            />
            <div
              className="h-full opacity-50"
              style={{
                width: `${Math.min(100 - Math.min(100, (measuredKg / budgetKg) * 100), (allocatedOnlyKg / budgetKg) * 100)}%`,
                backgroundColor: overBy !== null ? "#FFB020" : "#2ED573"
              }}
            />
          </div>
          <div className="flex justify-between font-mono text-[10px] text-graphite-500 mt-1.5 flex-wrap gap-2">
            <span>
              {measuredKg.toFixed(1)} kg weighed · {allocatedOnlyKg.toFixed(1)} kg still estimated
            </span>
            {overBy !== null && (
              <span className="text-telemetry-amber">{overBy.toFixed(1)} KG OVER BUDGET</span>
            )}
          </div>
        </div>
      ) : null}

      {overBy !== null && (
        <p className="text-[11px] text-graphite-400 leading-relaxed border-l-2 border-telemetry-amber pl-3">
          This caps the subsystem at 92% however many gates are closed. Parts come out, lighter
          options get chosen, or the budget gets renegotiated against another subsystem — all three
          are decisions somebody has to make out loud.
        </p>
      )}

      {(unknownParts > 0 || excusedParts > 0) && (
        <div className="font-mono text-[11px] text-graphite-500">
          {unknownParts > 0 && (
            <span className="text-telemetry-amber">
              {unknownParts} part{unknownParts === 1 ? "" : "s"} with no mass — not counted above
            </span>
          )}
          {unknownParts > 0 && excusedParts > 0 && " · "}
          {excusedParts > 0 && `${excusedParts} excused`}
        </div>
      )}

      {error && <p className="text-xs text-telemetry-red leading-relaxed">{error}</p>}

      {canEdit &&
        (editing ? (
          <div className="flex items-end gap-2 flex-wrap">
            <label className="block">
              <span className="data-label block mb-1">Budget</span>
              <input
                className="input w-28"
                type="number"
                step="0.1"
                min={0}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </label>
            <select className="input w-24" value={unit} onChange={(e) => setUnit(e.target.value as MassUnit)}>
              {MASS_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
            <button
              className="btn-primary text-xs"
              disabled={busy}
              onClick={() => {
                const n = Number(value);
                if (!value.trim()) return save(null);
                if (!Number.isFinite(n)) return setError("That is not a number.");
                // Converted to kg before it leaves the browser, like every
                // other mass in the app.
                save(Number((n * (unit === "kg" ? 1 : 1 / fromKg(1, unit))).toFixed(3)));
              }}
            >
              Save
            </button>
            <button className="btn-ghost text-xs" onClick={() => { setEditing(false); setError(null); }}>
              Cancel
            </button>
          </div>
        ) : (
          <button className="btn-ghost text-xs" onClick={() => setEditing(true)}>
            {budgetKg ? "Change the mass budget" : "Set a mass budget"}
          </button>
        ))}
    </section>
  );
}

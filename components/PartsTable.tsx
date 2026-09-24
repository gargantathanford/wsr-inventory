import Link from "next/link";
import type { Part } from "@/lib/queries";
import { ownershipPercent } from "@/lib/scoring";
import { StatusBadge, ImportanceBadge } from "@/components/StatusBadge";
import { ProgressBar } from "@/components/ProgressBar";

export function PartsTable({ parts, showSubsystem = false }: { parts: Part[]; showSubsystem?: boolean }) {
  if (parts.length === 0) {
    return (
      <div className="panel p-8 text-center text-sm text-graphite-500">No parts match the current filters.</div>
    );
  }

  return (
    <div className="panel overflow-x-auto">
      <table className="table-shell min-w-[900px]">
        <thead>
          <tr>
            <th>Part</th>
            {showSubsystem && <th>Subsystem</th>}
            <th>Status</th>
            <th>Ownership</th>
            <th>Importance</th>
            <th className="text-right">Cost</th>
            <th className="text-right">Lead time</th>
            <th>Supplier</th>
          </tr>
        </thead>
        <tbody>
          {parts.map((p) => {
            const pct = ownershipPercent(p.quantity_owned, p.quantity_required);
            return (
              <tr key={p.id}>
                <td>
                  <Link href={`/parts/${p.id}`} className="text-graphite-100 hover:text-signal font-medium">
                    {p.part_name}
                  </Link>
                  {p.part_number && (
                    <div className="font-mono text-[11px] text-graphite-500">{p.part_number}</div>
                  )}
                </td>
                {showSubsystem && (
                  <td className="text-graphite-400 text-xs">{p.subsystem_name}</td>
                )}
                <td>
                  <StatusBadge status={p.status} />
                </td>
                <td className="w-32">
                  <div className="flex items-center gap-2">
                    <ProgressBar
                      pct={pct}
                      colorClass={pct >= 100 ? "bg-telemetry-green" : pct > 0 ? "bg-telemetry-amber" : "bg-graphite-700"}
                    />
                    <span className="font-mono text-[11px] text-graphite-400 whitespace-nowrap">
                      {p.quantity_owned}/{p.quantity_required}
                    </span>
                  </div>
                </td>
                <td>
                  <ImportanceBadge importance={p.importance} />
                </td>
                <td className="text-right font-mono text-xs text-graphite-300">
                  {p.estimated_cost != null ? `$${p.estimated_cost.toLocaleString()}` : "—"}
                </td>
                <td className="text-right font-mono text-xs text-graphite-300">
                  {p.lead_time_days != null ? `${p.lead_time_days}d` : "—"}
                </td>
                <td className="text-xs text-graphite-400">{p.supplier || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

import Link from "next/link";
import { getPartsWithPriority, lineCost } from "@/lib/queries";
import { getSession, canEditSubsystem } from "@/lib/auth";
import { ImportanceBadge } from "@/components/StatusBadge";
import { ShoppingListStatusControls } from "@/components/ShoppingListStatusControls";

const SORTERS: Record<string, (a: any, b: any) => number> = {
  priority: (a, b) => b.procurement_priority - a.procurement_priority,
  cost: (a, b) => (b.estimated_cost ?? 0) - (a.estimated_cost ?? 0),
  leadtime: (a, b) => (b.lead_time_days ?? 0) - (a.lead_time_days ?? 0),
  subsystem: (a, b) => (a.subsystem_name || "").localeCompare(b.subsystem_name || "")
};

export default async function ShoppingListPage({ searchParams }: { searchParams: { sort?: string } }) {
  const sortKey = searchParams.sort && SORTERS[searchParams.sort] ? searchParams.sort : "priority";
  const items = getPartsWithPriority()
    .filter((p) => p.procurement_priority > 0 || p.purchase_status === "AWAITING_APPROVAL")
    .sort(SORTERS[sortKey]);

  const user = await getSession();
  const highRisk = items.filter((p) => (p.lead_time_days ?? 0) >= 56);
  const awaitingApproval = items.filter((p) => p.purchase_status === "AWAITING_APPROVAL");

  return (
    <div className="p-6 md:p-8 max-w-[1500px] mx-auto space-y-8">
      <div>
        <div className="data-label">SHOPPING LIST</div>
        <h1 className="text-2xl font-semibold text-graphite-100 mt-1">{items.length} items need purchasing action</h1>
      </div>

      {awaitingApproval.length > 0 && (
        <div className="border border-telemetry-amber/40 bg-telemetry-amber/5 rounded-md p-4">
          <div className="text-telemetry-amber font-mono text-xs tracking-wide">
            {awaitingApproval.length} ITEM{awaitingApproval.length === 1 ? "" : "S"} AWAITING APPROVAL
          </div>
          <div className="mt-3 grid sm:grid-cols-2 gap-2">
            {awaitingApproval.map((p) => (
              <Link key={p.id} href={`/parts/${p.id}`} className="rounded-sm border border-telemetry-amber/30 px-3 py-2.5 hover:border-telemetry-amber/60">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-graphite-100">{p.part_name}</span>
                  <span className="font-mono text-xs text-graphite-400">{p.estimated_cost != null ? `$${p.estimated_cost.toLocaleString()}` : ""}</span>
                </div>
                <div className="font-mono text-xs text-graphite-400 mt-1">
                  Requested by {p.requested_by_name || "—"} · {p.subsystem_name}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {highRisk.length > 0 && (
        <div className="border border-telemetry-red/40 bg-telemetry-red/5 rounded-md p-4">
          <div className="text-telemetry-red font-mono text-xs tracking-wide">⚠ HIGH RISK — 8+ WEEK LEAD TIMES</div>
          <div className="mt-3 grid sm:grid-cols-2 gap-2">
            {highRisk.map((p) => (
              <Link key={p.id} href={`/parts/${p.id}`} className="rounded-sm border border-telemetry-red/30 px-3 py-2.5 hover:border-telemetry-red/60">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-graphite-100">{p.part_name}</span>
                  <span className="pill border-telemetry-red/50 text-telemetry-red bg-telemetry-red/10">HIGH RISK</span>
                </div>
                <div className="font-mono text-xs text-graphite-400 mt-1">
                  {p.lead_time_days} day lead time · {p.subsystem_name}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2 text-xs font-mono">
        {Object.keys(SORTERS).map((key) => (
          <Link
            key={key}
            href={`/shopping-list?sort=${key}`}
            className={`px-2.5 py-1.5 rounded-sm border ${
              sortKey === key ? "border-signal text-signal" : "border-graphite-700 text-graphite-400 hover:text-graphite-200"
            }`}
          >
            SORT: {key.toUpperCase()}
          </Link>
        ))}
      </div>

      <div className="panel overflow-x-auto">
        <table className="table-shell min-w-[1300px]">
          <thead>
            <tr>
              <th>Part</th>
              <th>Team</th>
              <th className="text-right">Qty needed</th>
              <th className="text-right">Qty owned</th>
              <th>Priority</th>
              <th className="text-right">Est. cost</th>
              <th className="text-right">Actual cost</th>
              <th className="text-right">Lead time</th>
              <th>Requested by</th>
              <th>Purchase / Approval status</th>
              <th>Link</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => {
              const canEdit = !!user && canEditSubsystem(user, p.subsystem_id);
              return (
                <tr key={p.id}>
                  <td>
                    <Link href={`/parts/${p.id}`} className="text-graphite-100 hover:text-signal font-medium">
                      {p.part_name}
                    </Link>
                    {p.description && <div className="text-[11px] text-graphite-500 mt-0.5 line-clamp-1 max-w-xs">{p.description}</div>}
                    <div className="mt-1">
                      <ImportanceBadge importance={p.importance} />
                    </div>
                  </td>
                  <td className="text-xs text-graphite-400">{p.subsystem_name}</td>
                  <td className="text-right font-mono text-xs text-graphite-300">
                    {Math.max(p.quantity_required - p.quantity_owned, 0)}
                  </td>
                  <td className="text-right font-mono text-xs text-graphite-300">{p.quantity_owned}</td>
                  <td>
                    <span
                      className={`font-mono text-sm font-semibold ${
                        p.procurement_priority >= 70
                          ? "text-telemetry-red"
                          : p.procurement_priority >= 40
                          ? "text-telemetry-amber"
                          : "text-graphite-300"
                      }`}
                    >
                      {p.procurement_priority}
                    </span>
                    <span className="block font-mono text-[10px] text-graphite-500">
                      {p.procurement_priority_band === "NONE" ? "" : p.procurement_priority_band}
                    </span>
                  </td>
                  <td className="text-right font-mono text-xs text-graphite-300">
                    {/* Line total (unit price x quantity), with the quoted range beneath it. */}
                    {lineCost(p) > 0 ? `$${lineCost(p).toLocaleString()}` : "—"}
                    {p.estimated_cost_low != null &&
                    p.estimated_cost_high != null &&
                    p.estimated_cost_high > p.estimated_cost_low ? (
                      <span className="block text-[10px] text-graphite-500">
                        ${lineCost(p, "low").toLocaleString()}–${lineCost(p, "high").toLocaleString()}
                      </span>
                    ) : null}
                  </td>
                  <td className="text-right font-mono text-xs text-graphite-300">
                    {p.actual_cost != null ? `$${p.actual_cost.toLocaleString()}` : "—"}
                  </td>
                  <td className="text-right font-mono text-xs text-graphite-300">
                    {p.lead_time_days != null ? `${p.lead_time_days}d` : "—"}
                  </td>
                  <td className="text-xs text-graphite-400">{p.requested_by_name || "—"}</td>
                  <td>
                    <ShoppingListStatusControls
                      partId={p.id}
                      purchaseStatus={p.purchase_status}
                      approvalStatus={p.approval_status}
                      canEdit={canEdit}
                    />
                  </td>
                  <td>
                    {p.purchase_url ? (
                      <a href={p.purchase_url} target="_blank" rel="noreferrer" className="text-signal hover:text-signal-bright text-xs font-mono">
                        open ↗
                      </a>
                    ) : (
                      <span className="text-graphite-600 text-xs">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr>
                <td colSpan={11} className="text-center py-8 text-graphite-500">
                  Shopping list is clear — nothing outstanding.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

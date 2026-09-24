import Link from "next/link";
import { getSubsystemReadiness, getGlobalStats } from "@/lib/queries";
import { ProgressBar } from "@/components/ProgressBar";
import { StatCard } from "@/components/StatCard";

export default async function InventoryPage() {
  const readiness = getSubsystemReadiness();
  const stats = getGlobalStats();
  const sorted = [...readiness].sort((a, b) => b.pct - a.pct);

  return (
    <div className="p-6 md:p-8 max-w-[1400px] mx-auto space-y-8">
      <div>
        <div className="data-label">INVENTORY</div>
        <h1 className="text-2xl font-semibold text-graphite-100 mt-1">Visual inventory by subsystem</h1>
      </div>

      <div className="grid sm:grid-cols-4 gap-4">
        <StatCard label="TOTAL PARTS" value={stats.total} />
        <StatCard label="OWNED" value={stats.owned} accent="text-telemetry-green" />
        <StatCard label="NEEDED" value={stats.needed} />
        <StatCard label="EST. TOTAL COST" value={`$${stats.totalCost.toLocaleString()}`} />
      </div>

      <div className="space-y-3">
        {sorted.map((s) => (
          <Link key={s.id} href={`/subsystems/${s.slug}`} className="panel p-5 flex items-center gap-6 hover:border-signal/50 transition-colors">
            <div className="w-40 shrink-0">
              <div className="text-graphite-100 font-medium truncate">{s.name}</div>
              <div className="font-mono text-xs text-graphite-500 mt-0.5">{s.pct}% complete</div>
            </div>
            <div className="flex-1">
              <ProgressBar pct={s.pct} colorClass={s.pct >= 75 ? "bg-telemetry-green" : s.pct >= 45 ? "bg-telemetry-amber" : "bg-signal"} height="h-2.5" />
            </div>
            <div className="flex gap-6 shrink-0 font-mono text-xs text-graphite-400 w-40 justify-end">
              <span>
                <span className="text-graphite-200">{s.ownedCount}</span> owned
              </span>
              <span>
                <span className="text-graphite-200">{s.neededCount}</span> needed
              </span>
            </div>
          </Link>
        ))}
        {sorted.length === 0 && <p className="text-sm text-graphite-500">No subsystems with parts yet.</p>}
      </div>
    </div>
  );
}

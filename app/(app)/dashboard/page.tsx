import Link from "next/link";
import { getSession } from "@/lib/auth";
import {
  getGlobalStats,
  getStatusBreakdown,
  getSubsystemReadiness,
  getCriticalProcurementItems,
  getBlockingComponents,
  getMissingTools,
} from "@/lib/queries";
import { statusLabel } from "@/lib/scoring";
import { StatCard } from "@/components/StatCard";
import { getReadinessByCode, getVehicleReadiness } from "@/lib/readiness/store";
import { ProgressBar } from "@/components/ProgressBar";
import { StatusDonut } from "@/components/charts/StatusDonut";
import { ImportanceBadge } from "@/components/StatusBadge";
import { BuildSchematic } from "@/components/BuildSchematic";

export default async function DashboardPage() {
  // Gate-based, from lib/readiness. The old getReadinessByCode counted owned
  // parts, which is why one owned part painted a subsystem green.
  const readinessByCode = getReadinessByCode();
  const vehicle = getVehicleReadiness();
  const user = await getSession();
  const stats = getGlobalStats();
  const breakdown = getStatusBreakdown();
  const subsystemReadiness = getSubsystemReadiness();
  const criticalItems = getCriticalProcurementItems(5);
  const blocking = getBlockingComponents();
  const missingTools = getMissingTools();

  const readinessColor =
    vehicle.pct >= 75 ? "text-telemetry-green" : vehicle.pct >= 45 ? "text-telemetry-amber" : "text-telemetry-red";
  const readinessBar =
    vehicle.pct >= 75 ? "bg-telemetry-green" : vehicle.pct >= 45 ? "bg-telemetry-amber" : "bg-signal";

  return (
    <div className="p-6 md:p-8 max-w-[1400px] mx-auto space-y-8">
      <div>
        <div className="data-label">WELCOME TO WARP SPEED RACING</div>
        <h1 className="text-2xl font-semibold text-graphite-100 mt-1">
          {user?.name.split(" ")[0]}, here is where the build stands.
        </h1>
      </div>

      {/* Project readiness hero */}
      <div className="panel p-6 md:p-8 flex flex-col md:flex-row md:items-center gap-8">
        <div className="shrink-0">
          <div className="data-label">PROJECT READINESS</div>
          <div className={`font-mono text-6xl md:text-7xl font-bold tabular-nums mt-1 ${readinessColor}`}>
            {vehicle.pct}
            <span className="text-3xl text-graphite-500">%</span>
          </div>
        </div>
        <div className="flex-1 w-full">
          <ProgressBar pct={vehicle.pct} colorClass={readinessBar} height="h-2.5" />
          <p className="font-mono text-[11px] text-graphite-500 mt-2">
            {vehicle.fullyClosed} of {vehicle.subsystems} subsystems fully signed off
            {vehicle.capped > 0 && ` · ${vehicle.capped} capped by an open critical interface`}
            {vehicle.stale > 0 &&
              (vehicle.stale === 1
                ? " · 1 closed gate no longer matches the data"
                : ` · ${vehicle.stale} closed gates no longer match the data`)}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mt-6">
            <MiniStat label="TOTAL PARTS" value={stats.total} />
            <MiniStat label="OWNED" value={stats.owned} accent="text-telemetry-green" />
            <MiniStat label="NEEDED" value={stats.needed} accent="text-graphite-200" />
            <MiniStat label="ORDERED" value={stats.ordered} accent="text-telemetry-blue" />
            <MiniStat label="CRITICAL MISSING" value={stats.criticalMissing} accent="text-telemetry-red" />
          </div>
        </div>
      </div>

      {missingTools.length > 0 && (
        <div className="border border-telemetry-red/40 bg-telemetry-red/5 rounded-md p-4">
          <div className="flex items-center gap-2 text-telemetry-red font-mono text-xs tracking-wide">
            WARNING — REQUIRED TOOLS UNAVAILABLE
          </div>
          <div className="mt-2 grid sm:grid-cols-2 gap-2">
            {missingTools.map((t) => (
              <Link
                key={t.id}
                href={`/tools/${t.id}`}
                className="text-sm flex items-center justify-between rounded-sm border border-graphite-700 px-3 py-2 hover:border-telemetry-red/50"
              >
                <span className="text-graphite-100">{t.tool_name}</span>
                <span className="font-mono text-xs text-graphite-500">
                  {t.subsystem_names || "Unassigned"}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <section className="panel p-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-sm font-medium text-graphite-200">The car, as it stands</h2>
          <Link href="/subsystems" className="font-mono text-[11px] text-signal hover:text-signal-bright">
            ALL SUBSYSTEMS →
          </Link>
        </div>
        <div className="mt-4">
          <BuildSchematic readiness={readinessByCode} />
        </div>
      </section>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="panel p-6 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-graphite-200">Subsystems furthest behind</h2>
            <Link href="/inventory" className="text-xs font-mono text-signal hover:text-signal-bright">
              VIEW ALL →
            </Link>
          </div>
          <div className="mt-4 space-y-4">
            {subsystemReadiness.slice(0, 6).map((s) => (
              <Link key={s.id} href={`/subsystems/${s.slug}`} className="block group">
                <div className="flex items-center justify-between text-sm mb-1.5">
                  <span className="text-graphite-200 group-hover:text-white">{s.name}</span>
                  <span className="font-mono text-xs text-graphite-400">
                    {s.ownedCount}/{s.partCount} owned · {s.pct}%
                  </span>
                </div>
                <ProgressBar
                  pct={s.pct}
                  colorClass={s.pct >= 75 ? "bg-telemetry-green" : s.pct >= 45 ? "bg-telemetry-amber" : "bg-signal"}
                />
              </Link>
            ))}
            {subsystemReadiness.length === 0 && (
              <p className="text-sm text-graphite-500">No subsystems with parts yet.</p>
            )}
          </div>
        </div>

        <div className="panel p-6">
          <h2 className="text-sm font-medium text-graphite-200">Parts by status</h2>
          <StatusDonut data={breakdown} />
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-2">
            {breakdown.map((b) => (
              <div key={b.status} className="flex items-center justify-between text-xs font-mono text-graphite-400">
                <span>{statusLabel(b.status)}</span>
                <span className="text-graphite-200">{b.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="panel p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-graphite-200">Top shopping list risks</h2>
            <Link href="/shopping-list" className="text-xs font-mono text-signal hover:text-signal-bright">
              FULL LIST →
            </Link>
          </div>
          <div className="mt-4 space-y-1">
            {criticalItems.map((p, i) => (
              <Link
                key={p.id}
                href={`/parts/${p.id}`}
                className="flex items-center justify-between py-2.5 border-b border-graphite-800 last:border-0 group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-mono text-xs text-graphite-600 w-4">{i + 1}</span>
                  <span className="text-sm text-graphite-100 group-hover:text-white truncate">{p.part_name}</span>
                  <ImportanceBadge importance={p.importance} />
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <span className="font-mono text-xs text-graphite-500">
                    {p.lead_time_days != null ? `${p.lead_time_days}d lead` : "lead n/a"}
                  </span>
                  <span className="font-mono text-sm text-signal w-10 text-right">{p.procurement_priority}</span>
                </div>
              </Link>
            ))}
            {criticalItems.length === 0 && <p className="text-sm text-graphite-500">Nothing outstanding.</p>}
          </div>
        </div>

        <div className="panel p-6">
          <h2 className="text-sm font-medium text-graphite-200">Blocking components by subsystem</h2>
          <p className="text-xs text-graphite-500 mt-1 font-mono">
            Critical / high-importance parts still missing that prevent subsystem completion.
          </p>
          <div className="mt-4 space-y-4">
            {blocking.slice(0, 5).map((b) => (
              <div key={b.subsystem}>
                <div className="text-sm text-graphite-100 mb-1.5">{b.subsystem} cannot be completed</div>
                <div className="flex flex-wrap gap-1.5">
                  {b.missing.map((m) => (
                    <Link
                      key={m.id}
                      href={`/parts/${m.id}`}
                      className="pill border-graphite-600 text-graphite-300 bg-graphite-800 hover:border-signal/60 hover:text-white"
                    >
                      {m.part_name}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
            {blocking.length === 0 && (
              <p className="text-sm text-graphite-500">No subsystems currently blocked.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value, accent = "text-graphite-100" }: { label: string; value: number; accent?: string }) {
  return (
    <div>
      <div className="data-label">{label}</div>
      <div className={`font-mono text-2xl font-semibold tabular-nums mt-1 ${accent}`}>{value}</div>
    </div>
  );
}

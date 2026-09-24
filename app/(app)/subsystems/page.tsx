import Link from "next/link";
import { getAllSubsystems } from "@/lib/queries";
import { ProgressBar } from "@/components/ProgressBar";

export default async function SubsystemsPage() {
  const subsystems = getAllSubsystems();

  return (
    <div className="p-6 md:p-8 max-w-[1400px] mx-auto space-y-6">
      <div>
        <div className="data-label">SUBSYSTEMS</div>
        <h1 className="text-2xl font-semibold text-graphite-100 mt-1">All subsystems</h1>
        <p className="text-sm text-graphite-400 mt-1">
          {subsystems.length} subsystems across the vehicle. Click into any subsystem for parts, tools,
          documentation, and completion status.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {subsystems.map((s) => {
          const pct = s.part_count > 0 ? Math.round((s.owned_count / s.part_count) * 100) : null;
          return (
            <Link key={s.id} href={`/subsystems/${s.slug}`} className="panel p-5 hover:border-signal/50 transition-colors">
              <div className="flex items-start justify-between">
                <h2 className="text-graphite-100 font-medium">{s.name}</h2>
                {pct != null ? (
                  <span className="font-mono text-xs text-graphite-400">{pct}%</span>
                ) : (
                  <span className="font-mono text-xs text-graphite-600">NO PARTS</span>
                )}
              </div>
              {pct != null ? (
                <div className="mt-3">
                  <ProgressBar pct={pct} colorClass={pct >= 75 ? "bg-telemetry-green" : pct >= 45 ? "bg-telemetry-amber" : "bg-signal"} />
                  <div className="flex justify-between mt-2 font-mono text-[11px] text-graphite-500">
                    <span>{s.owned_count} owned</span>
                    <span>{s.needed_count} needed</span>
                    <span>{s.part_count} total</span>
                  </div>
                </div>
              ) : (
                <div className="mt-3 h-1.5 bg-graphite-800 rounded-full" />
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

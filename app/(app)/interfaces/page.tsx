import { getAllInterfaces, interfaceStats } from "@/lib/interfaces";
import { getAllSubsystems } from "@/lib/queries";
import { getSession, subsystemsLedBy } from "@/lib/auth";
import { InterfaceRegister } from "@/components/InterfaceRegister";

/**
 * The interface register.
 *
 * A page of its own rather than a tab on each subsystem, because an interface
 * belongs to two subsystems and burying it under one of them is how it becomes
 * that team's problem instead of a shared one.
 */
export default async function InterfacesPage() {
  const user = await getSession();
  const interfaces = getAllInterfaces();
  const stats = interfaceStats();
  const subsystems = getAllSubsystems().map((s: any) => ({ id: s.id, name: s.name }));
  const led = user ? subsystemsLedBy(user.id) : [];
  const isChief = user?.role === "ADMIN" || user?.role === "CHIEF_ENGINEER";

  return (
    <div className="p-6 md:p-8 max-w-[1200px] mx-auto space-y-6">
      <div>
        <div className="data-label">INTERFACES</div>
        <h1 className="text-2xl font-semibold text-graphite-100 mt-1">
          {stats.total === 0 ? "Interface register" : `${stats.open} of ${stats.total} not yet agreed`}
        </h1>
        <p className="text-sm text-graphite-400 mt-2 max-w-2xl leading-relaxed">
          Every place two subsystems meet. Both leads have to agree each one — a joint that only one
          side has signed off is a joint nobody has checked against the other side&rsquo;s drawing.
        </p>
      </div>

      <div className="grid sm:grid-cols-4 gap-4">
        <Stat label="OPEN" value={stats.open} />
        <Stat label="CRITICAL OPEN" value={stats.criticalOpen} alert={stats.criticalOpen > 0} />
        <Stat label="WAITING ON ONE SIDE" value={stats.halfAgreed} />
        <Stat label="AGREED" value={stats.agreed} />
      </div>

      {stats.criticalOpen > 0 && (
        <div className="rounded border border-telemetry-red/40 bg-telemetry-red/[0.06] px-4 py-3">
          <div className="font-mono text-[10px] text-telemetry-red">
            {stats.criticalOpen} CRITICAL INTERFACE{stats.criticalOpen === 1 ? "" : "S"} NOT AGREED
          </div>
          <p className="text-xs text-graphite-300 mt-1.5 leading-relaxed">
            Each one caps both of its subsystems at 84%, however much of their own work is finished.
          </p>
        </div>
      )}

      <InterfaceRegister
        interfaces={interfaces}
        subsystems={subsystems}
        currentUserId={user?.id ?? ""}
        canRaise={user?.role !== "TEAM_MEMBER"}
        ledSubsystemIds={led}
        isChief={isChief}
      />
    </div>
  );
}

function Stat({ label, value, alert }: { label: string; value: number; alert?: boolean }) {
  return (
    <div className="panel p-5">
      <div className="data-label">{label}</div>
      <div className={`stat-figure mt-1 ${alert ? "text-telemetry-red" : ""}`}>{value}</div>
    </div>
  );
}

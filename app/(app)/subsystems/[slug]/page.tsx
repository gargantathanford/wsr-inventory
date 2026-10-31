import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getSubsystemBySlug,
  getAllParts,
  getSubsystemMembers,
  getSubsystemTools,
  getSubsystemDocuments,
  lineCost
} from "@/lib/queries";
import { ownershipPercent } from "@/lib/scoring";
import { PartsTable } from "@/components/PartsTable";
import { ProgressBar } from "@/components/ProgressBar";
import { StatusBadge } from "@/components/StatusBadge";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { GatePanel } from "@/components/readiness/GatePanel";
import { getReadiness } from "@/lib/readiness/store";
import { getInterfacesFor } from "@/lib/interfaces";
import { getSession } from "@/lib/auth";

export default async function SubsystemDetailPage({ params }: { params: { slug: string } }) {
  const subsystem = getSubsystemBySlug(params.slug);
  if (!subsystem) notFound();

  const parts = getAllParts({ subsystemId: subsystem.id });
  const members = getSubsystemMembers(subsystem.id);
  const tools = getSubsystemTools(subsystem.id);
  const docs = getSubsystemDocuments(subsystem.id);

  const owned = parts.filter((p) => ["OWNED", "AVAILABLE_FOR_INSTALLATION", "INSTALLED"].includes(p.status)).length;

  // Completeness is gate-based now. `owned / parts.length` is still computed
  // above but it is PROCUREMENT progress and is labelled as such — presenting
  // it as "completion" is the bug this release fixes.
  const readiness = getReadiness(subsystem.id);
  const subsystemInterfaces = getInterfacesFor(subsystem.id);
  const user = await getSession();
  // getSubsystemMembers selects `u.id`, not `user_id` — checking the wrong
  // field meant isLead was permanently false and no team leader could endorse
  // anything, which is also why the lead restriction had never been testable.
  const isLead = members.some((m: any) => m.id === user?.id && m.role_in_subsystem === "LEADER");
  const canApprove = user?.role === "ADMIN" || user?.role === "CHIEF_ENGINEER";
  // Endorsing is the responsible lead's job. A Chief or Admin can stand in
  // only where nobody leads the subsystem — otherwise "the lead endorses" is
  // a rule the two most senior people can quietly bypass, and the two-stage
  // sign-off stops meaning anything.
  const hasLead = members.some((m: any) => m.role_in_subsystem === "LEADER");
  const canEndorse = isLead || (canApprove && !hasLead);
  // Unit price x quantity required — see lineCost in lib/queries.
  const totalCost = parts.reduce((s, p) => s + lineCost(p), 0);

  return (
    <div className="p-6 md:p-8 max-w-[1400px] mx-auto space-y-8">
      <Breadcrumbs items={[{ label: "Subsystems", href: "/subsystems" }, { label: subsystem.name }]} />
      <div>
        <div className="data-label">SUBSYSTEM</div>
        <div className="flex items-center justify-between mt-1">
          <h1 className="text-2xl font-semibold text-graphite-100">{subsystem.name}</h1>
          <div className="flex gap-2">
            <Link href="/subsystems" className="btn-ghost text-xs">
              ← All subsystems
            </Link>
            <Link href={`/parts?subsystem=${subsystem.id}`} className="btn-ghost text-xs">
              View in parts database
            </Link>
          </div>
        </div>
        {subsystem.description && <p className="text-sm text-graphite-400 mt-1 max-w-2xl">{subsystem.description}</p>}
      </div>

      <div className="grid sm:grid-cols-4 gap-4">
        <div className="panel p-5">
          <div className="data-label">COMPLETENESS</div>
          <div className="stat-figure mt-1">{readiness.pct}%</div>
          <ProgressBar
            pct={readiness.pct}
            colorClass={
              readiness.pct >= 75 ? "bg-telemetry-green" : readiness.pct >= 45 ? "bg-telemetry-amber" : "bg-signal"
            }
          />
          <div className="text-xs font-mono text-graphite-500 mt-1">
            {readiness.passed}/{readiness.applicable} gates
            {readiness.ceiling && ` · capped at ${readiness.ceiling.cap}%`}
          </div>
        </div>
        <div className="panel p-5">
          {/* Named for what it actually measures. This used to be labelled
              COMPLETION, which is what made one owned part read as a finished
              subsystem. */}
          <div className="data-label">PARTS IN HAND</div>
          <div className="stat-figure mt-1">
            {owned}/{parts.length}
          </div>
          <div className="text-xs font-mono text-graphite-500 mt-1">procurement only</div>
        </div>
        <div className="panel p-5">
          <div className="data-label">EST. COST</div>
          <div className="stat-figure mt-1">${totalCost.toLocaleString()}</div>
        </div>
        <div className="panel p-5">
          <div className="data-label">TEAM</div>
          <div className="stat-figure mt-1">{members.length}</div>
          <div className="text-xs font-mono text-graphite-500 mt-1">
            {members.filter((m) => m.role_in_subsystem === "LEADER").length} leader(s)
          </div>
        </div>
      </div>

      {/* Shown next to the gates, because "Interfaces agreed" is the gate most
          likely to be blocked by somebody else and the lead needs to see WHO
          they are waiting on without going hunting. */}
      {subsystemInterfaces.length > 0 && (
        <section className="panel p-6">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-sm font-medium text-graphite-200">Interfaces</h2>
            <Link href="/interfaces" className="font-mono text-[11px] text-signal hover:text-signal-bright">
              FULL REGISTER →
            </Link>
          </div>
          <ul className="space-y-1.5">
            {subsystemInterfaces.map((i) => {
              const both = !!i.agreed_by_a && !!i.agreed_by_b;
              const other = i.subsystem_a_id === subsystem.id ? i.subsystem_b_name : i.subsystem_a_name;
              return (
                <li key={i.id} className="flex items-start justify-between gap-3 text-xs py-1.5">
                  <span className="min-w-0">
                    <span className="font-mono text-[11px] text-graphite-500">{i.interface_ref}</span>
                    <span className="text-graphite-300 ml-2">with {other ?? "an unassigned subsystem"}</span>
                    {i.description && (
                      <span className="block text-[11px] text-graphite-500 mt-0.5">{i.description}</span>
                    )}
                  </span>
                  <span
                    className={`font-mono text-[10px] shrink-0 ${
                      both
                        ? "text-telemetry-green"
                        : i.priority === "P1"
                          ? "text-telemetry-red"
                          : "text-telemetry-amber"
                    }`}
                  >
                    {both ? "AGREED" : i.priority === "P1" ? "P1 · NOT AGREED" : "NOT AGREED"}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <GatePanel
        subsystemId={subsystem.id}
        readiness={readiness}
        canEndorse={canEndorse}
        canApprove={canApprove}
        partListDeclaredComplete={!!(subsystem as any).part_list_declared_complete}
      />

      <section>
        <h2 className="text-sm font-medium text-graphite-200 mb-3">Parts</h2>
        <PartsTable parts={parts} />
      </section>

      <div className="grid lg:grid-cols-2 gap-6">
        <section>
          <h2 className="text-sm font-medium text-graphite-200 mb-3">Required tools</h2>
          <div className="panel divide-y divide-graphite-800">
            {tools.length === 0 && <p className="p-4 text-sm text-graphite-500">No tools assigned yet.</p>}
            {tools.map((t: any) => (
              <Link key={t.id} href={`/tools/${t.id}`} className="flex items-center justify-between p-4 hover:bg-graphite-850/60">
                <div>
                  <div className="text-sm text-graphite-100">{t.tool_name}</div>
                  <div className="text-xs font-mono text-graphite-500">{t.storage_location}</div>
                </div>
                <StatusBadge status={t.status} />
              </Link>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-sm font-medium text-graphite-200 mb-3">Documentation</h2>
          <div className="panel divide-y divide-graphite-800">
            {docs.length === 0 && <p className="p-4 text-sm text-graphite-500">No documentation uploaded yet.</p>}
            {docs.map((d: any) => (
              <a
                key={d.id}
                href={d.url || "#"}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between p-4 hover:bg-graphite-850/60"
              >
                <div>
                  <div className="text-sm text-graphite-100">{d.title}</div>
                  <div className="text-xs font-mono text-graphite-500">{d.doc_type.replace(/_/g, " ")}</div>
                </div>
                <span className="text-xs font-mono text-signal">OPEN →</span>
              </a>
            ))}
          </div>
        </section>
      </div>

      <section>
        <h2 className="text-sm font-medium text-graphite-200 mb-3">Team</h2>
        <div className="flex flex-wrap gap-2">
          {members.map((m: any) => (
            <div key={m.id} className="pill border-graphite-600 text-graphite-300 bg-graphite-800">
              {m.name} · {m.role_in_subsystem === "LEADER" ? "Leader" : "Member"}
            </div>
          ))}
          {members.length === 0 && <p className="text-sm text-graphite-500">No team members assigned.</p>}
        </div>
      </section>
    </div>
  );
}

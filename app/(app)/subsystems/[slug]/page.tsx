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
  const user = await getSession();
  const isLead = members.some((m: any) => m.user_id === user?.id && m.role_in_subsystem === "LEADER");
  const canApprove = user?.role === "ADMIN" || user?.role === "CHIEF_ENGINEER";
  const canEndorse = canApprove || isLead;
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

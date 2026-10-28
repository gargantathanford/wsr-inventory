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

export default async function SubsystemDetailPage({ params }: { params: { slug: string } }) {
  const subsystem = getSubsystemBySlug(params.slug);
  if (!subsystem) notFound();

  const parts = getAllParts({ subsystemId: subsystem.id });
  const members = getSubsystemMembers(subsystem.id);
  const tools = getSubsystemTools(subsystem.id);
  const docs = getSubsystemDocuments(subsystem.id);

  const owned = parts.filter((p) => ["OWNED", "AVAILABLE_FOR_INSTALLATION", "INSTALLED"].includes(p.status)).length;
  const pct = parts.length > 0 ? Math.round((owned / parts.length) * 100) : 0;
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
          <div className="data-label">COMPLETION</div>
          <div className="stat-figure mt-1">{pct}%</div>
          <ProgressBar pct={pct} colorClass={pct >= 75 ? "bg-telemetry-green" : pct >= 45 ? "bg-telemetry-amber" : "bg-signal"} />
        </div>
        <div className="panel p-5">
          <div className="data-label">PARTS</div>
          <div className="stat-figure mt-1">{parts.length}</div>
          <div className="text-xs font-mono text-graphite-500 mt-1">{owned} owned</div>
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

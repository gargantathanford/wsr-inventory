import Link from "next/link";
import { notFound } from "next/navigation";
import { getToolById } from "@/lib/queries";
import { getSession } from "@/lib/auth";
import { StatusBadge } from "@/components/StatusBadge";
import { ToolEditPanel } from "@/components/ToolEditPanel";

export default async function ToolDetailPage({ params }: { params: { id: string } }) {
  const tool = getToolById(params.id);
  if (!tool) notFound();
  const user = await getSession();
  const canEdit = !!user && user.role !== "TEAM_MEMBER";

  return (
    <div className="p-6 md:p-8 max-w-[1000px] mx-auto space-y-8">
      <div>
        <Link href="/tools" className="text-xs font-mono text-graphite-500 hover:text-graphite-200">
          ← TOOL DATABASE
        </Link>
        <div className="flex items-start justify-between mt-2 gap-4 flex-wrap">
          <div>
            <div className="data-label">{tool.tool_category || "TOOL"}</div>
            <h1 className="text-3xl font-semibold text-graphite-100 mt-1">{tool.tool_name}</h1>
          </div>
          <ToolEditPanel tool={tool} canEdit={canEdit} />
        </div>
      </div>

      {(tool.status === "MISSING" || tool.status === "DAMAGED") && (
        <div className="border border-telemetry-red/40 bg-telemetry-red/5 rounded-md p-4 text-sm text-telemetry-red">
          ⚠ This tool is currently {tool.status.toLowerCase()}. Subsystems relying on it may be blocked.
        </div>
      )}

      <div className="grid sm:grid-cols-4 gap-4">
        <div className="panel p-5">
          <div className="data-label">STATUS</div>
          <div className="mt-2">
            <StatusBadge status={tool.status} />
          </div>
        </div>
        <div className="panel p-5">
          <div className="data-label">QUANTITY</div>
          <div className="stat-figure mt-1 text-2xl">{tool.quantity_owned}</div>
        </div>
        <div className="panel p-5">
          <div className="data-label">LOCATION</div>
          <div className="text-lg text-graphite-100 mt-2">{tool.storage_location || "—"}</div>
        </div>
        <div className="panel p-5">
          <div className="data-label">CONDITION</div>
          <div className="text-lg text-graphite-100 mt-2">{tool.condition.replace(/_/g, " ")}</div>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-6">
        <div>
          <h2 className="text-sm font-medium text-graphite-200 mb-2">Used for (subsystems)</h2>
          <div className="flex flex-wrap gap-1.5">
            {tool.subsystems.length === 0 && <p className="text-sm text-graphite-500">Not assigned to a subsystem.</p>}
            {tool.subsystems.map((s: any) => (
              <Link key={s.id} href={`/subsystems/${s.slug}`} className="pill border-graphite-600 text-graphite-300 bg-graphite-800 hover:border-signal/60">
                {s.name}
              </Link>
            ))}
          </div>
        </div>
        <div>
          <h2 className="text-sm font-medium text-graphite-200 mb-2">Associated parts</h2>
          <div className="flex flex-wrap gap-1.5">
            {tool.parts.length === 0 && <p className="text-sm text-graphite-500">No parts linked.</p>}
            {tool.parts.map((p: any) => (
              <Link key={p.id} href={`/parts/${p.id}`} className="pill border-graphite-600 text-graphite-300 bg-graphite-800 hover:border-signal/60">
                {p.part_name}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {tool.instructions && (
        <div>
          <h2 className="text-sm font-medium text-graphite-200 mb-2">Instructions</h2>
          <p className="text-sm text-graphite-400 whitespace-pre-line">{tool.instructions}</p>
        </div>
      )}
      {tool.safety_requirements && (
        <div className="border border-telemetry-amber/40 bg-telemetry-amber/10 rounded-md p-4 text-sm text-telemetry-amber">
          ⚠ {tool.safety_requirements}
        </div>
      )}
    </div>
  );
}

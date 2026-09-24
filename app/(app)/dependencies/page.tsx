import Link from "next/link";
import { getDependencyGraphData } from "@/lib/queries";
import { DependencyGraph } from "@/components/DependencyGraph";
import { StatusBadge } from "@/components/StatusBadge";

export default async function DependenciesPage() {
  const graphs = getDependencyGraphData();
  const blockedParts = graphs.filter((g) => !["OWNED", "AVAILABLE_FOR_INSTALLATION", "INSTALLED"].includes(g.part.status));

  return (
    <div className="p-6 md:p-8 max-w-[1200px] mx-auto space-y-8">
      <div>
        <div className="data-label">DEPENDENCY GRAPH</div>
        <h1 className="text-2xl font-semibold text-graphite-100 mt-1">
          {graphs.length} parts with tracked dependencies
        </h1>
        <p className="text-sm text-graphite-400 mt-1 max-w-2xl">
          Each graph shows what a part requires (left) and what it blocks if missing (right). Red-outlined
          nodes are not yet owned.
        </p>
      </div>

      {blockedParts.length > 0 && (
        <div className="border border-telemetry-red/40 bg-telemetry-red/5 rounded-md p-4">
          <div className="text-telemetry-red font-mono text-xs tracking-wide">
            {blockedParts.length} DEPENDENCY {blockedParts.length === 1 ? "CHAIN" : "CHAINS"} CURRENTLY BLOCKED
          </div>
        </div>
      )}

      <div className="space-y-8">
        {graphs.map(({ part, requires, blocks }) => (
          <div key={part.id} className="panel p-6">
            <div className="flex items-center justify-between mb-4">
              <Link href={`/parts/${part.id}`} className="text-graphite-100 font-medium hover:text-signal">
                {part.part_name}
              </Link>
              <StatusBadge status={part.status} />
            </div>
            <DependencyGraph centerLabel={part.part_name} requires={requires} blocks={blocks} />
          </div>
        ))}
        {graphs.length === 0 && (
          <div className="panel p-8 text-center text-sm text-graphite-500">
            No dependencies recorded yet. Add dependencies to parts to see the graph.
          </div>
        )}
      </div>
    </div>
  );
}

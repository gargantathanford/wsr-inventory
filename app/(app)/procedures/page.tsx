import Link from "next/link";
import { getAllProcedures } from "@/lib/queries";
import { getSession } from "@/lib/auth";
import { StatusBadge } from "@/components/StatusBadge";

const CATEGORY_LABEL: Record<string, string> = {
  DASHBOARD_USAGE: "Dashboard Usage",
  NAMING_CONVENTIONS: "Naming Conventions",
  CAD_STANDARDS: "CAD Standards",
  DESIGN_DOCUMENTATION: "Design Documentation",
  DRAWING_RELEASE: "Drawing Release",
  DESIGN_REVIEW: "Design Review",
  PROCUREMENT: "Procurement",
  MANUFACTURING: "Manufacturing",
  TESTING: "Testing",
  DESIGN_CHANGE: "Design Change",
  FILE_STORAGE: "File Storage",
  GENERAL: "General"
};

export default async function ProceduresPage({
  searchParams
}: {
  searchParams: { q?: string; category?: string };
}) {
  const procedures = getAllProcedures({ search: searchParams.q, category: searchParams.category });
  const user = await getSession();
  const canCreate = !!user && user.role !== "TEAM_MEMBER";

  return (
    <div className="p-6 md:p-8 max-w-[1200px] mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="data-label">PROCEDURES</div>
          <h1 className="text-2xl font-semibold text-graphite-100 mt-1">{procedures.length} standard operating procedures</h1>
          <p className="text-sm text-graphite-400 mt-1 max-w-2xl">
            The team's centralized SOP knowledge base — how to use the dashboard, and how engineering
            work gets designed, reviewed, and released.
          </p>
        </div>
        {canCreate && (
          <Link href="/procedures/new" className="btn-primary">
            + Add Procedure
          </Link>
        )}
      </div>

      <form className="panel p-4 grid sm:grid-cols-3 gap-3" method="get">
        <input className="input sm:col-span-2" type="text" name="q" placeholder="Search procedures…" defaultValue={searchParams.q} />
        <select className="input" name="category" defaultValue={searchParams.category || ""}>
          <option value="">All categories</option>
          {Object.entries(CATEGORY_LABEL).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </form>

      <div className="space-y-3">
        {procedures.map((proc: any) => (
          <Link key={proc.id} href={`/procedures/${proc.id}`} className="panel p-5 flex items-start justify-between hover:border-signal/50 transition-colors gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="pill border-graphite-600 text-graphite-300 bg-graphite-800">
                  {CATEGORY_LABEL[proc.category] || proc.category}
                </span>
                {proc.safety_warning && (
                  <span className="pill border-telemetry-amber/50 text-telemetry-amber bg-telemetry-amber/10">Safety warning</span>
                )}
                <span className="font-mono text-[11px] text-graphite-500">Rev {proc.revision_number}</span>
              </div>
              <div className="text-graphite-100 font-medium mt-2">{proc.title}</div>
              {proc.description && <p className="text-sm text-graphite-500 mt-1 line-clamp-2">{proc.description}</p>}
              <div className="font-mono text-[11px] text-graphite-500 mt-2">
                {proc.stepCount} steps
                {proc.applicable_teams ? ` · ${proc.applicable_teams}` : ""}
                {proc.author_name ? ` · by ${proc.author_name}` : ""}
              </div>
            </div>
            <StatusBadge status={proc.approval_status} />
          </Link>
        ))}
        {procedures.length === 0 && <p className="text-sm text-graphite-500">No procedures recorded yet.</p>}
      </div>
    </div>
  );
}

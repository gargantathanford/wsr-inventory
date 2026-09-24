import Link from "next/link";
import { getAllTools, getAllSubsystems } from "@/lib/queries";
import { getSession } from "@/lib/auth";
import { StatusBadge } from "@/components/StatusBadge";
import { ToolForm } from "@/components/ToolForm";

export default async function ToolsPage({ searchParams }: { searchParams: { q?: string; status?: string } }) {
  const tools = getAllTools({ search: searchParams.q, status: searchParams.status });
  const subsystems = getAllSubsystems();
  const user = await getSession();
  const canCreate = !!user && user.role !== "TEAM_MEMBER";

  return (
    <div className="p-6 md:p-8 max-w-[1400px] mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="data-label">TOOL DATABASE</div>
          <h1 className="text-2xl font-semibold text-graphite-100 mt-1">{tools.length} tools</h1>
        </div>
        {canCreate && <ToolForm subsystems={subsystems.map((s: any) => ({ id: s.id, name: s.name }))} />}
      </div>

      <form className="panel p-4 grid sm:grid-cols-3 gap-3" method="get">
        <input className="input sm:col-span-2" type="text" name="q" placeholder="Search tools…" defaultValue={searchParams.q} />
        <select className="input" name="status" defaultValue={searchParams.status || ""}>
          <option value="">All statuses</option>
          <option value="AVAILABLE">Available</option>
          <option value="IN_USE">In use</option>
          <option value="CHECKED_OUT">Checked out</option>
          <option value="UNDER_MAINTENANCE">Under maintenance</option>
          <option value="MISSING">Missing</option>
          <option value="DAMAGED">Damaged</option>
          <option value="RETIRED">Retired</option>
          <option value="NEEDS_CALIBRATION">Needs calibration</option>
        </select>
        <div className="sm:col-span-3 flex gap-2">
          <button type="submit" className="btn-primary">
            Apply
          </button>
          <Link href="/tools" className="btn-ghost">
            Clear
          </Link>
        </div>
      </form>

      <div className="panel overflow-x-auto">
        <table className="table-shell min-w-[800px]">
          <thead>
            <tr>
              <th>Tool</th>
              <th>Category</th>
              <th>Location</th>
              <th className="text-right">Qty</th>
              <th>Condition</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {tools.map((t: any) => (
              <tr key={t.id}>
                <td>
                  <Link href={`/tools/${t.id}`} className="text-graphite-100 hover:text-signal font-medium">
                    {t.tool_name}
                  </Link>
                  {t.manufacturer && <div className="font-mono text-[11px] text-graphite-500">{t.manufacturer}</div>}
                </td>
                <td className="text-graphite-400 text-xs">{t.tool_category || "—"}</td>
                <td className="text-graphite-400 text-xs">{t.storage_location || "—"}</td>
                <td className="text-right font-mono text-xs text-graphite-300">{t.quantity_owned}</td>
                <td className="text-graphite-400 text-xs">{t.condition.replace(/_/g, " ")}</td>
                <td>
                  <StatusBadge status={t.status} />
                </td>
              </tr>
            ))}
            {tools.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center py-8 text-graphite-500">
                  No tools match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

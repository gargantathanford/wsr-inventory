import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";

export default async function AuditLogPage({ searchParams }: { searchParams: { entity?: string; action?: string } }) {
  const user = await getSession();
  if (!user || user.role !== "ADMIN") redirect("/dashboard");

  const db = getDb();
  let sql = `SELECT a.*, u.name as user_name FROM activity_log a LEFT JOIN users u ON u.id = a.user_id WHERE 1=1`;
  const params: any[] = [];
  if (searchParams.entity) {
    sql += ` AND a.entity_type = ?`;
    params.push(searchParams.entity);
  }
  if (searchParams.action) {
    sql += ` AND a.action = ?`;
    params.push(searchParams.action);
  }
  sql += ` ORDER BY a.created_at DESC LIMIT 300`;
  const entries = db.prepare(sql).all(...params) as any[];

  const entityTypes = (db.prepare(`SELECT DISTINCT entity_type FROM activity_log ORDER BY entity_type`).all() as any[]).map((r) => r.entity_type);
  const actions = (db.prepare(`SELECT DISTINCT action FROM activity_log ORDER BY action`).all() as any[]).map((r) => r.action);

  return (
    <div className="p-6 md:p-8 max-w-[1000px] mx-auto space-y-6">
      <Link href="/settings" className="text-xs font-mono text-graphite-500 hover:text-graphite-200">
        ← SETTINGS
      </Link>
      <div>
        <div className="data-label">AUDIT LOG</div>
        <h1 className="text-2xl font-semibold text-graphite-100 mt-1">{entries.length} recent entries</h1>
        <p className="text-sm text-graphite-400 mt-1">
          Every account, role, task-review, purchasing, and administrative action is recorded here.
          Admin-only, and not editable from the UI — the log itself has no update/delete route.
        </p>
      </div>

      <form className="panel p-4 grid sm:grid-cols-3 gap-3" method="get">
        <select className="input" name="entity" defaultValue={searchParams.entity || ""}>
          <option value="">All record types</option>
          {entityTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select className="input" name="action" defaultValue={searchParams.action || ""}>
          <option value="">All actions</option>
          {actions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <button type="submit" className="btn-primary">
          Filter
        </button>
      </form>

      <div className="panel divide-y divide-graphite-800 max-h-[70vh] overflow-y-auto">
        {entries.map((e) => (
          <div key={e.id} className="p-3.5 flex items-center justify-between text-sm gap-4">
            <span className="text-graphite-300 min-w-0 truncate">
              <span className="text-graphite-100">{e.user_name || "System"}</span> {e.action.toLowerCase()}d{" "}
              <span className="font-mono text-xs text-graphite-500">{e.entity_type.toLowerCase().replace(/_/g, " ")}</span>{" "}
              <span className="font-mono text-xs text-graphite-500">{e.details}</span>
            </span>
            <span className="font-mono text-[11px] text-graphite-500 shrink-0">{e.created_at}</span>
          </div>
        ))}
        {entries.length === 0 && <p className="p-4 text-sm text-graphite-500">No activity logged yet.</p>}
      </div>
    </div>
  );
}

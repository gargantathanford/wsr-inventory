import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";

export default async function SettingsPage() {
  const user = await getSession();
  if (!user || user.role !== "ADMIN") redirect("/dashboard");

  const db = getDb();
  const counts = {
    users: (db.prepare(`SELECT COUNT(*) c FROM users`).get() as any).c,
    subsystems: (db.prepare(`SELECT COUNT(*) c FROM subsystems`).get() as any).c,
    parts: (db.prepare(`SELECT COUNT(*) c FROM parts`).get() as any).c,
    tools: (db.prepare(`SELECT COUNT(*) c FROM tools`).get() as any).c,
    documents: (db.prepare(`SELECT COUNT(*) c FROM documents`).get() as any).c
  };
  const recentActivity = db
    .prepare(
      `SELECT a.*, u.name as user_name FROM activity_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.created_at DESC LIMIT 20`
    )
    .all() as any[];

  return (
    <div className="p-6 md:p-8 max-w-[1000px] mx-auto space-y-8">
      <div>
        <div className="data-label">SETTINGS</div>
        <h1 className="text-2xl font-semibold text-graphite-100 mt-1">System &amp; database</h1>
      </div>

      <Link href="/settings/users" className="panel p-5 flex items-center justify-between hover:border-signal/50 transition-colors block">
        <div>
          <div className="text-graphite-100 font-medium">User management</div>
          <div className="text-sm text-graphite-500 mt-0.5">Create accounts, assign roles, manage subsystem leadership.</div>
        </div>
        <span className="text-signal font-mono text-xs">MANAGE →</span>
      </Link>

      <Link href="/settings/audit-log" className="panel p-5 flex items-center justify-between hover:border-signal/50 transition-colors block">
        <div>
          <div className="text-graphite-100 font-medium">Audit log</div>
          <div className="text-sm text-graphite-500 mt-0.5">Full accountability trail — accounts, roles, approvals, purchasing, deletions.</div>
        </div>
        <span className="text-signal font-mono text-xs">VIEW →</span>
      </Link>

      <div className="grid sm:grid-cols-5 gap-4">
        {Object.entries(counts).map(([k, v]) => (
          <div key={k} className="panel p-4">
            <div className="data-label">{k.toUpperCase()}</div>
            <div className="stat-figure mt-1 text-2xl">{v}</div>
          </div>
        ))}
      </div>

      <div>
        <h2 className="text-sm font-medium text-graphite-200 mb-3">Recent activity</h2>
        <div className="panel divide-y divide-graphite-800">
          {recentActivity.map((a) => (
            <div key={a.id} className="p-3.5 flex items-center justify-between text-sm">
              <span className="text-graphite-300">
                <span className="text-graphite-100">{a.user_name || "System"}</span> {a.action.toLowerCase()}d{" "}
                {a.entity_type.toLowerCase()} <span className="font-mono text-xs text-graphite-500">{a.details}</span>
              </span>
              <span className="font-mono text-[11px] text-graphite-500 shrink-0 ml-3">{a.created_at}</span>
            </div>
          ))}
          {recentActivity.length === 0 && <p className="p-4 text-sm text-graphite-500">No activity logged yet.</p>}
        </div>
      </div>
    </div>
  );
}

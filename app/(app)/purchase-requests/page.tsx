import Link from "next/link";
import { getDb } from "@/lib/db";
import { StatusBadge, ImportanceBadge } from "@/components/StatusBadge";

export default async function PurchaseRequestsPage({ searchParams }: { searchParams: { status?: string } }) {
  const db = getDb();
  let sql = `
    SELECT pr.*, u.name as requesting_user_name, s.name as subsystem_name
    FROM purchase_requests pr JOIN users u ON u.id = pr.requesting_user_id
    LEFT JOIN subsystems s ON s.id = pr.subsystem_id WHERE 1=1
  `;
  const params: any[] = [];
  if (searchParams.status) {
    sql += ` AND pr.status = ?`;
    params.push(searchParams.status);
  }
  sql += ` ORDER BY pr.created_at DESC`;
  const requests = db.prepare(sql).all(...params) as any[];

  const STATUSES = ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED", "CANCELLED", "CONVERTED_TO_PO"];

  return (
    <div className="p-6 md:p-8 max-w-[1200px] mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="data-label">PURCHASE REQUESTS</div>
          <h1 className="text-2xl font-semibold text-graphite-100 mt-1">{requests.length} requests</h1>
        </div>
        <Link href="/purchase-requests/new" className="btn-primary">
          + New request
        </Link>
      </div>

      <div className="flex gap-2 text-xs font-mono flex-wrap">
        <Link href="/purchase-requests" className={`px-2.5 py-1.5 rounded-sm border ${!searchParams.status ? "border-signal text-signal" : "border-graphite-700 text-graphite-400"}`}>
          ALL
        </Link>
        {STATUSES.map((s) => (
          <Link key={s} href={`/purchase-requests?status=${s}`} className={`px-2.5 py-1.5 rounded-sm border ${searchParams.status === s ? "border-signal text-signal" : "border-graphite-700 text-graphite-400"}`}>
            {s.replace(/_/g, " ")}
          </Link>
        ))}
      </div>

      <div className="panel divide-y divide-graphite-800">
        {requests.map((r) => (
          <Link key={r.id} href={`/purchase-requests/${r.id}`} className="flex items-center justify-between p-4 hover:bg-graphite-850/60 gap-4 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-[11px] text-graphite-500">{r.request_number}</span>
                <span className="text-sm text-graphite-100">{r.item_name}</span>
                <ImportanceBadge importance={r.priority} />
              </div>
              <div className="font-mono text-[11px] text-graphite-500 mt-1">
                {r.requesting_user_name} · {r.subsystem_name || "No team"}
                {r.estimated_cost != null ? ` · $${r.estimated_cost.toLocaleString()}` : ""}
              </div>
            </div>
            <StatusBadge status={r.status} />
          </Link>
        ))}
        {requests.length === 0 && <div className="p-6 text-sm text-graphite-500">No purchase requests yet.</div>}
      </div>
    </div>
  );
}

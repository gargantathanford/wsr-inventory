import Link from "next/link";
import { getDb } from "@/lib/db";
import { StatusBadge } from "@/components/StatusBadge";
import { getSession } from "@/lib/auth";

export default async function PurchaseOrdersPage({ searchParams }: { searchParams: { status?: string } }) {
  const user = await getSession();
  const db = getDb();
  let sql = `
    SELECT po.*, s.name as subsystem_name FROM purchase_orders po LEFT JOIN subsystems s ON s.id = po.subsystem_id WHERE 1=1
  `;
  const params: any[] = [];
  if (searchParams.status) {
    sql += ` AND po.status = ?`;
    params.push(searchParams.status);
  }
  sql += ` ORDER BY po.created_at DESC`;
  const orders = db.prepare(sql).all(...params) as any[];
  const withTotals = orders.map((o) => {
    const total = (
      db.prepare(`SELECT SUM(quantity * unit_cost) as t FROM po_line_items WHERE purchase_order_id = ?`).get(o.id) as { t: number | null }
    ).t;
    return { ...o, total_cost: total || 0 };
  });

  const STATUSES = ["DRAFT", "AWAITING_APPROVAL", "APPROVED", "ORDERED", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED", "CANCELLED"];

  return (
    <div className="p-6 md:p-8 max-w-[1200px] mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="data-label">PURCHASE ORDERS</div>
          <h1 className="text-2xl font-semibold text-graphite-100 mt-1">{withTotals.length} orders</h1>
        </div>
        {/* Hidden for team members: the API refuses them and the page now
            redirects them to a Purchase Request, so showing the button would
            only invite a wasted trip through the form. */}
        {user?.role !== "TEAM_MEMBER" ? (
          <Link href="/purchase-orders/new" className="btn-primary">
            + New Purchase Order
          </Link>
        ) : (
          <Link href="/purchase-requests/new" className="btn-primary">
            + New Purchase Request
          </Link>
        )}
      </div>

      <div className="flex gap-2 text-xs font-mono flex-wrap">
        <Link href="/purchase-orders" className={`px-2.5 py-1.5 rounded-sm border ${!searchParams.status ? "border-signal text-signal" : "border-graphite-700 text-graphite-400"}`}>
          ALL
        </Link>
        {STATUSES.map((s) => (
          <Link key={s} href={`/purchase-orders?status=${s}`} className={`px-2.5 py-1.5 rounded-sm border ${searchParams.status === s ? "border-signal text-signal" : "border-graphite-700 text-graphite-400"}`}>
            {s.replace(/_/g, " ")}
          </Link>
        ))}
      </div>

      <div className="panel overflow-x-auto">
        <table className="table-shell min-w-[800px]">
          <thead>
            <tr>
              <th>PO Number</th>
              <th>Vendor</th>
              <th>Team</th>
              <th className="text-right">Total</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {withTotals.map((o) => (
              <tr key={o.id}>
                <td>
                  <Link href={`/purchase-orders/${o.id}`} className="text-graphite-100 hover:text-signal font-mono text-sm">
                    {o.po_number}
                  </Link>
                </td>
                <td className="text-xs text-graphite-400">{o.vendor || "—"}</td>
                <td className="text-xs text-graphite-400">{o.subsystem_name || "—"}</td>
                <td className="text-right font-mono text-xs text-graphite-300">${o.total_cost.toLocaleString()}</td>
                <td>
                  <StatusBadge status={o.status} />
                </td>
              </tr>
            ))}
            {withTotals.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center py-8 text-graphite-500">
                  No purchase orders yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getSession, canReviewSubsystem } from "@/lib/auth";
import { StatusBadge } from "@/components/StatusBadge";
import { PurchaseOrderActions } from "@/components/PurchaseOrderActions";

export default async function PurchaseOrderDetailPage({ params }: { params: { id: string } }) {
  const db = getDb();
  const order = db
    .prepare(
      `SELECT po.*, s.name as subsystem_name, c.name as created_by_name, a.name as approved_by_name
       FROM purchase_orders po
       LEFT JOIN subsystems s ON s.id = po.subsystem_id
       LEFT JOIN users c ON c.id = po.created_by
       LEFT JOIN users a ON a.id = po.approved_by
       WHERE po.id = ?`
    )
    .get(params.id) as any;
  if (!order) notFound();

  const lineItems = db.prepare(`SELECT * FROM po_line_items WHERE purchase_order_id = ?`).all(params.id) as any[];
  const receipts = db
    .prepare(`SELECT r.*, u.name as received_by_name FROM po_receipts r LEFT JOIN users u ON u.id = r.received_by WHERE r.purchase_order_id = ? ORDER BY r.date_received DESC`)
    .all(params.id) as any[];
  const totalCost = lineItems.reduce((sum, l) => sum + l.quantity * l.unit_cost, 0);

  const user = await getSession();
  const canEdit = !!user && (canReviewSubsystem(user, order.subsystem_id) || user.role === "ADMIN" || user.role === "CHIEF_ENGINEER");

  return (
    <div className="p-6 md:p-8 max-w-[900px] mx-auto space-y-8">
      <Link href="/purchase-orders" className="text-xs font-mono text-graphite-500 hover:text-graphite-200">
        ← PURCHASE ORDERS
      </Link>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="data-label">{order.po_number}</div>
          <h1 className="text-2xl font-semibold text-graphite-100 mt-1">{order.vendor || "Purchase Order"}</h1>
          <div className="mt-2">
            <StatusBadge status={order.status} />
          </div>
        </div>
        {order.purchase_request_id && (
          <Link href={`/purchase-requests/${order.purchase_request_id}`} className="btn-ghost text-xs">
            View originating request →
          </Link>
        )}
      </div>

      <div className="grid sm:grid-cols-2 gap-6 text-sm">
        <Row label="Responsible team" value={order.subsystem_name || "—"} />
        <Row label="Budget category" value={order.budget_category || "—"} />
        <Row label="Created by" value={order.created_by_name || "—"} />
        <Row label="Approved by" value={order.approved_by_name ? `${order.approved_by_name} on ${order.approved_at?.slice(0, 10)}` : "—"} />
        <Row label="Payment status" value={order.payment_status} />
        <Row label="Tracking number" value={order.tracking_number || "—"} />
        <Row label="Expected delivery" value={order.expected_delivery_date || "—"} />
        <Row label="Actual delivery" value={order.actual_delivery_date || "—"} />
      </div>

      <div>
        <div className="data-label mb-2">LINE ITEMS</div>
        <div className="panel overflow-x-auto">
          <table className="table-shell min-w-[700px]">
            <thead>
              <tr>
                <th>Item</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Unit cost</th>
                <th className="text-right">Total</th>
                <th className="text-right">Received</th>
              </tr>
            </thead>
            <tbody>
              {lineItems.map((l) => (
                <tr key={l.id}>
                  <td>
                    <div className="text-graphite-100 text-sm">{l.item_name}</div>
                    {l.description && <div className="text-xs text-graphite-500">{l.description}</div>}
                  </td>
                  <td className="text-right font-mono text-xs text-graphite-300">{l.quantity}</td>
                  <td className="text-right font-mono text-xs text-graphite-300">${l.unit_cost.toLocaleString()}</td>
                  <td className="text-right font-mono text-xs text-graphite-300">${(l.quantity * l.unit_cost).toLocaleString()}</td>
                  <td className="text-right font-mono text-xs text-graphite-300">
                    {l.received_quantity}/{l.quantity}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="p-3 text-right font-mono text-sm text-graphite-200 border-t border-graphite-800">
            Total: <span className="text-signal font-semibold">${totalCost.toLocaleString()}</span>
          </div>
        </div>
      </div>

      <div className="panel p-5">
        <div className="data-label mb-3">ACTIONS</div>
        <PurchaseOrderActions order={{ ...order, line_items: lineItems }} canEdit={canEdit} />
      </div>

      {receipts.length > 0 && (
        <div>
          <div className="data-label mb-2">RECEIVING LOG</div>
          <div className="panel divide-y divide-graphite-800">
            {receipts.map((r) => (
              <div key={r.id} className="p-3 text-sm flex items-center justify-between">
                <span className="text-graphite-300">
                  {r.quantity_received}x received ({r.condition.replace(/_/g, " ")}) by {r.received_by_name}
                  {r.storage_location ? ` → ${r.storage_location}` : ""}
                </span>
                <span className="font-mono text-[11px] text-graphite-500">{r.date_received?.slice(0, 16).replace("T", " ")}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-graphite-800 pb-2">
      <span className="text-graphite-500">{label}</span>
      <span className="text-graphite-200">{value}</span>
    </div>
  );
}

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";
import { getSession, canReviewSubsystem } from "@/lib/auth";

function getOrder(id: string) {
  const db = getDb();
  const po = db
    .prepare(
      `SELECT po.*, s.name as subsystem_name, c.name as created_by_name, a.name as approved_by_name
       FROM purchase_orders po
       LEFT JOIN subsystems s ON s.id = po.subsystem_id
       LEFT JOIN users c ON c.id = po.created_by
       LEFT JOIN users a ON a.id = po.approved_by
       WHERE po.id = ?`
    )
    .get(id) as any;
  if (!po) return null;
  const lineItems = db.prepare(`SELECT * FROM po_line_items WHERE purchase_order_id = ?`).all(id) as any[];
  const receipts = db
    .prepare(
      `SELECT r.*, u.name as received_by_name FROM po_receipts r LEFT JOIN users u ON u.id = r.received_by WHERE r.purchase_order_id = ? ORDER BY r.date_received DESC`
    )
    .all(id);
  const totalCost = lineItems.reduce((sum, i) => sum + i.quantity * i.unit_cost, 0);
  return { ...po, line_items: lineItems, receipts, total_cost: totalCost };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const order = getOrder(params.id);
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ order });
}

const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["AWAITING_APPROVAL", "CANCELLED"],
  AWAITING_APPROVAL: ["APPROVED", "CANCELLED"],
  APPROVED: ["ORDERED", "CANCELLED"],
  ORDERED: ["PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"],
  PARTIALLY_RECEIVED: ["RECEIVED"],
  RECEIVED: ["CLOSED"],
  CLOSED: [],
  CANCELLED: []
};

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const order = getOrder(params.id);
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canReviewSubsystem(user, order.subsystem_id) && user.role !== "ADMIN" && user.role !== "CHIEF_ENGINEER") {
    return NextResponse.json({ error: "You do not have edit access to this Purchase Order." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const db = getDb();

  if (body.status) {
    const allowed = VALID_TRANSITIONS[order.status] || [];
    if (!allowed.includes(body.status)) {
      return NextResponse.json({ error: `Cannot move from ${order.status} to ${body.status}.` }, { status: 400 });
    }
    const isApproval = body.status === "APPROVED";
    db.prepare(
      `UPDATE purchase_orders SET
        status = ?,
        approved_by = CASE WHEN ? THEN ? ELSE approved_by END,
        approved_at = CASE WHEN ? THEN datetime('now') ELSE approved_at END,
        date_ordered = CASE WHEN ? THEN date_ordered ELSE date_ordered END,
        updated_at = datetime('now')
       WHERE id = ?`
    ).run(body.status, isApproval ? 1 : 0, user.id, isApproval ? 1 : 0, 0, params.id);

    db.prepare(
      `INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, 'UPDATE', 'PURCHASE_ORDER', ?, ?)`
    ).run(newId("log"), user.id, params.id, `${order.status} -> ${body.status}`);

    return NextResponse.json({ ok: true });
  }

  const editable = [
    "vendor",
    "date_ordered",
    "expected_delivery_date",
    "actual_delivery_date",
    "budget_category",
    "payment_status",
    "tracking_number",
    "vendor_order_number",
    "notes"
  ];
  const updates: Record<string, any> = {};
  for (const f of editable) if (f in body) updates[f] = body[f];
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: "No valid fields." }, { status: 400 });
  const setClause = Object.keys(updates).map((k) => `${k} = @${k}`).join(", ");
  db.prepare(`UPDATE purchase_orders SET ${setClause}, updated_at = datetime('now') WHERE id = @id`).run({ ...updates, id: params.id });

  db.prepare(
    `INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, 'UPDATE', 'PURCHASE_ORDER', ?, ?)`
  ).run(newId("log"), user.id, params.id, JSON.stringify(Object.keys(updates)));

  return NextResponse.json({ ok: true });
}

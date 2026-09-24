import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";
import { getSession, canReviewSubsystem } from "@/lib/auth";

const ReceiveInput = z.object({
  line_item_id: z.string().min(1),
  quantity_received: z.coerce.number().int().min(1),
  condition: z.enum(["GOOD", "DAMAGED", "INCORRECT_ITEM"]).default("GOOD"),
  storage_location: z.string().optional().nullable(),
  notes: z.string().optional().nullable()
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  const order = db.prepare(`SELECT * FROM purchase_orders WHERE id = ?`).get(params.id) as any;
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canReviewSubsystem(user, order.subsystem_id) && user.role !== "ADMIN" && user.role !== "CHIEF_ENGINEER") {
    return NextResponse.json({ error: "You do not have access to receive against this Purchase Order." }, { status: 403 });
  }
  if (!["ORDERED", "PARTIALLY_RECEIVED"].includes(order.status)) {
    return NextResponse.json({ error: "This order is not in a receivable state." }, { status: 400 });
  }

  const parsed = ReceiveInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const data = parsed.data;

  const lineItem = db.prepare(`SELECT * FROM po_line_items WHERE id = ? AND purchase_order_id = ?`).get(data.line_item_id, params.id) as any;
  if (!lineItem) return NextResponse.json({ error: "Line item not found on this order." }, { status: 404 });

  db.prepare(
    `INSERT INTO po_receipts (id, purchase_order_id, line_item_id, quantity_received, condition, received_by, storage_location, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(newId("rcpt"), params.id, data.line_item_id, data.quantity_received, data.condition, user.id, data.storage_location ?? null, data.notes ?? null);

  db.prepare(`UPDATE po_line_items SET received_quantity = received_quantity + ? WHERE id = ?`).run(data.quantity_received, data.line_item_id);

  // Auto-roll the PO status based on whether every line item is now fully received.
  const lineItems = db.prepare(`SELECT quantity, received_quantity FROM po_line_items WHERE purchase_order_id = ?`).all(params.id) as {
    quantity: number;
    received_quantity: number;
  }[];
  const fullyReceived = lineItems.every((i) => i.received_quantity >= i.quantity);
  const anyReceived = lineItems.some((i) => i.received_quantity > 0);
  const newStatus = fullyReceived ? "RECEIVED" : anyReceived ? "PARTIALLY_RECEIVED" : order.status;

  db.prepare(
    `UPDATE purchase_orders SET status = ?, actual_delivery_date = CASE WHEN ? THEN date('now') ELSE actual_delivery_date END, updated_at = datetime('now') WHERE id = ?`
  ).run(newStatus, fullyReceived ? 1 : 0, params.id);

  db.prepare(
    `INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, 'RECEIVE', 'PURCHASE_ORDER', ?, ?)`
  ).run(newId("log"), user.id, params.id, `${data.quantity_received}x ${lineItem.item_name}`);

  return NextResponse.json({ ok: true, status: newStatus });
}

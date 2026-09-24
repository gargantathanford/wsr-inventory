import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";
import { getSession, canReviewSubsystem } from "@/lib/auth";
import { generatePoNumber } from "@/lib/numbering";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  const request = db.prepare(`SELECT * FROM purchase_requests WHERE id = ?`).get(params.id) as any;
  if (!request) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (request.status !== "APPROVED") {
    return NextResponse.json({ error: "Only an approved request can be converted to a Purchase Order." }, { status: 400 });
  }
  if (!canReviewSubsystem(user, request.subsystem_id)) {
    return NextResponse.json({ error: "You cannot create purchase orders for this team." }, { status: 403 });
  }

  const poId = newId("po");
  const poNumber = generatePoNumber();

  db.prepare(
    `INSERT INTO purchase_orders (id, po_number, purchase_request_id, vendor, subsystem_id, created_by, status)
     VALUES (?, ?, ?, ?, ?, ?, 'DRAFT')`
  ).run(poId, poNumber, request.id, request.vendor, request.subsystem_id, user.id);

  db.prepare(
    `INSERT INTO po_line_items (id, purchase_order_id, item_name, description, quantity, unit_cost, product_link, part_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    newId("poli"),
    poId,
    request.item_name,
    request.item_description,
    request.quantity,
    request.estimated_cost ? request.estimated_cost / Math.max(request.quantity, 1) : 0,
    request.product_link,
    request.part_id
  );

  db.prepare(
    `UPDATE purchase_requests SET status = 'CONVERTED_TO_PO', purchase_order_id = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(poId, request.id);

  db.prepare(
    `INSERT INTO purchase_request_events (id, request_id, user_id, event_type, from_status, to_status, comment) VALUES (?, ?, ?, 'STATUS_CHANGE', 'APPROVED', 'CONVERTED_TO_PO', ?)`
  ).run(newId("prev"), request.id, user.id, `Converted to ${poNumber}`);

  db.prepare(
    `INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, 'CREATE', 'PURCHASE_ORDER', ?, ?)`
  ).run(newId("log"), user.id, poId, poNumber);

  return NextResponse.json({ id: poId, po_number: poNumber }, { status: 201 });
}

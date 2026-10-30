import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";
import { getSession, canReviewSubsystem } from "@/lib/auth";
import { invalid, dbError, optionalRef, optionalText } from "@/lib/apiValidation";

const LineItemInput = z.object({
  item_name: z.string().min(1),
  description: z.string().optional().nullable(),
  quantity: z.coerce.number().int().min(1).default(1),
  unit_cost: z.coerce.number().min(0).default(0),
  product_link: z.string().optional().nullable()
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  const order = db.prepare(`SELECT * FROM purchase_orders WHERE id = ?`).get(params.id) as any;
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canReviewSubsystem(user, order.subsystem_id) && user.role !== "ADMIN" && user.role !== "CHIEF_ENGINEER") {
    return NextResponse.json({ error: "You do not have edit access to this Purchase Order." }, { status: 403 });
  }
  if (order.status !== "DRAFT") {
    return NextResponse.json({ error: "Line items can only be added while the order is in Draft." }, { status: 400 });
  }

  const parsed = LineItemInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalid(parsed.error);
  const data = parsed.data;

  db.prepare(
    `INSERT INTO po_line_items (id, purchase_order_id, item_name, description, quantity, unit_cost, product_link)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(newId("poli"), params.id, data.item_name, data.description ?? null, data.quantity, data.unit_cost, data.product_link ?? null);

  return NextResponse.json({ ok: true }, { status: 201 });
}

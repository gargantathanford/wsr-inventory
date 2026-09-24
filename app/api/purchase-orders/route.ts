import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";
import { getSession, canReviewSubsystem } from "@/lib/auth";
import { generatePoNumber } from "@/lib/numbering";

function computeTotals(poId: string) {
  const db = getDb();
  const items = db.prepare(`SELECT quantity, unit_cost FROM po_line_items WHERE purchase_order_id = ?`).all(poId) as {
    quantity: number;
    unit_cost: number;
  }[];
  return items.reduce((sum, i) => sum + i.quantity * i.unit_cost, 0);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const db = getDb();
  let sql = `
    SELECT po.*, s.name as subsystem_name, c.name as created_by_name, a.name as approved_by_name
    FROM purchase_orders po
    LEFT JOIN subsystems s ON s.id = po.subsystem_id
    LEFT JOIN users c ON c.id = po.created_by
    LEFT JOIN users a ON a.id = po.approved_by
    WHERE 1=1
  `;
  const params: any[] = [];
  const status = searchParams.get("status");
  if (status) {
    sql += ` AND po.status = ?`;
    params.push(status);
  }
  sql += ` ORDER BY po.created_at DESC`;
  const orders = db.prepare(sql).all(...params) as any[];
  return NextResponse.json({
    orders: orders.map((o) => ({ ...o, total_cost: computeTotals(o.id) }))
  });
}

const LineItemInput = z.object({
  item_name: z.string().min(1),
  description: z.string().optional().nullable(),
  quantity: z.coerce.number().int().min(1).default(1),
  unit_cost: z.coerce.number().min(0).default(0),
  product_link: z.string().optional().nullable()
});

const OrderInput = z.object({
  vendor: z.string().optional().nullable(),
  subsystem_id: z.string().optional().nullable(),
  budget_category: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  line_items: z.array(LineItemInput).min(1)
});

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role === "TEAM_MEMBER") {
    return NextResponse.json({ error: "Team members cannot create Purchase Orders directly — submit a Purchase Request instead." }, { status: 403 });
  }

  const parsed = OrderInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const data = parsed.data;

  if (data.subsystem_id && !canReviewSubsystem(user, data.subsystem_id)) {
    return NextResponse.json({ error: "You do not lead this subsystem." }, { status: 403 });
  }

  const db = getDb();
  const id = newId("po");
  const poNumber = generatePoNumber();

  db.prepare(
    `INSERT INTO purchase_orders (id, po_number, vendor, subsystem_id, budget_category, notes, created_by, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'DRAFT')`
  ).run(id, poNumber, data.vendor ?? null, data.subsystem_id ?? null, data.budget_category ?? null, data.notes ?? null, user.id);

  const insertLine = db.prepare(
    `INSERT INTO po_line_items (id, purchase_order_id, item_name, description, quantity, unit_cost, product_link)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const item of data.line_items) {
    insertLine.run(newId("poli"), id, item.item_name, item.description ?? null, item.quantity, item.unit_cost, item.product_link ?? null);
  }

  db.prepare(
    `INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, 'CREATE', 'PURCHASE_ORDER', ?, ?)`
  ).run(newId("log"), user.id, id, poNumber);

  return NextResponse.json({ id, po_number: poNumber }, { status: 201 });
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";
import { getSession } from "@/lib/auth";
import { generateRequestNumber } from "@/lib/numbering";
import { invalid, dbError, optionalRef, optionalText } from "@/lib/apiValidation";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const db = getDb();
  let sql = `
    SELECT pr.*, u.name as requesting_user_name, s.name as subsystem_name, d.name as decided_by_name
    FROM purchase_requests pr
    JOIN users u ON u.id = pr.requesting_user_id
    LEFT JOIN subsystems s ON s.id = pr.subsystem_id
    LEFT JOIN users d ON d.id = pr.decided_by
    WHERE 1=1
  `;
  const params: any[] = [];
  const status = searchParams.get("status");
  if (status) {
    sql += ` AND pr.status = ?`;
    params.push(status);
  }
  const subsystemId = searchParams.get("subsystem");
  if (subsystemId) {
    sql += ` AND pr.subsystem_id = ?`;
    params.push(subsystemId);
  }
  sql += ` ORDER BY pr.created_at DESC`;
  const requests = db.prepare(sql).all(...params);
  return NextResponse.json({ requests });
}

const RequestInput = z.object({
  subsystem_id: optionalRef.optional(),
  part_id: optionalRef.optional(),
  item_name: z.string().min(1),
  item_description: z.string().optional().nullable(),
  quantity: z.coerce.number().int().min(1).default(1),
  estimated_cost: z.coerce.number().optional().nullable(),
  vendor: z.string().optional().nullable(),
  product_link: z.string().optional().nullable(),
  justification: z.string().optional().nullable(),
  project_association: z.string().optional().nullable(),
  required_date: z.string().optional().nullable(),
  priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).default("MEDIUM"),
  submit: z.boolean().default(false)
});

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = RequestInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalid(parsed.error);
  const data = parsed.data;

  const db = getDb();
  const id = newId("pr");
  const requestNumber = generateRequestNumber();
  const status = data.submit ? "SUBMITTED" : "DRAFT";

  db.prepare(
    `INSERT INTO purchase_requests (
      id, request_number, requesting_user_id, subsystem_id, part_id, item_name, item_description,
      quantity, estimated_cost, vendor, product_link, justification, project_association,
      required_date, priority, status, submitted_at
    ) VALUES (@id, @request_number, @requesting_user_id, @subsystem_id, @part_id, @item_name, @item_description,
      @quantity, @estimated_cost, @vendor, @product_link, @justification, @project_association,
      @required_date, @priority, @status, @submitted_at)`
  ).run({
    id,
    request_number: requestNumber,
    requesting_user_id: user.id,
    subsystem_id: data.subsystem_id ?? null,
    part_id: data.part_id ?? null,
    item_name: data.item_name,
    item_description: data.item_description ?? null,
    quantity: data.quantity,
    estimated_cost: data.estimated_cost ?? null,
    vendor: data.vendor ?? null,
    product_link: data.product_link ?? null,
    justification: data.justification ?? null,
    project_association: data.project_association ?? null,
    required_date: data.required_date ?? null,
    priority: data.priority,
    status,
    submitted_at: data.submit ? new Date().toISOString() : null
  });

  db.prepare(
    `INSERT INTO purchase_request_events (id, request_id, user_id, event_type, from_status, to_status) VALUES (?, ?, ?, 'STATUS_CHANGE', NULL, ?)`
  ).run(newId("prev"), id, user.id, status);

  db.prepare(
    `INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, 'CREATE', 'PURCHASE_REQUEST', ?, ?)`
  ).run(newId("log"), user.id, id, requestNumber);

  return NextResponse.json({ id, request_number: requestNumber }, { status: 201 });
}

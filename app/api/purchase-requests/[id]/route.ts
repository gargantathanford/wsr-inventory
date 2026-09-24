import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";
import { getSession, canReviewSubsystem } from "@/lib/auth";

function getRequest(id: string) {
  const db = getDb();
  return db
    .prepare(
      `SELECT pr.*, u.name as requesting_user_name, s.name as subsystem_name, d.name as decided_by_name
       FROM purchase_requests pr
       JOIN users u ON u.id = pr.requesting_user_id
       LEFT JOIN subsystems s ON s.id = pr.subsystem_id
       LEFT JOIN users d ON d.id = pr.decided_by
       WHERE pr.id = ?`
    )
    .get(id) as any;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const request = getRequest(params.id);
  if (!request) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const db = getDb();
  const events = db
    .prepare(
      `SELECT e.*, u.name as user_name FROM purchase_request_events e LEFT JOIN users u ON u.id = e.user_id
       WHERE e.request_id = ? ORDER BY e.created_at ASC`
    )
    .all(params.id);
  return NextResponse.json({ request: { ...request, events } });
}

const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["SUBMITTED", "CANCELLED"],
  SUBMITTED: ["UNDER_REVIEW", "APPROVED", "REJECTED", "CANCELLED"],
  UNDER_REVIEW: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["CONVERTED_TO_PO", "CANCELLED"],
  REJECTED: [],
  CANCELLED: [],
  CONVERTED_TO_PO: []
};

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const request = getRequest(params.id);
  if (!request) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const db = getDb();

  // Requester can submit or cancel their own draft/submitted request.
  const isOwner = request.requesting_user_id === user.id;
  const isApprover = canReviewSubsystem(user, request.subsystem_id);

  if (body.status) {
    const allowed = VALID_TRANSITIONS[request.status] || [];
    if (!allowed.includes(body.status)) {
      return NextResponse.json({ error: `Cannot move from ${request.status} to ${body.status}.` }, { status: 400 });
    }
    const approverOnlyTransitions = new Set(["UNDER_REVIEW", "APPROVED", "REJECTED"]);
    if (approverOnlyTransitions.has(body.status) && !isApprover) {
      return NextResponse.json({ error: "Only the relevant Team Lead, Chief Engineer, or Admin can decide this request." }, { status: 403 });
    }
    if (!approverOnlyTransitions.has(body.status) && !isOwner && !isApprover) {
      return NextResponse.json({ error: "You cannot modify this request." }, { status: 403 });
    }

    const isDecision = approverOnlyTransitions.has(body.status) && (body.status === "APPROVED" || body.status === "REJECTED");
    db.prepare(
      `UPDATE purchase_requests SET
        status = ?,
        decided_by = CASE WHEN ? THEN ? ELSE decided_by END,
        decided_at = CASE WHEN ? THEN datetime('now') ELSE decided_at END,
        decision_note = CASE WHEN ? THEN ? ELSE decision_note END,
        submitted_at = CASE WHEN ? THEN datetime('now') ELSE submitted_at END,
        updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      body.status,
      isDecision ? 1 : 0,
      user.id,
      isDecision ? 1 : 0,
      isDecision ? 1 : 0,
      body.decision_note || null,
      body.status === "SUBMITTED" ? 1 : 0,
      params.id
    );

    db.prepare(
      `INSERT INTO purchase_request_events (id, request_id, user_id, event_type, from_status, to_status, comment) VALUES (?, ?, ?, 'STATUS_CHANGE', ?, ?, ?)`
    ).run(newId("prev"), params.id, user.id, request.status, body.status, body.decision_note || null);

    db.prepare(
      `INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, 'PURCHASE_REQUEST', ?, ?)`
    ).run(newId("log"), user.id, body.status === "APPROVED" ? "APPROVE" : body.status === "REJECTED" ? "REJECT" : "UPDATE", params.id, `${request.status} -> ${body.status}`);

    return NextResponse.json({ ok: true });
  }

  // Non-status edits (draft only, owner only)
  if (request.status !== "DRAFT" || !isOwner) {
    return NextResponse.json({ error: "Only the requester can edit a draft request." }, { status: 403 });
  }
  const editable = ["item_name", "item_description", "quantity", "estimated_cost", "vendor", "product_link", "justification", "project_association", "required_date", "priority", "subsystem_id"];
  const updates: Record<string, any> = {};
  for (const f of editable) if (f in body) updates[f] = body[f];
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: "No valid fields." }, { status: 400 });
  const setClause = Object.keys(updates).map((k) => `${k} = @${k}`).join(", ");
  db.prepare(`UPDATE purchase_requests SET ${setClause}, updated_at = datetime('now') WHERE id = @id`).run({ ...updates, id: params.id });
  return NextResponse.json({ ok: true });
}

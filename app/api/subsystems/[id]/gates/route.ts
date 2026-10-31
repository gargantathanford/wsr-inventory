import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { invalid, dbError, optionalRef, optionalText } from "@/lib/apiValidation";
import {
  getReadiness,
  endorseGate,
  approveGate,
  reopenGate,
  withdrawEndorsement,
  markNotApplicable,
  declarePartListComplete,
  type WriteResult
} from "@/lib/readiness/store";
import type { GateId } from "@/lib/readiness/gates";

/**
 * Gate sign-offs for one subsystem.
 *
 *   GET  /api/subsystems/{id}/gates          -> every gate, its state and why
 *   POST /api/subsystems/{id}/gates          -> endorse | approve | reopen |
 *                                               not-applicable | declare-scope
 *
 * Every refusal carries the REASON from the pure predicates in gates.ts, not a
 * bare 403. "Only the Chief Engineer can approve a gate — endorse it instead
 * and it will go to them" tells a lead what to do next; 403 tells them the
 * software is broken.
 */

const GATE_IDS = [
  "SCOPED", "DESIGN_FROZEN", "RULES_CHECKED", "INTERFACES_AGREED",
  "PROCURED", "MANUFACTURED", "INSTALLED", "TESTED"
] as const;

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ readiness: getReadiness(params.id) });
  } catch (e) {
    return dbError(e, "Could not read gates");
  }
}

const Action = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("endorse"),
    gate: z.enum(GATE_IDS),
    note: optionalText.optional(),
    evidence_document_id: optionalRef.optional()
  }),
  z.object({
    action: z.literal("approve"),
    gate: z.enum(GATE_IDS),
    note: optionalText.optional()
  }),
  z.object({
    action: z.literal("withdraw"),
    gate: z.enum(GATE_IDS)
  }),
  z.object({
    action: z.literal("reopen"),
    gate: z.enum(GATE_IDS),
    // Required, and the minimum length is enforced in the store so the message
    // is identical whichever way the call arrives.
    reason: z.string()
  }),
  z.object({
    action: z.literal("not-applicable"),
    gate: z.enum(GATE_IDS),
    reason: z.string()
  }),
  z.object({
    action: z.literal("declare-scope"),
    complete: z.boolean()
  })
]);

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = Action.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalid(parsed.error, "Could not record that");
  const body = parsed.data;

  try {
    let result: WriteResult;
    switch (body.action) {
      case "endorse":
        result = endorseGate(
          params.id, body.gate as GateId, user,
          body.note ?? null, body.evidence_document_id ?? null
        );
        break;
      case "approve":
        result = approveGate(params.id, body.gate as GateId, user, body.note ?? null);
        break;
      case "withdraw":
        result = withdrawEndorsement(params.id, body.gate as GateId, user);
        break;
      case "reopen":
        result = reopenGate(params.id, body.gate as GateId, user, body.reason);
        break;
      case "not-applicable":
        result = markNotApplicable(params.id, body.gate as GateId, user, body.reason);
        break;
      case "declare-scope":
        result = declarePartListComplete(params.id, user, body.complete);
        break;
    }

    // 422 rather than 403: the request was understood and the person is
    // authenticated — it is the state of the work, or their role, that makes it
    // wrong, and the body says which.
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 422 });

    return NextResponse.json({ readiness: getReadiness(params.id) });
  } catch (e) {
    return dbError(e, "Could not record that");
  }
}

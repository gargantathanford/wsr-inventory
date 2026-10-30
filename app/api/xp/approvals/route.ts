import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession, isLeadership } from "@/lib/auth";
import { approve, getPendingApprovals, rejectAward } from "@/lib/xp/store";
import { invalid, dbError, optionalRef, optionalText } from "@/lib/apiValidation";

/**
 * The approval queue for heavily-weighted awards.
 *
 *   GET  /api/xp/approvals          -> pending awards, excluding your own
 *   POST /api/xp/approvals          -> { event_id, action: "approve" | "reject", note? }
 *
 * Leadership only. Your own awards never appear in your queue, and the store
 * refuses self-approval even if a request reaches it — an approval tier that
 * someone can clear for themselves is not a tier.
 */
export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isLeadership(user)) {
    return NextResponse.json({ error: "Only leads, the Chief Engineer and admins review XP awards." }, { status: 403 });
  }
  return NextResponse.json({ pending: getPendingApprovals(user.id) });
}

const Decision = z.object({
  event_id: z.string().min(1),
  action: z.enum(["approve", "reject"]),
  note: z.string().max(500).optional()
});

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isLeadership(user)) {
    return NextResponse.json({ error: "Only leads, the Chief Engineer and admins review XP awards." }, { status: 403 });
  }

  const parsed = Decision.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalid(parsed.error);
  const { event_id, action, note } = parsed.data;

  if (action === "reject" && !note?.trim()) {
    // A rejected award without a reason is indistinguishable from a bug, and
    // the person whose points vanished deserves to know why.
    return NextResponse.json({ error: "Say why you are rejecting it." }, { status: 400 });
  }

  const ok =
    action === "approve" ? approve(event_id, user.id) : rejectAward(event_id, user.id, note!.trim());

  if (!ok) {
    return NextResponse.json(
      { error: "That award is not pending, or it is your own — you cannot approve your own XP." },
      { status: 409 }
    );
  }
  return NextResponse.json({ ok: true });
}

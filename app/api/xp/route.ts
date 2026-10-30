import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getStreak, getSubsystemXp, getTotals, getUserEvents, settleDeferred, TEAM_TIMEZONE } from "@/lib/xp/store";
import { XP_EVENTS } from "@/lib/xp/rules";

/**
 * A person's own XP, streak and full event history.
 *
 *   GET /api/xp              -> own totals, streak, recent ledger
 *   GET /api/xp?ledger=1     -> the complete event list, reversals included
 *   GET /api/xp?subsystems=1 -> per-subsystem rollup
 *
 * There is no way to read another individual's score through this route, and
 * that is deliberate: the team view compares SUBSYSTEMS, never individuals.
 * Publishing a per-person ranking punishes whoever got assigned the hardest
 * subsystem.
 */
export async function GET(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);

  if (searchParams.get("subsystems")) {
    return NextResponse.json({ subsystems: getSubsystemXp() });
  }

  // Deferred first-time-right awards are resolved on read rather than by a
  // background job — the payout depends on a task NOT being reopened, which is
  // a fact about the future. Cheap and idempotent.
  settleDeferred(user.id);

  const events = getUserEvents(user.id);
  const totals = getTotals(user.id);
  const streak = getStreak(user.id);

  const wantsFullLedger = !!searchParams.get("ledger");
  const ledger = (wantsFullLedger ? events : events.slice(0, 15)).map((e) => ({
    id: e.id,
    kind: e.kind,
    label: XP_EVENTS[e.kind]?.fires ?? e.kind,
    points: e.points,
    at: e.at,
    status: e.status,
    selfVerified: e.selfVerified,
    reverses: e.reverses,
    sourceType: e.sourceType,
    sourceId: e.sourceId,
    note: e.note
  }));

  return NextResponse.json({
    total: totals.total,
    pending: totals.pending,
    selfVerifiedCount: totals.selfVerifiedCount,
    reversedCount: totals.reversedCount,
    byKind: totals.byKind,
    streak: { current: streak.current, longest: streak.longest, graceDays: streak.graceDays },
    timeZone: TEAM_TIMEZONE,
    ledger,
    ledgerTruncated: !wantsFullLedger && events.length > 15
  });
}

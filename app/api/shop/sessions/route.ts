import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession, isLeadership } from "@/lib/auth";
import {
  closeSession,
  getOpenSession,
  getSessions,
  getTeamHours,
  openSession,
  voidStaleSessions
} from "@/lib/xp/store";
import { PRESENCE_XP_ENABLED, SHOP } from "@/lib/xp/rules";

/**
 * Shop check-in.
 *
 *   GET  /api/shop/sessions          -> your open session, your history
 *   GET  /api/shop/sessions?team=1   -> hours per person (leads only)
 *   POST /api/shop/sessions          -> { action: "open" | "close" }
 *
 * No verification in v1: no geofence, no door code, no co-presence. Hours are
 * self-reported, recorded, and award no XP — see PRESENCE_XP_ENABLED. The point
 * of v1 is to find out whether the hours are honest before building anything
 * to check them.
 */
export async function GET(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Swept on read, so the timesheet never shows a 40-hour open session merely
  // because no scheduled job has run.
  voidStaleSessions();

  const { searchParams } = new URL(req.url);

  if (searchParams.get("team")) {
    if (!isLeadership(user)) {
      return NextResponse.json({ error: "Leads, the Chief Engineer and admins only." }, { status: 403 });
    }
    const days = Math.min(Math.max(Number(searchParams.get("days")) || 30, 1), 365);
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    return NextResponse.json({ since, days, team: getTeamHours(since) });
  }

  const open = getOpenSession(user.id);
  return NextResponse.json({
    open: open ? { id: open.id, openedAt: open.opened_at } : null,
    sessions: getSessions(user.id, 30).map((s) => ({
      id: s.id,
      openedAt: s.opened_at,
      closedAt: s.closed_at,
      minutes: s.verified_minutes + s.unverified_minutes,
      state: s.state,
      note: s.correction_note
    })),
    presenceXpEnabled: PRESENCE_XP_ENABLED,
    autoVoidHour: SHOP.autoVoidHourLocal
  });
}

const Action = z.object({ action: z.enum(["open", "close"]) });

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = Action.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "action must be open or close" }, { status: 400 });

  if (parsed.data.action === "open") {
    const s = openSession(user.id);
    return NextResponse.json({ ok: true, open: { id: s.id, openedAt: s.opened_at } }, { status: 201 });
  }

  const closed = closeSession(user.id);
  if (!closed) return NextResponse.json({ error: "You have no open session." }, { status: 409 });
  return NextResponse.json({
    ok: true,
    minutes: closed.session.verified_minutes + closed.session.unverified_minutes,
    state: closed.session.state,
    reason: closed.reason
  });
}

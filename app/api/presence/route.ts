import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getPresenceSummary } from "@/lib/presence";

export async function GET() {
  const user = await getSession(); // also refreshes this caller's own last_active
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const summary = getPresenceSummary();
  return NextResponse.json({
    onlineCount: summary.onlineCount,
    awayCount: summary.awayCount
  });
}

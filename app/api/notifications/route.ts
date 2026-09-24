import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { generateNotifications } from "@/lib/notifications";

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const notifications = generateNotifications(user);
  return NextResponse.json({
    notifications: notifications.slice(0, 8),
    total: notifications.length,
    criticalCount: notifications.filter((n) => n.severity === "critical").length
  });
}

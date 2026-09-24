import Link from "next/link";
import { getSession } from "@/lib/auth";
import { generateNotifications } from "@/lib/notifications";

const SEVERITY_STYLE: Record<string, string> = {
  critical: "border-telemetry-red/40 bg-telemetry-red/5",
  warning: "border-telemetry-amber/40 bg-telemetry-amber/5",
  info: "border-telemetry-blue/40 bg-telemetry-blue/5"
};
const SEVERITY_DOT: Record<string, string> = {
  critical: "bg-telemetry-red",
  warning: "bg-telemetry-amber",
  info: "bg-telemetry-blue"
};
const CATEGORY_LABEL: Record<string, string> = {
  CRITICAL_PART: "Critical parts",
  LONG_LEAD_TIME: "Long lead times",
  LOW_INVENTORY: "Low inventory",
  TOOL_UNAVAILABLE: "Tools unavailable",
  TASK_REVIEW: "Tasks awaiting review",
  TASK_RETURNED: "Tasks returned to you",
  TASK_ASSIGNED: "New task assignments",
  DEADLINE_REMINDER: "Upcoming deadlines"
};

export default async function NotificationsPage() {
  const user = await getSession();
  const notifications = user ? generateNotifications(user) : [];
  const grouped = new Map<string, typeof notifications>();
  for (const n of notifications) {
    if (!grouped.has(n.category)) grouped.set(n.category, []);
    grouped.get(n.category)!.push(n);
  }

  return (
    <div className="p-6 md:p-8 max-w-[900px] mx-auto space-y-8">
      <div>
        <div className="data-label">NOTIFICATIONS</div>
        <h1 className="text-2xl font-semibold text-graphite-100 mt-1">
          {notifications.length} items need attention
        </h1>
        <p className="text-sm text-graphite-400 mt-1">
          Generated live from current part, tool, and lead-time data — nothing to configure.
        </p>
      </div>

      {notifications.length === 0 && (
        <div className="panel p-8 text-center text-sm text-graphite-500">
          All clear. No critical parts, long lead times, low inventory, or tool issues right now.
        </div>
      )}

      {Array.from(grouped.entries()).map(([category, items]) => (
        <section key={category}>
          <h2 className="text-sm font-medium text-graphite-200 mb-3">
            {CATEGORY_LABEL[category] || category}{" "}
            <span className="font-mono text-xs text-graphite-500">({items.length})</span>
          </h2>
          <div className="space-y-2">
            {items.map((n) => (
              <Link
                key={n.id}
                href={n.href}
                className={`flex items-start gap-3 rounded-md border px-4 py-3 hover:border-signal/50 transition-colors ${SEVERITY_STYLE[n.severity]}`}
              >
                <span className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${SEVERITY_DOT[n.severity]}`} />
                <div>
                  <div className="text-sm font-medium text-graphite-100">{n.title}</div>
                  <div className="text-sm text-graphite-400 mt-0.5">{n.message}</div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

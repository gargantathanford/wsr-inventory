import Link from "next/link";
import { formatDay, describeDaysUntil } from "@/lib/datetime";
import type { DeadlineOverviewRow } from "@/lib/queries";

/**
 * What is due, on the page everybody lands on.
 *
 * The competition's dates are the one set of constraints the team cannot
 * negotiate, and they were reachable only by navigating to the events page —
 * so a notice of intent eleven days out was, in practice, invisible. The
 * reminder system did not cover it either: reminders fire on the exact days in
 * reminder_intervals, [7, 1] by default, which means a deadline is announced
 * twice and silent the rest of the time.
 *
 * Sorted by how soon, not by priority. A CRITICAL deadline in March is less
 * urgent than a MEDIUM one on Friday, and sorting by the label rather than the
 * date is how a dashboard ends up shouting about the wrong thing.
 */

const band = (days: number) =>
  days < 0
    ? { text: "text-telemetry-red", border: "border-telemetry-red/50", bg: "bg-telemetry-red/[0.07]" }
    : days <= 7
      ? { text: "text-telemetry-amber", border: "border-telemetry-amber/50", bg: "bg-telemetry-amber/[0.06]" }
      : { text: "text-graphite-300", border: "border-graphite-800", bg: "" };

export function DeadlineStrip({ deadlines }: { deadlines: DeadlineOverviewRow[] }) {
  if (deadlines.length === 0) {
    return (
      <section className="panel p-6">
        <h2 className="text-sm font-medium text-graphite-200">What is due</h2>
        <p className="text-xs text-graphite-500 mt-2 leading-relaxed">
          Nothing on the calendar in the next 60 days. If that is wrong, the dates are not in the
          system yet — and a date nobody entered is a date nobody is tracking.{" "}
          <Link href="/calendar" className="text-signal hover:text-signal-bright">
            Add a deadline
          </Link>
          .
        </p>
      </section>
    );
  }

  const overdue = deadlines.filter((d) => d.days < 0).length;
  const thisWeek = deadlines.filter((d) => d.days >= 0 && d.days <= 7).length;

  return (
    <section className="panel p-6">
      <header className="flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-sm font-medium text-graphite-200">What is due</h2>
          <p className="font-mono text-[11px] text-graphite-500 mt-1">
            {overdue > 0 && (
              <span className="text-telemetry-red">
                {overdue} OVERDUE
                {thisWeek > 0 ? " · " : ""}
              </span>
            )}
            {thisWeek > 0 && <span className="text-telemetry-amber">{thisWeek} WITHIN 7 DAYS</span>}
            {overdue === 0 && thisWeek === 0 && <span>NOTHING DUE THIS WEEK</span>}
          </p>
        </div>
        <Link href="/calendar" className="font-mono text-[11px] text-signal hover:text-signal-bright">
          FULL CALENDAR →
        </Link>
      </header>

      <ul className="mt-4 space-y-1.5">
        {deadlines.map((d) => {
          const c = band(d.days);
          return (
            <li key={d.id}>
              <Link
                href="/calendar"
                className={`flex items-start gap-3 rounded border px-3 py-2.5 hover:border-signal/50 ${c.border} ${c.bg}`}
              >
                <span className={`font-mono text-[11px] tabular-nums shrink-0 w-24 ${c.text}`}>
                  {describeDaysUntil(d.days).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-graphite-100 truncate">{d.title}</span>
                  <span className="block font-mono text-[10px] text-graphite-500 mt-0.5">
                    {formatDay(d.deadline_date)}
                    {d.deadline_time ? ` ${d.deadline_time}` : ""}
                    {d.subsystem_name ? ` · ${d.subsystem_name}` : " · all teams"}
                    {d.responsible_user_name ? ` · ${d.responsible_user_name}` : ""}
                    {/* An informational date has nobody to chase, and saying
                        so stops it reading as a task somebody dropped. */}
                    {!d.is_actionable ? " · informational" : d.status === "IN_PROGRESS" ? " · in progress" : ""}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

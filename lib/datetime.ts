/**
 * Showing times to people.
 *
 * Two bugs lived here, and they hid each other.
 *
 * 1. Timestamps are written in two shapes. SQLite's `datetime('now')` gives
 *    "2026-10-31 16:00:00" — UTC, with nothing in the string that says so.
 *    JavaScript's `new Date()` gives "2026-10-31T16:00:00.000Z" — UTC, marked.
 *    Feed the first to `new Date()` and JS reads it as LOCAL time, so the same
 *    instant lands hours away from the second depending only on which function
 *    happened to write the row.
 *
 * 2. `toLocaleString()` with no timezone formats in the TIMEZONE OF WHATEVER
 *    IS RUNNING. These are server components, so that is the container: UTC.
 *    A session at 11:00 in Tulsa rendered as 16:00 — and it would render
 *    differently again on a VM in another region, with nothing to indicate
 *    the number had moved.
 *
 * So: every timestamp is normalised to a real instant here, and every instant
 * is formatted in the team's own timezone. That zone is one constant
 * (WSR_TIMEZONE, default America/Chicago) which the XP streak logic already
 * used for deciding what counts as "a day" — the display layer simply never
 * asked. The streaks were right and the clocks were wrong, which is the
 * confusing way round.
 *
 * Daylight saving is handled by Intl, not by arithmetic: Tulsa is UTC-5 in
 * October and UTC-6 in November, and a hardcoded offset would be correct for
 * about half the season.
 */

/** The team works in one place. Overridable for a team that does not. */
export const TEAM_TIMEZONE = process.env.WSR_TIMEZONE || "America/Chicago";

/**
 * Turn a stored timestamp into an instant.
 *
 * Accepts both shapes the database holds, and treats a bare "YYYY-MM-DD
 * HH:MM:SS" as UTC — which is what SQLite's datetime('now') means by it.
 * Returns null rather than an Invalid Date, so callers have one thing to
 * check instead of remembering isNaN(d.getTime()).
 */
export function parseStamp(value: string | null | undefined): Date | null {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;

  let normalised = s;
  // A space instead of the T, and no zone: SQLite. Mark it as the UTC it is.
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(s)) {
    normalised = s.replace(" ", "T") + "Z";
  }

  const d = new Date(normalised);
  return Number.isNaN(d.getTime()) ? null : d;
}

const fmt = (opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-US", { timeZone: TEAM_TIMEZONE, ...opts });

const DATE_TIME = fmt({
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit"
});
const DATE_ONLY = fmt({ year: "numeric", month: "short", day: "numeric" });
const TIME_ONLY = fmt({ hour: "numeric", minute: "2-digit" });
const WEEKDAY = fmt({ weekday: "short" });
const DAY_KEY = new Intl.DateTimeFormat("en-CA", {
  timeZone: TEAM_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

/** "Oct 31, 2026, 11:00 AM" in the team's timezone. */
export function formatDateTime(value: string | null | undefined, fallback = "—"): string {
  const d = parseStamp(value);
  return d ? DATE_TIME.format(d) : fallback;
}

/** "Oct 31, 2026". */
export function formatDate(value: string | null | undefined, fallback = "—"): string {
  const d = parseStamp(value);
  return d ? DATE_ONLY.format(d) : fallback;
}

/** "11:00 AM". */
export function formatTime(value: string | null | undefined, fallback = "—"): string {
  const d = parseStamp(value);
  return d ? TIME_ONLY.format(d) : fallback;
}

/** "Sat" — the day of the week in the team's timezone. */
export function weekday(value: string | null | undefined, fallback = "—"): string {
  const d = parseStamp(value);
  return d ? WEEKDAY.format(d) : fallback;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A calendar DATE — deadline_date, due_date, date_received and the rest.
 *
 * These columns hold a day, not an instant, and they must not be converted.
 * `new Date("2026-10-31")` is midnight UTC, which in Tulsa is the evening of
 * the 30th: push a due date through an instant formatter and every deadline
 * in the app moves a day earlier. So this reads the digits and formats them,
 * and no timezone is involved at any point.
 *
 * Anything that is not a plain date falls through to formatDate, so a column
 * that turns out to hold a full timestamp still renders sensibly.
 */
export function formatDay(value: string | null | undefined, fallback = "—"): string {
  if (!value) return fallback;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).trim());
  if (!m) return formatDate(value, fallback);
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return fallback;
  return `${month} ${Number(m[3])}, ${m[1]}`;
}

/**
 * The team-local calendar day, YYYY-MM-DD.
 *
 * Not the same as value.slice(0, 10): a shop session closed at 00:30 UTC on
 * the 1st happened on the evening of the 31st here, and slicing the string
 * puts it on the wrong day. Sorts correctly as a string.
 */
export function localDayOf(value: string | null | undefined): string | null {
  const d = parseStamp(value);
  return d ? DAY_KEY.format(d) : null;
}

/** Today, in the team's timezone, as YYYY-MM-DD. */
export function todayLocal(now: Date = new Date()): string {
  return DAY_KEY.format(now);
}

/**
 * Whole days from today to a YYYY-MM-DD date, counted in calendar days rather
 * than 24-hour blocks.
 *
 * Both ends are read as midnight UTC purely to subtract them, which is safe
 * because the timezone work already happened when the day strings were made.
 * Counting in elapsed hours instead would make a deadline "1 day away" at
 * 23:00 and "0 days away" an hour later, which is not how anybody reads a
 * calendar. Negative means overdue.
 */
export function daysUntil(dayString: string, from: string = todayLocal()): number | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(dayString)) return null;
  const a = Date.parse(`${dayString.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / 86_400_000);
}

/** "in 11 days", "tomorrow", "today", "3 days overdue". */
export function describeDaysUntil(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "1 day overdue";
  if (days < 0) return `${Math.abs(days)} days overdue`;
  return `in ${days} days`;
}

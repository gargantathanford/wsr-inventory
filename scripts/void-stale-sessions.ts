/**
 * Void shop sessions left open past the local 04:00 boundary.
 *
 * The app also sweeps on every read of /api/shop/sessions, so this script is a
 * belt-and-braces cron entry for the case where nobody opens the page for days.
 *
 *   npx tsx scripts/void-stale-sessions.ts
 *   docker compose run --rm maint npx tsx scripts/void-stale-sessions.ts
 *
 * An unclosed session records no credited time. This is data hygiene, not a
 * penalty: without it one forgotten session logs eighteen hours and the
 * timesheet becomes fiction.
 */
import { voidStaleSessions, TEAM_TIMEZONE } from "@/lib/xp/store";

const voided = voidStaleSessions();
console.log(`timezone : ${TEAM_TIMEZONE}`);
console.log(`voided   : ${voided} stale session${voided === 1 ? "" : "s"}`);

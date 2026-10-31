import { getAllCalendarEvents, getAllSubsystems } from "@/lib/queries";
import { getSession, canReviewSubsystem, subsystemsMemberOf } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { CalendarEventCard } from "@/components/CalendarEventCard";
import { NewCalendarEventForm } from "@/components/NewCalendarEventForm";
import { ShowMore } from "@/components/ShowMore";

export default async function CalendarPage() {
  const user = await getSession();
  const events = getAllCalendarEvents();
  const subsystems = getAllSubsystems();
  const db = getDb();
  const myMemberships = user ? new Set(subsystemsMemberOf(user.id)) : new Set();

  const upcoming = events.filter((e) => e.status !== "COMPLETED");
  const completed = events.filter((e) => e.status === "COMPLETED");

  function withMeta(e: any) {
    const attachments = e.status === "SUBMITTED_FOR_REVIEW" || e.status === "COMPLETED" ? db.prepare(`SELECT * FROM documents WHERE calendar_event_id = ?`).all(e.id) : [];
    const canReview = user ? canReviewSubsystem(user, e.subsystem_id) : false;
    const isResponsible = user ? e.responsible_user_id === user.id : false;
    const isScopeMember = e.subsystem_id ? myMemberships.has(e.subsystem_id) : true;
    // canAct covers SUBMITTING completion — any member of the responsible team
    // can do that, and should. Starting is separate: it commits the team to a
    // deadline being worked, so it belongs to whoever is accountable.
    return {
      event: e,
      attachments,
      canReview,
      canAct: isResponsible || isScopeMember || canReview,
      canStart: canReview
    };
  }

  return (
    <div className="p-6 md:p-8 max-w-[1000px] mx-auto space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="data-label">CALENDAR</div>
          <h1 className="text-2xl font-semibold text-graphite-100 mt-1">Deadlines &amp; milestones</h1>
        </div>
        {user && user.role !== "TEAM_MEMBER" && (
          <NewCalendarEventForm subsystems={subsystems.map((s: any) => ({ id: s.id, name: s.name }))} />
        )}
      </div>

      <section>
        <div className="data-label mb-3">UPCOMING ({upcoming.length})</div>
        <div className="space-y-2">
          <ShowMore noun="upcoming events">
          {upcoming.map((e) => {
            const m = withMeta(e);
            return (
              <CalendarEventCard
                key={e.id}
                event={m.event}
                currentUserId={user?.id || ""}
                canReview={m.canReview}
                canAct={m.canAct}
                canStart={m.canStart}
                attachments={m.attachments}
              />
            );
          })}
          </ShowMore>
          {upcoming.length === 0 && <p className="text-sm text-graphite-500">Nothing on the calendar yet.</p>}
        </div>
      </section>

      {completed.length > 0 && (
        <section>
          <div className="data-label mb-3">COMPLETED ({completed.length})</div>
          <div className="space-y-2">
            <ShowMore noun="completed events" initial={5}>
            {completed.map((e) => {
              const m = withMeta(e);
              return (
                <CalendarEventCard
                  key={e.id}
                  event={m.event}
                  currentUserId={user?.id || ""}
                  canReview={m.canReview}
                  canAct={m.canAct}
                canStart={m.canStart}
                  attachments={m.attachments}
                />
              );
            })}
            </ShowMore>
          </div>
        </section>
      )}
    </div>
  );
}

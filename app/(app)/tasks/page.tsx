import { getAllTasksDetailed, getAllSubsystems, getTaskDocuments } from "@/lib/queries";
import { getSession, canReviewSubsystem, subsystemsMemberOf } from "@/lib/auth";
import { TaskCard } from "@/components/TaskCard";
import { NewTaskForm } from "@/components/NewTaskForm";
import { ShowMore } from "@/components/ShowMore";

export default async function TasksPage() {
  const user = await getSession();
  const tasks = getAllTasksDetailed();
  const subsystems = getAllSubsystems();
  const myMemberships = user ? new Set(subsystemsMemberOf(user.id)) : new Set();

  const withAttachments = tasks.map((t: any) => {
    const isDirectAssignee = user ? t.assigned_to === user.id || t.extra_assignees?.some((a: any) => a.id === user.id) : false;
    const isScopeMember = t.assignment_scope !== "USER" && t.subsystem_id && myMemberships.has(t.subsystem_id);
    const canReview = user ? canReviewSubsystem(user, t.subsystem_id) : false;
    // Rejecting deletes the task, so it is deliberately narrower than review:
    // a lead sends work back, the people who answer for the whole build remove
    // it entirely.
    const canReject = user?.role === "ADMIN" || user?.role === "CHIEF_ENGINEER";
    return {
      task: t,
      attachments: t.status === "SUBMITTED_FOR_REVIEW" || t.status === "COMPLETED" ? getTaskDocuments(t.id) : [],
      canReview,
      canReject,
      canAct: isDirectAssignee || isScopeMember || canReview
    };
  });

  const reviewQueue = withAttachments.filter((x) => x.task.status === "SUBMITTED_FOR_REVIEW" && x.canReview);
  const rest = withAttachments.filter((x) => !(x.task.status === "SUBMITTED_FOR_REVIEW" && x.canReview));

  return (
    <div className="p-6 md:p-8 max-w-[1000px] mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <div className="data-label">TASKS</div>
          <h1 className="text-2xl font-semibold text-graphite-100 mt-1">{tasks.length} tasks</h1>
          <p className="text-sm text-graphite-400 mt-1">
            Open → In Progress → Submitted for Review → Completed. Completion requires documentation.
          </p>
        </div>
        <NewTaskForm subsystems={subsystems.map((s: any) => ({ id: s.id, name: s.name }))} />
      </div>

      {reviewQueue.length > 0 && user && (
        <section>
          <div className="data-label mb-3">AWAITING YOUR REVIEW ({reviewQueue.length})</div>
          <div className="space-y-2">
            <ShowMore noun="tasks awaiting review">
            {reviewQueue.map(({ task, attachments, canReview, canReject, canAct }) => (
              <TaskCard key={task.id} task={task} currentUserId={user.id} canReview={canReview} canReject={canReject} canAct={canAct} attachments={attachments} />
            ))}
            </ShowMore>
          </div>
        </section>
      )}

      <section>
        {reviewQueue.length > 0 && <div className="data-label mb-3">ALL TASKS</div>}
        <div className="space-y-2">
          <ShowMore noun="tasks">
            {rest.map(({ task, attachments, canReview, canReject, canAct }) => (
              <TaskCard key={task.id} task={task} currentUserId={user?.id || ""} canReview={canReview} canReject={canReject} canAct={canAct} attachments={attachments} />
            ))}
          </ShowMore>
          {tasks.length === 0 && <p className="text-sm text-graphite-500">No tasks yet.</p>}
        </div>
      </section>
    </div>
  );
}

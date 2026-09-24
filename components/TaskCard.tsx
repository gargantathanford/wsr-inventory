"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge, ImportanceBadge } from "@/components/StatusBadge";
import { TaskCompletionModal } from "@/components/TaskCompletionModal";
import { TaskReviewPanel } from "@/components/TaskReviewPanel";

export function TaskCard({
  task,
  currentUserId,
  canReview,
  canAct,
  attachments
}: {
  task: any;
  currentUserId: string;
  canReview: boolean;
  canAct: boolean;
  attachments: any[];
}) {
  const router = useRouter();
  const [showCompletion, setShowCompletion] = useState(false);
  const [loading, setLoading] = useState(false);

  async function start() {
    setLoading(true);
    await fetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "IN_PROGRESS" })
    });
    setLoading(false);
    router.refresh();
  }

  return (
    <div className="panel p-4 space-y-3">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-graphite-100 font-medium">{task.title}</span>
            <ImportanceBadge importance={task.priority} />
          </div>
          {task.description && <p className="text-xs text-graphite-500 mt-1 max-w-lg">{task.description}</p>}
          <div className="font-mono text-[11px] text-graphite-500 mt-1.5">
            {task.subsystem_name || "Unassigned"}
            {task.subteam_name ? ` / ${task.subteam_name}` : ""}
            {task.part_name ? ` · ${task.part_name}` : ""}
            {task.procedure_title ? ` · Procedure: ${task.procedure_title}` : ""}
            {" · "}
            {task.assignment_scope !== "USER"
              ? `Whole ${task.assignment_scope.toLowerCase()}`
              : task.assignee_name || "unassigned"}
            {task.due_date ? ` · due ${task.due_date}${task.due_time ? ` ${task.due_time}` : ""}` : ""}
            {task.estimated_hours ? ` · ~${task.estimated_hours}h` : ""}
          </div>
        </div>
        <StatusBadge status={task.status} />
      </div>

      {task.blocked_by?.some((b: any) => b.status !== "COMPLETED") && (
        <div className="text-xs text-telemetry-red border border-telemetry-red/40 bg-telemetry-red/10 rounded-sm px-3 py-2">
          Blocked by: {task.blocked_by.filter((b: any) => b.status !== "COMPLETED").map((b: any) => b.title).join(", ")}
        </div>
      )}

      {task.status === "IN_PROGRESS" && task.return_reason && (
        <div className="text-xs text-telemetry-amber border border-telemetry-amber/40 bg-telemetry-amber/10 rounded-sm px-3 py-2">
          Returned for additional work: {task.return_reason}
        </div>
      )}

      {(task.status === "SUBMITTED_FOR_REVIEW" || task.status === "COMPLETED") && task.completion_summary && (
        <div className="rounded-sm border border-graphite-700 bg-graphite-850/60 p-3 space-y-2">
          <div className="data-label">
            {task.status === "COMPLETED" ? "COMPLETION SUMMARY" : "SUBMITTED FOR REVIEW"}
            {task.submitted_by_name ? ` — ${task.submitted_by_name}` : ""}
            {task.submitted_at ? ` · ${task.submitted_at.slice(0, 16).replace("T", " ")}` : ""}
          </div>
          <p className="text-sm text-graphite-300 whitespace-pre-line">{task.completion_summary}</p>
          {task.remaining_work && (
            <div className="text-xs text-graphite-500">
              <span className="text-graphite-400">Remaining work:</span> {task.remaining_work}
            </div>
          )}
          {task.completion_links && (
            <div className="text-xs text-graphite-500 whitespace-pre-line">
              <span className="text-graphite-400">Links:</span> {task.completion_links}
            </div>
          )}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {attachments.map((a: any) => (
                <a
                  key={a.id}
                  href={a.source === "UPLOAD" ? `/api/files/${a.id}` : a.url}
                  target="_blank"
                  rel="noreferrer"
                  className="pill border-telemetry-blue/50 text-telemetry-blue bg-telemetry-blue/10"
                >
                  {a.title}
                </a>
              ))}
            </div>
          )}
          {task.status === "COMPLETED" && task.reviewed_by_name && (
            <div className="text-[11px] font-mono text-graphite-500 pt-1 border-t border-graphite-800">
              Approved by {task.reviewed_by_name} on {task.reviewed_at?.slice(0, 10)}
            </div>
          )}
        </div>
      )}

      {task.status === "SUBMITTED_FOR_REVIEW" && canReview && <TaskReviewPanel taskId={task.id} />}

      {canAct && task.status === "OPEN" && (
        <button className="btn-ghost text-xs" disabled={loading} onClick={start}>
          Start task
        </button>
      )}
      {canAct && task.status === "IN_PROGRESS" && (
        <button className="btn-primary text-xs" onClick={() => setShowCompletion(true)}>
          Mark complete
        </button>
      )}

      {showCompletion && (
        <TaskCompletionModal taskId={task.id} taskTitle={task.title} onClose={() => setShowCompletion(false)} />
      )}
    </div>
  );
}

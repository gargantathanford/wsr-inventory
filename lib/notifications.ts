import { getAllParts, getMissingTools, getTasksAwaitingReview, getNewlyAssignedTasksForUser, getDueReminders } from "./queries";
import { isOwned } from "./scoring";
import { subsystemsMemberOf, subsystemsLedBy, type SessionUser } from "./auth";
import { getDb } from "./db";

export type NotificationSeverity = "critical" | "warning" | "info";

export interface AppNotification {
  id: string;
  severity: NotificationSeverity;
  category:
    | "CRITICAL_PART"
    | "LONG_LEAD_TIME"
    | "LOW_INVENTORY"
    | "TOOL_UNAVAILABLE"
    | "TASK_REVIEW"
    | "TASK_RETURNED"
    | "TASK_ASSIGNED"
    | "DEADLINE_REMINDER";
  title: string;
  message: string;
  href: string;
}

const LONG_LEAD_TIME_DAYS = 42; // 6 weeks

/**
 * Notifications are generated live from current data rather than stored, and are
 * scoped to the requesting user: Admin/Chief Engineer see everything; a Team Leader
 * or Team Member sees only what's relevant to the subsystem(s) they belong to, plus
 * anything addressed to them personally (e.g. a returned task).
 */
export function generateNotifications(user: SessionUser): AppNotification[] {
  const notifications: AppNotification[] = [];
  const isLeadershipWide = user.role === "ADMIN" || user.role === "CHIEF_ENGINEER";
  const relevantSubsystemIds = new Set(subsystemsMemberOf(user.id));

  const parts = getAllParts();
  for (const p of parts) {
    if (p.status === "NO_LONGER_NEEDED") continue;
    if (!isLeadershipWide && !relevantSubsystemIds.has(p.subsystem_id)) continue;

    if (p.importance === "CRITICAL" && !isOwned(p.status)) {
      notifications.push({
        id: `critical-${p.id}`,
        severity: "critical",
        category: "CRITICAL_PART",
        title: "Critical part missing",
        message: `${p.part_name} (${p.subsystem_name}) is critical and not yet owned.`,
        href: `/parts/${p.id}`
      });
    }

    if (!isOwned(p.status) && p.lead_time_days != null && p.lead_time_days >= LONG_LEAD_TIME_DAYS) {
      const weeks = Math.round(p.lead_time_days / 7);
      notifications.push({
        id: `leadtime-${p.id}`,
        severity: p.lead_time_days >= 56 ? "critical" : "warning",
        category: "LONG_LEAD_TIME",
        title: "Long lead time",
        message: `${p.part_name} has a ${weeks}-week lead time (${p.lead_time_days} days).`,
        href: `/parts/${p.id}`
      });
    }

    if (!isOwned(p.status) && p.status !== "MANUFACTURING" && p.quantity_owned > 0 && p.quantity_owned < p.quantity_required) {
      notifications.push({
        id: `lowinv-${p.id}`,
        severity: "warning",
        category: "LOW_INVENTORY",
        title: "Low inventory",
        message: `Only ${p.quantity_owned} of ${p.quantity_required} ${p.part_name} available.`,
        href: `/parts/${p.id}`
      });
    }
  }

  if (isLeadershipWide || user.role === "TEAM_LEADER") {
    const missingTools = getMissingTools();
    for (const t of missingTools) {
      if (!isLeadershipWide) {
        const toolSubsystemIds: string[] = getDb()
          .prepare(`SELECT subsystem_id FROM tool_subsystems WHERE tool_id = ?`)
          .all(t.id)
          .map((r: any) => r.subsystem_id);
        if (!toolSubsystemIds.some((id) => relevantSubsystemIds.has(id))) continue;
      }
      notifications.push({
        id: `tool-${t.id}`,
        severity: t.status === "MISSING" ? "critical" : "warning",
        category: "TOOL_UNAVAILABLE",
        title: `Required tool ${t.status.toLowerCase().replace(/_/g, " ")}`,
        message: `${t.tool_name}${t.subsystem_names ? ` — needed by ${t.subsystem_names}` : ""}`,
        href: `/tools/${t.id}`
      });
    }
  }

  // Task review queue: Admin/Chief Engineer see all; Team Leaders see only their teams'.
  if (isLeadershipWide) {
    for (const t of getTasksAwaitingReview()) {
      notifications.push({
        id: `review-${t.id}`,
        severity: "warning",
        category: "TASK_REVIEW",
        title: "Task submitted for review",
        message: `${t.assignee_name || t.submitted_by_name || "A team member"} submitted "${t.title}" (${t.subsystem_name || "Unassigned"}) for review.`,
        href: `/tasks?review=${t.id}`
      });
    }
  } else if (user.role === "TEAM_LEADER") {
    const led = subsystemsLedBy(user.id);
    for (const t of getTasksAwaitingReview(led)) {
      notifications.push({
        id: `review-${t.id}`,
        severity: "warning",
        category: "TASK_REVIEW",
        title: "Task submitted for review",
        message: `${t.assignee_name || t.submitted_by_name || "A team member"} submitted "${t.title}" (${t.subsystem_name}) for review.`,
        href: `/tasks?review=${t.id}`
      });
    }
  }

  // Returned tasks: notify the assignee directly, regardless of role.
  const db = getDb();
  const returned = db
    .prepare(
      `SELECT t.*, s.name as subsystem_name FROM tasks t
       LEFT JOIN subsystems s ON s.id = t.subsystem_id
       WHERE t.assigned_to = ? AND t.status = 'IN_PROGRESS' AND t.return_reason IS NOT NULL AND t.return_reason != ''`
    )
    .all(user.id) as any[];
  for (const t of returned) {
    notifications.push({
      id: `returned-${t.id}`,
      severity: "warning",
      category: "TASK_RETURNED",
      title: "Task returned for additional work",
      message: `"${t.title}" was returned: ${t.return_reason}`,
      href: `/tasks?task=${t.id}`
    });
  }

  // New task assignments — direct, or via team/subsystem scope.
  const newlyAssigned = getNewlyAssignedTasksForUser(user.id, Array.from(relevantSubsystemIds));
  for (const t of newlyAssigned) {
    notifications.push({
      id: `assigned-${t.id}`,
      severity: t.priority === "CRITICAL" ? "critical" : t.priority === "HIGH" ? "warning" : "info",
      category: "TASK_ASSIGNED",
      title: "New task assigned",
      message: `"${t.title}" (${t.subsystem_name || "Unassigned"}) — created by ${t.created_by_name || "a teammate"}${t.due_date ? `, due ${t.due_date}` : ""}.`,
      href: `/tasks?task=${t.id}`
    });
  }

  // Calendar deadline reminders — scoped by each event's configured notify_scope.
  for (const e of getDueReminders(user, Array.from(relevantSubsystemIds))) {
    const when = e.daysRemaining === 0 ? "today" : e.daysRemaining === 1 ? "tomorrow" : `in ${e.daysRemaining} days`;
    notifications.push({
      id: `deadline-${e.id}`,
      severity: e.daysRemaining <= 1 ? "critical" : e.priority === "CRITICAL" || e.priority === "HIGH" ? "warning" : "info",
      category: "DEADLINE_REMINDER",
      title: `Deadline ${when}`,
      message: `${e.title}${e.subsystem_name ? ` (${e.subsystem_name})` : ""} — ${e.deadline_date}${e.deadline_time ? ` ${e.deadline_time}` : ""}.`,
      href: `/calendar?event=${e.id}`
    });
  }

  const severityOrder: Record<NotificationSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return notifications.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
}

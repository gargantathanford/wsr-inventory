"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

export function NewTaskForm({ subsystems }: { subsystems: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [subteams, setSubteams] = useState<{ id: string; name: string }[]>([]);
  const [openTasks, setOpenTasks] = useState<{ id: string; title: string }[]>([]);
  const [subsystemId, setSubsystemId] = useState("");
  const [scope, setScope] = useState<"USER" | "TEAM" | "SUBSYSTEM">("USER");
  const [blockedBy, setBlockedBy] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    fetch("/api/users/directory").then((r) => r.json()).then((d) => setUsers(d.users || []));
    fetch("/api/tasks").then((r) => r.json()).then((d) =>
      setOpenTasks((d.tasks || []).filter((t: any) => t.status !== "COMPLETED").map((t: any) => ({ id: t.id, title: t.title })))
    );
  }, [open]);

  useEffect(() => {
    if (!subsystemId) {
      setSubteams([]);
      return;
    }
    fetch(`/api/subteams?subsystem=${subsystemId}`).then((r) => r.json()).then((d) => setSubteams(d.subteams || []));
  }, [subsystemId]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const payload: Record<string, any> = Object.fromEntries(fd.entries());
    payload.assignment_scope = scope;
    payload.blocked_by_task_ids = blockedBy;
    if (scope !== "USER") payload.assigned_to = null;

    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "Could not create task.");
      return;
    }
    (e.target as HTMLFormElement).reset();
    setBlockedBy([]);
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button className="btn-primary" onClick={() => setOpen(true)}>
        + New task
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="panel p-5 space-y-4">
      {error && <div className="text-sm text-telemetry-red font-mono">{error}</div>}

      <div className="grid sm:grid-cols-2 gap-3">
        <input className="input" name="title" placeholder="Task title" required />
        <select className="input" name="priority" defaultValue="MEDIUM">
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      <textarea className="input min-h-16" name="description" placeholder="Detailed description (optional)" />

      <div className="grid sm:grid-cols-3 gap-3">
        <select className="input" name="subsystem_id" value={subsystemId} onChange={(e) => setSubsystemId(e.target.value)}>
          <option value="">Responsible team — none</option>
          {subsystems.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select className="input" name="subteam_id" defaultValue="" disabled={subteams.length === 0}>
          <option value="">Subteam — none</option>
          {subteams.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <input className="input" type="number" step="0.5" min="0" name="estimated_hours" placeholder="Est. hours" />
      </div>

      <div>
        <span className="data-label block mb-1.5">Assign to</span>
        <div className="flex gap-2 mb-2">
          {(["USER", "TEAM", "SUBSYSTEM"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              className={`text-xs font-mono px-2.5 py-1 rounded-sm border ${
                scope === s ? "border-signal text-signal bg-signal/10" : "border-graphite-700 text-graphite-400"
              }`}
            >
              {s === "USER" ? "Specific person" : s === "TEAM" ? "Whole team" : "Whole subsystem"}
            </button>
          ))}
        </div>
        {scope === "USER" ? (
          <select className="input" name="assigned_to" defaultValue="">
            <option value="">Unassigned for now</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-xs text-graphite-500">
            Every member of the responsible team above will see this in their task list.
          </p>
        )}
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <input className="input" type="date" name="due_date" />
        <input className="input" type="time" name="due_time" />
      </div>

      {openTasks.length > 0 && (
        <div>
          <span className="data-label block mb-1.5">Blocked by (optional)</span>
          <select
            multiple
            className="input h-24"
            value={blockedBy}
            onChange={(e) => setBlockedBy(Array.from(e.target.selectedOptions, (o) => o.value))}
          >
            {openTasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex gap-2">
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? "Adding…" : "Create task"}
        </button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

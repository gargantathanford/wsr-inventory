"use client";

import { useState } from "react";
import Link from "next/link";

const PRESENCE_DOT: Record<string, string> = {
  online: "bg-telemetry-green",
  away: "bg-telemetry-amber",
  offline: "bg-graphite-600"
};

export function TeamGroup({
  subsystemName,
  subsystemSlug,
  leaders,
  members,
  presenceMap
}: {
  subsystemName: string;
  subsystemSlug: string;
  leaders: any[];
  members: any[];
  presenceMap: Record<string, "online" | "away" | "offline">;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="panel overflow-hidden">
      <div className="p-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link href={`/subsystems/${subsystemSlug}`} className="text-graphite-100 font-semibold hover:text-signal uppercase tracking-wide text-sm">
            {subsystemName}
          </Link>

          <div className="mt-3">
            <div className="data-label mb-1">TEAM LEAD</div>
            {leaders.length === 0 ? (
              <div className="text-sm text-graphite-500">Unassigned</div>
            ) : (
              <div className="flex flex-col gap-1">
                {leaders.map((l) => (
                  <div key={l.id} className="flex items-center gap-2 text-sm text-graphite-100">
                    <span className={`h-1.5 w-1.5 rounded-full ${PRESENCE_DOT[presenceMap[l.id] || "offline"]}`} />
                    {l.name}
                    {l.activeTasks > 0 && (
                      <span className="font-mono text-[10px] text-graphite-500">{l.activeTasks} active task{l.activeTasks === 1 ? "" : "s"}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <button
          onClick={() => setOpen((v) => !v)}
          className="btn-ghost text-xs shrink-0"
        >
          {open ? "▲" : "▼"} {members.length} Team Member{members.length === 1 ? "" : "s"}
        </button>
      </div>

      {open && (
        <div className="border-t border-graphite-800 divide-y divide-graphite-800">
          {members.length === 0 && <div className="p-4 text-sm text-graphite-500">No members assigned yet.</div>}
          {members.map((m) => (
            <div key={m.id} className="p-4 flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${PRESENCE_DOT[presenceMap[m.id] || "offline"]}`} />
                <div>
                  <div className="text-sm text-graphite-100">{m.name}</div>
                  <div className="font-mono text-[11px] text-graphite-500">
                    {m.email}
                    {m.phone_number ? ` · ${m.phone_number}` : ""}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="font-mono text-[11px] text-graphite-500 capitalize">{presenceMap[m.id] || "offline"}</span>
                <span className="pill border-graphite-600 text-graphite-400 bg-graphite-800">
                  {m.activeTasks} active task{m.activeTasks === 1 ? "" : "s"}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

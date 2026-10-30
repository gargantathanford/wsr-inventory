"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SessionUser } from "@/lib/auth";
import { NotificationBell } from "@/components/NotificationBell";
import { OnlineCounter } from "@/components/OnlineCounter";
import { XpBadge } from "@/components/xp/XpBadge";

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Admin",
  TEAM_LEADER: "Team Leader",
  TEAM_MEMBER: "Team Member"
};

export function TopBar({ user }: { user: SessionUser }) {
  const router = useRouter();
  const [q, setQ] = useState("");

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`);
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="h-14 border-b border-graphite-700/60 bg-graphite-900/80 backdrop-blur flex items-center gap-4 px-4 md:px-6">
      <form onSubmit={onSearch} className="flex-1 max-w-md">
        <input
          className="input"
          placeholder="Search parts, tools, docs, subsystems…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </form>
      <div className="ml-auto flex items-center gap-4">
        <OnlineCounter className="hidden md:flex" />
        {/* Small and quiet on purpose — XP is never the headline number. */}
        <XpBadge />
        <NotificationBell />
        <div className="text-right hidden sm:block">
          <div className="text-sm text-graphite-100 leading-tight">{user.name}</div>
          <div className="text-[11px] font-mono text-graphite-500 leading-tight">
            {ROLE_LABEL[user.role]}
          </div>
        </div>
        <button onClick={logout} className="btn-ghost text-xs py-1.5">
          Sign out
        </button>
      </div>
    </header>
  );
}

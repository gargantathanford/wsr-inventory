"use client";

import { useEffect, useState } from "react";

const POLL_MS = 20_000;

export function OnlineCounter({ className = "" }: { className?: string }) {
  const [online, setOnline] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/presence", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        setOnline(data.onlineCount);
      } catch {
        /* silent — presence is a nicety, not critical path */
      }
    }
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (online === null) return null;

  return (
    <div className={`flex items-center gap-1.5 font-mono text-xs text-graphite-400 ${className}`}>
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-telemetry-green opacity-60" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-telemetry-green" />
      </span>
      {online} {online === 1 ? "member" : "members"} online
    </div>
  );
}

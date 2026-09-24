"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

interface AppNotification {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  message: string;
  href: string;
}

const SEVERITY_DOT: Record<string, string> = {
  critical: "bg-telemetry-red",
  warning: "bg-telemetry-amber",
  info: "bg-telemetry-blue"
};

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [total, setTotal] = useState(0);
  const [criticalCount, setCriticalCount] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/notifications")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setNotifications(data.notifications || []);
        setTotal(data.total || 0);
        setCriticalCount(data.criticalCount || 0);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative btn-ghost text-xs py-1.5 px-2.5"
        aria-label="Notifications"
      >
        <BellIcon />
        {total > 0 && (
          <span
            className={`absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-mono font-semibold flex items-center justify-center ${
              criticalCount > 0 ? "bg-telemetry-red text-white" : "bg-telemetry-amber text-graphite-950"
            }`}
          >
            {total > 9 ? "9+" : total}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 panel z-50 max-h-96 overflow-y-auto">
          <div className="flex items-center justify-between px-4 py-3 border-b border-graphite-800">
            <span className="data-label">NOTIFICATIONS</span>
            <span className="font-mono text-[11px] text-graphite-500">{total} total</span>
          </div>
          {notifications.length === 0 ? (
            <div className="p-4 text-sm text-graphite-500">All clear — nothing needs attention.</div>
          ) : (
            <div className="divide-y divide-graphite-800">
              {notifications.map((n) => (
                <Link
                  key={n.id}
                  href={n.href}
                  onClick={() => setOpen(false)}
                  className="flex items-start gap-2.5 px-4 py-3 hover:bg-graphite-850/60"
                >
                  <span className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${SEVERITY_DOT[n.severity]}`} />
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-graphite-100">{n.title}</div>
                    <div className="text-xs text-graphite-400 mt-0.5 leading-snug">{n.message}</div>
                  </div>
                </Link>
              ))}
            </div>
          )}
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="block text-center text-xs font-mono text-signal hover:text-signal-bright py-2.5 border-t border-graphite-800"
          >
            VIEW ALL →
          </Link>
        </div>
      )}
    </div>
  );
}

function BellIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

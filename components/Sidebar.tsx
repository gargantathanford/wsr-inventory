"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { SessionUser } from "@/lib/auth";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/subsystems", label: "Subsystems" },
  { href: "/parts", label: "Parts Database" },
  { href: "/inventory", label: "Inventory" },
  { href: "/shopping-list", label: "Shopping List" },
  { href: "/purchase-requests", label: "Purchase Requests" },
  { href: "/purchase-orders", label: "Purchase Orders" },
  { href: "/dependencies", label: "Dependencies" },
  { href: "/tools", label: "Tools" },
  { href: "/documentation", label: "Documentation" },
  { href: "/procedures", label: "Procedures" },
  { href: "/tasks", label: "Tasks" },
  { href: "/calendar", label: "Calendar" },
  { href: "/notifications", label: "Notifications" },
  { href: "/team", label: "Team" }
];

export function Sidebar({ user }: { user: SessionUser }) {
  const pathname = usePathname();
  const settingsAccess = user.role === "ADMIN";

  return (
    <aside className="hidden md:flex w-56 shrink-0 flex-col border-r border-graphite-700/60 bg-graphite-900">
      <div className="h-14 flex items-center gap-2 px-4 border-b border-graphite-700/60">
        <span className="h-2 w-2 rounded-full bg-signal animate-pulse" />
        <span className="font-mono text-xs tracking-wide text-graphite-200">WARP SPEED RACING</span>
      </div>
      <nav className="flex-1 py-3 overflow-y-auto">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2 px-4 py-2 text-sm border-l-2 transition-colors ${
                active
                  ? "border-signal text-graphite-100 bg-graphite-850"
                  : "border-transparent text-graphite-400 hover:text-graphite-100 hover:bg-graphite-850/60"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
        {settingsAccess && (
          <Link
            href="/settings"
            className={`flex items-center gap-2 px-4 py-2 text-sm border-l-2 transition-colors ${
              pathname.startsWith("/settings")
                ? "border-signal text-graphite-100 bg-graphite-850"
                : "border-transparent text-graphite-400 hover:text-graphite-100 hover:bg-graphite-850/60"
            }`}
          >
            Settings
          </Link>
        )}
      </nav>
      <div className="p-3 border-t border-graphite-700/60">
        <div className="font-mono text-[11px] text-graphite-500">FSAE MICHIGAN · SPRING 2027</div>
      </div>
    </aside>
  );
}

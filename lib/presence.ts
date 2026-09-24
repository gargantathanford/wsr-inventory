import { getDb } from "./db";

export type PresenceStatus = "online" | "away" | "offline";

const ONLINE_WINDOW_MS = 2 * 60 * 1000; // 2 minutes
const AWAY_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

export function presenceStatus(lastActive: string | null): PresenceStatus {
  if (!lastActive) return "offline";
  // SQLite datetime('now') is UTC, no offset suffix — mark it explicitly for Date parsing.
  const ts = new Date(lastActive.replace(" ", "T") + "Z").getTime();
  if (Number.isNaN(ts)) return "offline";
  const diff = Date.now() - ts;
  if (diff <= ONLINE_WINDOW_MS) return "online";
  if (diff <= AWAY_WINDOW_MS) return "away";
  return "offline";
}

export function getPresenceSummary() {
  const db = getDb();
  const users = db.prepare(`SELECT id, name, last_active FROM users WHERE is_active = 1`).all() as {
    id: string;
    name: string;
    last_active: string | null;
  }[];
  const withStatus = users.map((u) => ({ ...u, status: presenceStatus(u.last_active) }));
  return {
    onlineCount: withStatus.filter((u) => u.status === "online").length,
    awayCount: withStatus.filter((u) => u.status === "away").length,
    users: withStatus
  };
}

export function getUserPresenceMap(): Map<string, PresenceStatus> {
  const { users } = getPresenceSummary();
  return new Map(users.map((u) => [u.id, u.status]));
}

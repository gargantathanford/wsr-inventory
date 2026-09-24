import { getDb } from "./db";

export function directChannelKey(userA: string, userB: string): string {
  return [userA, userB].sort().join(":");
}

export function teamChannelKey(subsystemId: string): string {
  return `team:${subsystemId}`;
}

/** Total unread count across all of a user's channels — one cheap query, used by the floating widget badge. */
export function getUnreadCount(userId: string): number {
  const db = getDb();
  // Channels this user participates in: any DIRECT channel containing their id, plus TEAM channels for subsystems they belong to.
  const row = db
    .prepare(
      `
      SELECT COUNT(*) as c FROM messages m
      WHERE m.sender_id != ?
        AND (
          (m.channel_type = 'DIRECT' AND m.channel_key LIKE '%' || ? || '%')
          OR (m.channel_type = 'TEAM' AND m.channel_key IN (
            SELECT 'team:' || subsystem_id FROM subsystem_members WHERE user_id = ?
          ))
        )
        AND m.created_at > COALESCE(
          (SELECT last_read_at FROM message_reads WHERE user_id = ? AND channel_key = m.channel_key),
          '1970-01-01'
        )
      `
    )
    .get(userId, userId, userId, userId) as { c: number };
  return row.c;
}

export function getUserChannels(userId: string) {
  const db = getDb();
  // Team channels: every subsystem this user belongs to.
  const teamChannels = db
    .prepare(
      `SELECT s.id as subsystem_id, s.name, 'team:' || s.id as channel_key
       FROM subsystem_members sm JOIN subsystems s ON s.id = sm.subsystem_id
       WHERE sm.user_id = ?`
    )
    .all(userId) as { subsystem_id: string; name: string; channel_key: string }[];

  // Direct channels: anyone this user has exchanged a message with.
  const directPartners = db
    .prepare(
      `SELECT DISTINCT channel_key FROM messages WHERE channel_type = 'DIRECT' AND channel_key LIKE '%' || ? || '%'`
    )
    .all(userId) as { channel_key: string }[];

  const directChannels = directPartners
    .map((row) => {
      const [a, b] = row.channel_key.split(":");
      const otherId = a === userId ? b : a;
      const other = db.prepare(`SELECT id, name FROM users WHERE id = ?`).get(otherId) as { id: string; name: string } | undefined;
      return other ? { user_id: other.id, name: other.name, channel_key: row.channel_key } : null;
    })
    .filter(Boolean);

  return { teamChannels, directChannels };
}

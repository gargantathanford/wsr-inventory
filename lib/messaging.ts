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
          -- Anchored to a colon boundary. A bare '%id%' also matches a channel
          -- between two OTHER people whose ids happen to contain this one as a
          -- substring, which would count their messages as this user's unread.
          (m.channel_type = 'DIRECT' AND (m.channel_key LIKE ? || ':%' OR m.channel_key LIKE '%:' || ?))
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
    .get(userId, userId, userId, userId, userId) as { c: number };
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
      `SELECT DISTINCT channel_key FROM messages
        WHERE channel_type = 'DIRECT'
          AND (channel_key LIKE ? || ':%' OR channel_key LIKE '%:' || ?)`
    )
    .all(userId, userId) as { channel_key: string }[];

  const directChannels = directPartners
    .map((row) => {
      const [a, b] = row.channel_key.split(":");
      const otherId = a === userId ? b : a;
      const other = db.prepare(`SELECT id, name FROM users WHERE id = ?`).get(otherId) as { id: string; name: string } | undefined;
      return other ? { user_id: other.id, name: other.name, channel_key: row.channel_key } : null;
    })
    .filter(Boolean);

  // Unread PER CHANNEL, not just a total.
  //
  // The widget had a number on its icon and no way to tell where the message
  // came from, so the only way to find it was to open every conversation in
  // turn. A count you cannot act on is worse than no count: it tells you
  // something needs attention and then makes you hunt for it.
  const unreadRows = db
    .prepare(
      `SELECT m.channel_key, COUNT(*) AS c, MAX(m.created_at) AS latest
         FROM messages m
        WHERE m.sender_id != ?
          AND m.created_at > COALESCE(
                (SELECT last_read_at FROM message_reads WHERE user_id = ? AND channel_key = m.channel_key),
                '1970-01-01')
        GROUP BY m.channel_key`
    )
    .all(userId, userId) as Array<{ channel_key: string; c: number; latest: string }>;

  const unreadByChannel: Record<string, number> = {};
  const latestByChannel: Record<string, string> = {};
  for (const r of unreadRows) {
    unreadByChannel[r.channel_key] = r.c;
    latestByChannel[r.channel_key] = r.latest;
  }

  // Most recent activity first, unread ahead of read. Chronological order is
  // what makes a list of conversations scannable; alphabetical by whoever
  // happens to be named is not.
  const withUnread = <T extends { channel_key: string }>(list: T[]) =>
    list
      .map((c) => ({ ...c, unread: unreadByChannel[c.channel_key] ?? 0, latest: latestByChannel[c.channel_key] ?? "" }))
      .sort((a, b) => (b.unread > 0 ? 1 : 0) - (a.unread > 0 ? 1 : 0) || b.latest.localeCompare(a.latest));

  return {
    teamChannels: withUnread(teamChannels),
    directChannels: withUnread(directChannels as Array<{ channel_key: string; user_id: string; name: string }>)
  };
}

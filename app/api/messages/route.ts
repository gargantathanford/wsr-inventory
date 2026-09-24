import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";
import { getSession, subsystemsMemberOf } from "@/lib/auth";
import { directChannelKey, teamChannelKey, getUnreadCount, getUserChannels } from "@/lib/messaging";

export async function GET(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const db = getDb();

  const channelKey = searchParams.get("channel");
  if (!channelKey) {
    const { teamChannels, directChannels } = getUserChannels(user.id);
    return NextResponse.json({ teamChannels, directChannels, unreadCount: getUnreadCount(user.id) });
  }

  // Authorization: only allow reading channels this user actually belongs to.
  const isDirectParticipant = channelKey.split(":").includes(user.id);
  const isTeamMember = channelKey.startsWith("team:") && subsystemsMemberOf(user.id).includes(channelKey.slice(5));
  if (!isDirectParticipant && !isTeamMember) {
    return NextResponse.json({ error: "Not a member of this channel." }, { status: 403 });
  }

  const messages = db
    .prepare(
      `SELECT m.*, u.name as sender_name FROM messages m JOIN users u ON u.id = m.sender_id
       WHERE m.channel_key = ? ORDER BY m.created_at ASC LIMIT 200`
    )
    .all(channelKey);

  db.prepare(
    `INSERT INTO message_reads (id, user_id, channel_key, last_read_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, channel_key) DO UPDATE SET last_read_at = datetime('now')`
  ).run(newId("mread"), user.id, channelKey);

  return NextResponse.json({ messages });
}

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const text = (body.body || "").trim();
  if (!text) return NextResponse.json({ error: "Message cannot be empty." }, { status: 400 });
  if (text.length > 2000) return NextResponse.json({ error: "Message too long." }, { status: 400 });

  const db = getDb();
  let channelType: "DIRECT" | "TEAM";
  let channelKey: string;

  if (body.recipient_user_id) {
    channelType = "DIRECT";
    channelKey = directChannelKey(user.id, body.recipient_user_id);
  } else if (body.subsystem_id) {
    if (!subsystemsMemberOf(user.id).includes(body.subsystem_id) && user.role !== "ADMIN" && user.role !== "CHIEF_ENGINEER") {
      return NextResponse.json({ error: "You are not a member of that team." }, { status: 403 });
    }
    channelType = "TEAM";
    channelKey = teamChannelKey(body.subsystem_id);
  } else {
    return NextResponse.json({ error: "Specify recipient_user_id or subsystem_id." }, { status: 400 });
  }

  const id = newId("msg");
  db.prepare(
    `INSERT INTO messages (id, sender_id, channel_type, channel_key, body) VALUES (?, ?, ?, ?, ?)`
  ).run(id, user.id, channelType, channelKey, text);

  // Sending counts as having read up to now, so your own message doesn't ping you as unread.
  db.prepare(
    `INSERT INTO message_reads (id, user_id, channel_key, last_read_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, channel_key) DO UPDATE SET last_read_at = datetime('now')`
  ).run(newId("mread"), user.id, channelKey);

  return NextResponse.json({ id, channel_key: channelKey }, { status: 201 });
}

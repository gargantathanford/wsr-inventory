"use client";

import { useEffect, useRef, useState } from "react";

interface Channel {
  channel_key: string;
  name: string;
}

export function MessagingWidget({ currentUserId }: { currentUserId: string }) {
  const [minimized, setMinimized] = useState(true);
  const [unread, setUnread] = useState(0);
  const [teamChannels, setTeamChannels] = useState<Channel[]>([]);
  const [directChannels, setDirectChannels] = useState<any[]>([]);
  const [activeChannel, setActiveChannel] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [draft, setDraft] = useState("");
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [showNewDm, setShowNewDm] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Poll unread count regardless of minimized state — this is the one thing that must stay cheap.
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/messages");
        if (!res.ok || cancelled) return;
        const data = await res.json();
        setUnread(data.unreadCount || 0);
        setTeamChannels(data.teamChannels.map((t: any) => ({ channel_key: t.channel_key, name: t.name })));
        setDirectChannels(data.directChannels);
      } catch {
        /* messaging is a nicety, fail silent */
      }
    }
    poll();
    const id = setInterval(poll, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Poll active channel messages only while the widget is open — no reason to hit the DB otherwise.
  useEffect(() => {
    if (minimized || !activeChannel) return;
    let cancelled = false;
    async function poll() {
      const res = await fetch(`/api/messages?channel=${encodeURIComponent(activeChannel!)}`);
      if (!res.ok || cancelled) return;
      const data = await res.json();
      setMessages(data.messages || []);
    }
    poll();
    const id = setInterval(poll, 5_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [minimized, activeChannel]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function send() {
    if (!draft.trim() || !activeChannel) return;
    const isTeam = activeChannel.startsWith("team:");
    const recipientId = activeChannel.split(":").find((p) => p !== currentUserId);
    const payload = isTeam ? { subsystem_id: activeChannel.slice(5), body: draft.trim() } : { recipient_user_id: recipientId, body: draft.trim() };
    setDraft("");
    await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const res = await fetch(`/api/messages?channel=${encodeURIComponent(activeChannel)}`);
    const data = await res.json();
    setMessages(data.messages || []);
  }

  async function openNewDm() {
    if (users.length === 0) {
      const res = await fetch("/api/users/directory");
      const data = await res.json();
      setUsers(data.users || []);
    }
    setShowNewDm(true);
  }

  const activeLabel =
    teamChannels.find((c) => c.channel_key === activeChannel)?.name ||
    directChannels.find((c) => c.channel_key === activeChannel)?.name ||
    "";

  if (minimized) {
    return (
      <button
        onClick={() => setMinimized(false)}
        className="fixed bottom-5 right-5 z-40 h-12 w-12 rounded-full bg-signal text-graphite-950 shadow-panel flex items-center justify-center hover:bg-signal-bright transition-colors"
        aria-label="Open messaging"
      >
        <ChatIcon />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-telemetry-red text-white text-[10px] font-mono font-semibold flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-40 w-80 panel flex flex-col shadow-panel" style={{ height: 420 }}>
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-graphite-800 shrink-0">
        <span className="font-mono text-xs text-graphite-200">Warp Speed Messaging</span>
        <button onClick={() => setMinimized(true)} className="text-graphite-500 hover:text-graphite-200 text-sm px-1">
          —
        </button>
      </div>

      {!activeChannel ? (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          <div>
            <div className="data-label mb-1.5">TEAM CHANNELS</div>
            <div className="space-y-1">
              {teamChannels.map((c) => (
                <button
                  key={c.channel_key}
                  onClick={() => setActiveChannel(c.channel_key)}
                  className="w-full text-left text-xs px-2 py-1.5 rounded-sm hover:bg-graphite-850 text-graphite-300"
                >
                  # {c.name}
                </button>
              ))}
              {teamChannels.length === 0 && <div className="text-xs text-graphite-600">No team channels yet.</div>}
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="data-label">DIRECT MESSAGES</div>
              <button onClick={openNewDm} className="text-[10px] font-mono text-signal hover:text-signal-bright">
                + NEW
              </button>
            </div>
            <div className="space-y-1">
              {directChannels.map((c: any) => (
                <button
                  key={c.channel_key}
                  onClick={() => setActiveChannel(c.channel_key)}
                  className="w-full text-left text-xs px-2 py-1.5 rounded-sm hover:bg-graphite-850 text-graphite-300"
                >
                  {c.name}
                </button>
              ))}
              {directChannels.length === 0 && <div className="text-xs text-graphite-600">No conversations yet.</div>}
            </div>
            {showNewDm && (
              <select
                className="input text-xs mt-2"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) {
                    setActiveChannel(`dm-pending:${e.target.value}`);
                    setShowNewDm(false);
                  }
                }}
              >
                <option value="" disabled>
                  Select a person…
                </option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-graphite-800 shrink-0">
            <button onClick={() => setActiveChannel(null)} className="text-graphite-500 hover:text-graphite-200 text-xs">
              ←
            </button>
            <span className="text-xs text-graphite-300 truncate">
              {activeChannel.startsWith("dm-pending:") ? users.find((u) => u.id === activeChannel.split(":")[1])?.name : activeLabel}
            </span>
          </div>
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2">
            {messages.map((m) => (
              <div key={m.id} className="text-xs">
                <span className="font-mono text-graphite-500">{m.sender_name}</span>{" "}
                <span className="font-mono text-[10px] text-graphite-600">{m.created_at?.slice(11, 16)}</span>
                <div className="text-graphite-200 mt-0.5">{m.body}</div>
              </div>
            ))}
            {messages.length === 0 && !activeChannel.startsWith("dm-pending:") && (
              <div className="text-xs text-graphite-600">No messages yet — say hello.</div>
            )}
          </div>
        </>
      )}

      {activeChannel && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (activeChannel.startsWith("dm-pending:")) {
              const uid = activeChannel.split(":")[1];
              if (!draft.trim()) return;
              const body = draft.trim();
              setDraft("");
              await fetch("/api/messages", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ recipient_user_id: uid, body })
              });
              const listRes = await fetch("/api/messages");
              const listData = await listRes.json();
              setDirectChannels(listData.directChannels);
              const found = listData.directChannels.find((c: any) => c.user_id === uid);
              if (found) setActiveChannel(found.channel_key);
            } else {
              send();
            }
          }}
          className="flex items-center gap-2 p-2.5 border-t border-graphite-800 shrink-0"
        >
          <input
            className="input text-xs flex-1 py-1.5"
            placeholder="Type a message…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" className="btn-primary text-xs py-1.5 px-3">
            Send
          </button>
        </form>
      )}
    </div>
  );
}

function ChatIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

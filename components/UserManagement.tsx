"use client";

import { useEffect, useState } from "react";

type Membership = { subsystem_id: string; subsystem_name: string; role_in_subsystem: "LEADER" | "MEMBER" };
type UserRow = {
  id: string;
  name: string;
  email: string;
  phone_number: string | null;
  role: "ADMIN" | "CHIEF_ENGINEER" | "TEAM_LEADER" | "TEAM_MEMBER";
  is_active: number;
  created_at: string;
  presence: "online" | "away" | "offline";
  memberships: Membership[];
};

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Admin",
  CHIEF_ENGINEER: "Chief Engineer",
  TEAM_LEADER: "Team Leader",
  TEAM_MEMBER: "Team Member"
};
const ROLES = ["ADMIN", "CHIEF_ENGINEER", "TEAM_LEADER", "TEAM_MEMBER"];

const PRESENCE_DOT: Record<string, string> = {
  online: "bg-telemetry-green",
  away: "bg-telemetry-amber",
  offline: "bg-graphite-600"
};

function teamLedLabel(memberships: Membership[]): string | null {
  const led = memberships.filter((m) => m.role_in_subsystem === "LEADER");
  if (led.length === 0) return null;
  return led.map((m) => m.subsystem_name).join(", ");
}

export function UserManagement({
  subsystems,
  currentUserId
}: {
  subsystems: { id: string; name: string }[];
  currentUserId: string;
}) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    const res = await fetch("/api/users");
    if (res.ok) {
      const data = await res.json();
      setUsers(data.users);
    }
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="space-y-4">
      {error && (
        <div className="text-sm text-telemetry-red font-mono border border-telemetry-red/40 bg-telemetry-red/10 rounded-sm px-3 py-2">
          {error}
        </div>
      )}

      <div className="flex justify-between items-center">
        <span className="data-label">{loading ? "LOADING…" : `${users.length} USERS`}</span>
        <button className="btn-primary" onClick={() => setCreating((v) => !v)}>
          {creating ? "Cancel" : "+ New user"}
        </button>
      </div>

      {creating && (
        <NewUserForm
          subsystems={subsystems}
          onCreated={() => {
            setCreating(false);
            refresh();
          }}
          onError={setError}
        />
      )}

      <div className="panel divide-y divide-graphite-800">
        {users.map((u) => {
          const teamLed = teamLedLabel(u.memberships);
          return (
            <div key={u.id}>
              <div className="p-4 flex items-center justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full shrink-0 ${PRESENCE_DOT[u.presence]}`} title={u.presence} />
                    <span className={`text-sm ${u.is_active ? "text-graphite-100" : "text-graphite-500 line-through"}`}>
                      {u.name}
                    </span>
                    {!u.is_active && (
                      <span className="pill border-graphite-600 text-graphite-500 bg-graphite-850">Deactivated</span>
                    )}
                    {u.id === currentUserId && (
                      <span className="pill border-signal/50 text-signal bg-signal/10">You</span>
                    )}
                  </div>
                  <div className="font-mono text-[11px] text-graphite-500">
                    {u.email}
                    {u.phone_number ? ` · ${u.phone_number}` : ""}
                  </div>
                  {u.role !== "TEAM_LEADER" && (
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {u.memberships.map((m) => (
                        <span key={m.subsystem_id} className="pill border-graphite-600 text-graphite-400 bg-graphite-800">
                          {m.subsystem_name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="pill border-graphite-600 text-graphite-300 bg-graphite-800">
                    Role: {ROLE_LABEL[u.role]}
                    {u.role === "TEAM_LEADER" && teamLed ? ` · Team: ${teamLed}` : ""}
                  </span>
                  <button className="btn-ghost text-xs" onClick={() => setExpanded(expanded === u.id ? null : u.id)}>
                    {expanded === u.id ? "Close" : "Manage"}
                  </button>
                </div>
              </div>
              {expanded === u.id && (
                <UserEditPanel
                  user={u}
                  subsystems={subsystems}
                  currentUserId={currentUserId}
                  onChanged={refresh}
                  onError={setError}
                />
              )}
            </div>
          );
        })}
        {!loading && users.length === 0 && <div className="p-4 text-sm text-graphite-500">No users found.</div>}
      </div>
    </div>
  );
}

function NewUserForm({
  subsystems,
  onCreated,
  onError
}: {
  subsystems: { id: string; name: string }[];
  onCreated: () => void;
  onError: (e: string | null) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [role, setRole] = useState("TEAM_MEMBER");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    onError(null);
    const fd = new FormData(e.currentTarget);
    const payload = Object.fromEntries(fd.entries());
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      onError(typeof data.error === "string" ? data.error : "Could not create user.");
      return;
    }
    (e.target as HTMLFormElement).reset();
    setRole("TEAM_MEMBER");
    onCreated();
  }

  return (
    <form onSubmit={onSubmit} className="panel p-4 grid sm:grid-cols-4 gap-3">
      <input className="input" name="name" placeholder="Full name" required />
      <input className="input" name="email" type="email" placeholder="Email" required />
      <input className="input" name="phone_number" type="tel" placeholder="Phone number (optional)" />
      <input className="input" name="password" type="password" placeholder="Temporary password" required minLength={6} />
      <select className="input" name="role" value={role} onChange={(e) => setRole(e.target.value)}>
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABEL[r]}
          </option>
        ))}
      </select>
      {role === "TEAM_LEADER" && (
        <select className="input sm:col-span-2" name="team_led" defaultValue="">
          <option value="" disabled>
            Team Led — select a team
          </option>
          {subsystems.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}
      <div className="sm:col-span-4">
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? "Creating…" : "Create user"}
        </button>
      </div>
    </form>
  );
}

function UserEditPanel({
  user,
  subsystems,
  currentUserId,
  onChanged,
  onError
}: {
  user: UserRow;
  subsystems: { id: string; name: string }[];
  currentUserId: string;
  onChanged: () => void;
  onError: (e: string | null) => void;
}) {
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone_number || "");
  const [role, setRole] = useState(user.role);
  const [teamLed, setTeamLed] = useState(
    user.memberships.find((m) => m.role_in_subsystem === "LEADER")?.subsystem_id || ""
  );
  const [active, setActive] = useState(!!user.is_active);
  const [newPassword, setNewPassword] = useState("");
  const [subsystemToAdd, setSubsystemToAdd] = useState("");
  const [addAsLeader, setAddAsLeader] = useState(false);
  const [saving, setSaving] = useState(false);
  const isSelf = user.id === currentUserId;

  async function patch(body: Record<string, any>) {
    onError(null);
    const res = await fetch(`/api/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      onError(typeof data.error === "string" ? data.error : "Update failed.");
      return false;
    }
    onChanged();
    return true;
  }

  async function saveProfile() {
    setSaving(true);
    const body: Record<string, any> = { name, phone_number: phone };
    if (!isSelf) body.role = role;
    if (role === "TEAM_LEADER" && teamLed) body.team_led = teamLed;
    await patch(body);
    setSaving(false);
  }

  async function toggleActive() {
    const next = !active;
    setSaving(true);
    const ok = await patch({ is_active: next });
    if (ok) setActive(next);
    setSaving(false);
  }

  async function resetPassword() {
    if (newPassword.length < 6) {
      onError("Password must be at least 6 characters.");
      return;
    }
    setSaving(true);
    const ok = await patch({ password: newPassword });
    if (ok) setNewPassword("");
    setSaving(false);
  }

  async function deleteUser() {
    if (!confirm(`Delete ${user.name}? This cannot be undone.`)) return;
    const res = await fetch(`/api/users/${user.id}`, { method: "DELETE" });
    if (res.ok) onChanged();
    else {
      const data = await res.json().catch(() => ({}));
      onError(data.error || "Could not delete user.");
    }
  }

  async function addMembership() {
    if (!subsystemToAdd) return;
    setSaving(true);
    await fetch(`/api/users/${user.id}/subsystems`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subsystem_id: subsystemToAdd, role_in_subsystem: addAsLeader ? "LEADER" : "MEMBER" })
    });
    setSaving(false);
    setSubsystemToAdd("");
    onChanged();
  }

  async function removeMembership(subsystemId: string) {
    setSaving(true);
    await fetch(`/api/users/${user.id}/subsystems?subsystem_id=${subsystemId}`, { method: "DELETE" });
    setSaving(false);
    onChanged();
  }

  const availableSubsystems = subsystems.filter((s) => !user.memberships.some((m) => m.subsystem_id === s.id));
  const profileDirty =
    name !== user.name ||
    phone !== (user.phone_number || "") ||
    (!isSelf && role !== user.role) ||
    (role === "TEAM_LEADER" && teamLed && teamLed !== (user.memberships.find((m) => m.role_in_subsystem === "LEADER")?.subsystem_id || ""));

  return (
    <div className="px-4 pb-4 bg-graphite-850/40 border-t border-graphite-800 space-y-4">
      <div className="grid sm:grid-cols-2 gap-4 pt-4">
        <div>
          <div className="data-label mb-1.5">FULL NAME</div>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <div className="data-label mb-1.5">PHONE NUMBER</div>
          <input className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="—" />
        </div>
        <div>
          <div className="data-label mb-1.5">ROLE</div>
          <select className="input" value={role} disabled={isSelf} onChange={(e) => setRole(e.target.value as any)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
          {isSelf && <div className="text-[11px] text-graphite-500 mt-1">Can't change your own role.</div>}
        </div>
        {role === "TEAM_LEADER" && (
          <div>
            <div className="data-label mb-1.5">TEAM LED</div>
            <select className="input" value={teamLed} onChange={(e) => setTeamLed(e.target.value)}>
              <option value="">Select a team…</option>
              {subsystems.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <button className="btn-primary text-xs" disabled={saving || !profileDirty} onClick={saveProfile}>
        Save profile
      </button>

      <div className="grid sm:grid-cols-2 gap-4 pt-2 border-t border-graphite-800">
        <div className="pt-4">
          <div className="data-label mb-1.5">ACCOUNT STATUS</div>
          <button
            className={`btn-ghost text-xs w-full ${active ? "" : "border-telemetry-green/50 text-telemetry-green"}`}
            disabled={saving || isSelf}
            onClick={toggleActive}
          >
            {active ? "Deactivate account" : "Reactivate account"}
          </button>
        </div>

        <div className="pt-4">
          <div className="data-label mb-1.5">RESET PASSWORD</div>
          <div className="flex gap-2">
            <input
              className="input"
              type="password"
              placeholder="New password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <button className="btn-ghost text-xs" disabled={saving || !newPassword} onClick={resetPassword}>
              Set
            </button>
          </div>
        </div>
      </div>

      <div className="pt-2 border-t border-graphite-800">
        <div className="data-label mb-1.5 pt-4">ADDITIONAL SUBSYSTEM ASSIGNMENTS</div>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {user.memberships.map((m) => (
            <span key={m.subsystem_id} className="pill border-graphite-600 text-graphite-300 bg-graphite-800 gap-2">
              {m.subsystem_name}
              {m.role_in_subsystem === "LEADER" ? " · Lead" : ""}
              <button onClick={() => removeMembership(m.subsystem_id)} className="text-graphite-500 hover:text-telemetry-red">
                ×
              </button>
            </span>
          ))}
          {user.memberships.length === 0 && <span className="text-xs text-graphite-500">No subsystems assigned.</span>}
        </div>
        <div className="flex items-center gap-2">
          <select className="input w-56" value={subsystemToAdd} onChange={(e) => setSubsystemToAdd(e.target.value)}>
            <option value="">Add subsystem…</option>
            {availableSubsystems.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-graphite-400 font-mono">
            <input type="checkbox" checked={addAsLeader} onChange={(e) => setAddAsLeader(e.target.checked)} />
            as Leader
          </label>
          <button className="btn-ghost text-xs" disabled={!subsystemToAdd || saving} onClick={addMembership}>
            Add
          </button>
        </div>
      </div>

      {!isSelf && (
        <button className="text-xs text-telemetry-red hover:underline" onClick={deleteUser}>
          Delete user permanently
        </button>
      )}
    </div>
  );
}

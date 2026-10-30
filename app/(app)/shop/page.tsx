import { getSession, isLeadership } from "@/lib/auth";
import { getOpenSession, getSessions, getTeamHours, voidStaleSessions } from "@/lib/xp/store";
import { PRESENCE_XP_ENABLED, SHOP } from "@/lib/xp/rules";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CheckInControl } from "@/components/shop/CheckInControl";

const hhmm = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
};

export default async function ShopPage() {
  const user = (await getSession())!;
  voidStaleSessions();

  const open = getOpenSession(user.id);
  const sessions = getSessions(user.id, 30);
  const settled = sessions.filter((s) => s.state === "settled");
  const myMinutes = settled.reduce((a, s) => a + s.verified_minutes + s.unverified_minutes, 0);
  const voided = sessions.filter((s) => s.state === "void").length;

  const lead = isLeadership(user);
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const team = lead ? getTeamHours(since) : [];

  return (
    <div className="p-6 md:p-8 max-w-[1100px] mx-auto space-y-8">
      <Breadcrumbs items={[{ label: "Shop time" }]} />

      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="data-label">SHOP TIME</div>
          <h1 className="text-2xl font-semibold text-graphite-100 mt-1">
            {open ? "You are checked in" : "Not checked in"}
          </h1>
          <p className="text-xs text-graphite-500 mt-2 max-w-xl leading-relaxed">
            Check in when you start work in the shop and out when you leave. Hours are recorded for the team&apos;s
            own records and for competition documentation.
            {!PRESENCE_XP_ENABLED && " Shop time does not earn XP yet."}
          </p>
        </div>
        <CheckInControl />
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <Stat label="YOUR HOURS, 30 DAYS" value={hhmm(myMinutes)} />
        <Stat label="SESSIONS" value={String(settled.length)} />
        <Stat
          label="VOIDED"
          value={String(voided)}
          hint={voided > 0 ? `left open past ${SHOP.autoVoidHourLocal}:00` : undefined}
        />
      </div>

      <section className="panel p-6">
        <h2 className="text-sm font-medium text-graphite-200">Your sessions</h2>
        {sessions.length === 0 ? (
          <p className="text-sm text-graphite-500 mt-3">
            No sessions yet. Check in above when you next work in the shop.
          </p>
        ) : (
          <table className="w-full mt-4 text-xs">
            <thead>
              <tr className="text-left text-graphite-500">
                <th className="font-normal pb-2">In</th>
                <th className="font-normal pb-2">Out</th>
                <th className="font-normal pb-2 text-right">Time</th>
                <th className="font-normal pb-2">State</th>
              </tr>
            </thead>
            <tbody className="font-mono text-graphite-300">
              {sessions.map((s) => (
                <tr key={s.id} className="border-t border-graphite-800">
                  <td className="py-2">{new Date(s.opened_at).toLocaleString()}</td>
                  <td className="py-2">{s.closed_at ? new Date(s.closed_at).toLocaleString() : "—"}</td>
                  <td className="py-2 text-right">
                    {s.state === "open" ? "running" : hhmm(s.verified_minutes + s.unverified_minutes)}
                  </td>
                  <td className="py-2">
                    <span
                      className={
                        s.state === "settled"
                          ? "text-telemetry-green"
                          : s.state === "open"
                          ? "text-telemetry-blue"
                          : "text-graphite-500"
                      }
                    >
                      {s.state}
                    </span>
                    {s.correction_note && (
                      <span className="block font-sans text-[10px] text-graphite-600 mt-0.5 max-w-xs">
                        {s.correction_note}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {lead && (
        <section className="panel p-6">
          <h2 className="text-sm font-medium text-graphite-200">Team hours, last 30 days</h2>
          <p className="text-[11px] text-graphite-500 mt-1">
            Visible to leads, the Chief Engineer and admins — not to the whole team. Hours are self-reported; treat
            them as a record of what people say they did, not a verified measurement.
          </p>
          <table className="w-full mt-4 text-xs">
            <thead>
              <tr className="text-left text-graphite-500">
                <th className="font-normal pb-2">Member</th>
                <th className="font-normal pb-2 text-right">Hours</th>
                <th className="font-normal pb-2 text-right">Sessions</th>
                <th className="font-normal pb-2 text-right">Voided</th>
              </tr>
            </thead>
            <tbody>
              {team.map((r) => (
                <tr key={r.id} className="border-t border-graphite-800">
                  <td className="py-2 text-graphite-200">{r.name}</td>
                  <td className="py-2 text-right font-mono text-graphite-300">{hhmm(r.minutes)}</td>
                  <td className="py-2 text-right font-mono text-graphite-400">{r.sessions}</td>
                  <td className="py-2 text-right font-mono text-graphite-500">{r.voided || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="panel p-5">
      <div className="data-label">{label}</div>
      <div className="stat-figure mt-1 text-2xl text-graphite-100">{value}</div>
      {hint && <div className="text-[10px] text-graphite-600 mt-1">{hint}</div>}
    </div>
  );
}

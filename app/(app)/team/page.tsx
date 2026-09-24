import { getTeamsOverview } from "@/lib/queries";
import { getPresenceSummary } from "@/lib/presence";
import { OnlineCounter } from "@/components/OnlineCounter";
import { TeamGroup } from "@/components/TeamGroup";

export default async function TeamPage() {
  const teams = getTeamsOverview();
  const { users } = getPresenceSummary();
  const presenceMap: Record<string, "online" | "away" | "offline"> = {};
  for (const u of users) presenceMap[u.id] = u.status;

  const teamsWithPeople = teams.filter((t) => t.leaders.length > 0 || t.members.length > 0);
  const unassigned = teams.filter((t) => t.leaders.length === 0 && t.members.length === 0);

  return (
    <div className="p-6 md:p-8 max-w-[1000px] mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="data-label">TEAMS</div>
          <h1 className="text-2xl font-semibold text-graphite-100 mt-1">Organizational structure</h1>
        </div>
        <OnlineCounter />
      </div>

      <div className="space-y-3">
        {teamsWithPeople.map((t) => (
          <TeamGroup
            key={t.id}
            subsystemName={t.name}
            subsystemSlug={t.slug}
            leaders={t.leaders}
            members={t.members}
            presenceMap={presenceMap}
          />
        ))}
      </div>

      {unassigned.length > 0 && (
        <div>
          <div className="data-label mb-2 mt-8">TEAMS WITHOUT ASSIGNED PEOPLE</div>
          <div className="flex flex-wrap gap-1.5">
            {unassigned.map((t) => (
              <span key={t.id} className="pill border-graphite-600 text-graphite-500 bg-graphite-850">
                {t.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

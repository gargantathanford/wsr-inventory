import { getSession } from "@/lib/auth";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ChangePasswordForm } from "@/components/ChangePasswordForm";

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Admin",
  CHIEF_ENGINEER: "Chief Engineer",
  TEAM_LEADER: "Team Lead",
  TEAM_MEMBER: "Team Member"
};

export default async function AccountPage() {
  const user = (await getSession())!;

  return (
    <div className="p-6 md:p-8 max-w-[900px] mx-auto space-y-8">
      <Breadcrumbs items={[{ label: "Your account" }]} />

      <div>
        <div className="data-label">YOUR ACCOUNT</div>
        <h1 className="text-2xl font-semibold text-graphite-100 mt-1">{user.name}</h1>
        <p className="font-mono text-xs text-graphite-400 mt-2">
          {user.email} · {ROLE_LABEL[user.role] ?? user.role}
        </p>
      </div>

      <ChangePasswordForm name={user.name} email={user.email} />
    </div>
  );
}

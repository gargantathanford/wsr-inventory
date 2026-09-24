import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { getAllSubsystems } from "@/lib/queries";
import { UserManagement } from "@/components/UserManagement";

export default async function UsersSettingsPage() {
  const user = await getSession();
  if (!user || user.role !== "ADMIN") redirect("/dashboard");

  const subsystems = getAllSubsystems();

  return (
    <div className="p-6 md:p-8 max-w-[1000px] mx-auto space-y-6">
      <div>
        <Link href="/settings" className="text-xs font-mono text-graphite-500 hover:text-graphite-200">
          ← SETTINGS
        </Link>
        <h1 className="text-2xl font-semibold text-graphite-100 mt-1">User management</h1>
        <p className="text-sm text-graphite-400 mt-1">
          Create accounts, assign roles, and manage subsystem leadership. Only admins can see this page.
        </p>
      </div>

      <UserManagement subsystems={subsystems.map((s: any) => ({ id: s.id, name: s.name }))} currentUserId={user.id} />
    </div>
  );
}

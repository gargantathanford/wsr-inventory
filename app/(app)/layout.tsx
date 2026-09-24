import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";
import { MessagingWidget } from "@/components/MessagingWidget";

// Every page here is per-user. Without this, `next build` tries to pre-render them,
// and pages that query before the session check open (and create) the database at
// build time — racing across build workers ("database is locked").
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSession();
  if (!user) redirect("/login");

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar user={user} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar user={user} />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
      <MessagingWidget currentUserId={user.id} />
    </div>
  );
}

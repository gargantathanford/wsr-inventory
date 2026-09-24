import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getAllSubsystems } from "@/lib/queries";
import { ProcedureForm } from "@/components/ProcedureForm";

export default async function NewProcedurePage() {
  const user = await getSession();
  if (!user || user.role === "TEAM_MEMBER") redirect("/procedures");
  const subsystems = getAllSubsystems();

  return (
    <div className="p-6 md:p-8 max-w-[1400px] mx-auto space-y-6">
      <div>
        <div className="data-label">PROCEDURES</div>
        <h1 className="text-2xl font-semibold text-graphite-100 mt-1">Add Procedure</h1>
      </div>
      <ProcedureForm subsystems={subsystems.map((s: any) => ({ id: s.id, name: s.name }))} />
    </div>
  );
}

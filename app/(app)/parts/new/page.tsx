import { getAllSubsystems } from "@/lib/queries";
import { PartForm } from "@/components/PartForm";

export default async function NewPartPage() {
  const subsystems = getAllSubsystems();
  return (
    <div className="p-6 md:p-8 max-w-[1400px] mx-auto space-y-6">
      <div>
        <div className="data-label">PARTS DATABASE</div>
        <h1 className="text-2xl font-semibold text-graphite-100 mt-1">New part</h1>
      </div>
      <PartForm subsystems={subsystems} />
    </div>
  );
}

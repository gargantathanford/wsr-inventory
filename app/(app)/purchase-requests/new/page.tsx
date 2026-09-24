import { getAllSubsystems } from "@/lib/queries";
import { NewPurchaseRequestForm } from "@/components/NewPurchaseRequestForm";

export default async function NewPurchaseRequestPage() {
  const subsystems = getAllSubsystems();
  return (
    <div className="p-6 md:p-8 max-w-[1400px] mx-auto space-y-6">
      <div>
        <div className="data-label">PURCHASE REQUESTS</div>
        <h1 className="text-2xl font-semibold text-graphite-100 mt-1">New request</h1>
      </div>
      <NewPurchaseRequestForm subsystems={subsystems.map((s: any) => ({ id: s.id, name: s.name }))} />
    </div>
  );
}

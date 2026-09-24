import { getAllSubsystems } from "@/lib/queries";
import { NewPurchaseOrderForm } from "@/components/NewPurchaseOrderForm";

export default async function NewPurchaseOrderPage() {
  const subsystems = getAllSubsystems();
  return (
    <div className="p-6 md:p-8 max-w-[1400px] mx-auto space-y-6">
      <div>
        <div className="data-label">PURCHASE ORDERS</div>
        <h1 className="text-2xl font-semibold text-graphite-100 mt-1">New Purchase Order</h1>
      </div>
      <NewPurchaseOrderForm subsystems={subsystems.map((s: any) => ({ id: s.id, name: s.name }))} />
    </div>
  );
}

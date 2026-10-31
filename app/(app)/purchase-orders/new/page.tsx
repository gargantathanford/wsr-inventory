import Link from "next/link";
import { getAllSubsystems } from "@/lib/queries";
import { NewPurchaseOrderForm } from "@/components/NewPurchaseOrderForm";
import { getSession } from "@/lib/auth";

/**
 * Guarded server-side, not just by hiding the button.
 *
 * The API already refused TEAM_MEMBER, but this page rendered for anyone who
 * knew the URL — so a member could fill in the entire form and only discover
 * at submit that they were never allowed to. Raising a Purchase Request is the
 * route for them, and the message says so rather than just denying access.
 */
export default async function NewPurchaseOrderPage() {
  const user = await getSession();

  if (user?.role === "TEAM_MEMBER") {
    return (
      <div className="p-6 md:p-8 max-w-2xl mx-auto space-y-5">
        <div>
          <div className="data-label">PURCHASE ORDERS</div>
          <h1 className="text-2xl font-semibold text-graphite-100 mt-1">Raise a Purchase Request instead</h1>
        </div>
        <p className="text-sm text-graphite-400 leading-relaxed">
          Purchase Orders commit team money to a supplier, so they are raised by subsystem leads and
          above. What you want is a Purchase Request: you say what you need and why, your lead reviews
          it, and it becomes an order once approved.
        </p>
        <div className="flex gap-2">
          <Link href="/purchase-requests/new" className="btn-primary">
            Raise a purchase request
          </Link>
          <Link href="/purchase-orders" className="btn-ghost">
            Back to orders
          </Link>
        </div>
      </div>
    );
  }

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

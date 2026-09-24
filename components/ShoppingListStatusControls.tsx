"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const PURCHASE_STATUSES = ["NEEDED", "RESEARCHING", "AWAITING_APPROVAL", "APPROVED", "ORDERED", "RECEIVED", "NO_LONGER_NEEDED"];
const APPROVAL_STATUSES = ["PENDING", "APPROVED", "REJECTED"];

export function ShoppingListStatusControls({
  partId,
  purchaseStatus,
  approvalStatus,
  canEdit
}: {
  partId: string;
  purchaseStatus: string;
  approvalStatus: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [purchase, setPurchase] = useState(purchaseStatus);
  const [approval, setApproval] = useState(approvalStatus);
  const [saving, setSaving] = useState(false);

  async function update(field: "purchase_status" | "approval_status", value: string) {
    setSaving(true);
    await fetch(`/api/parts/${partId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value })
    });
    setSaving(false);
    router.refresh();
  }

  if (!canEdit) {
    return (
      <div className="flex flex-col gap-1 font-mono text-[11px]">
        <span>{purchase.replace(/_/g, " ")}</span>
        <span className="text-graphite-500">{approval}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <select
        className="input text-[11px] py-1 px-1.5 w-36"
        value={purchase}
        disabled={saving}
        onChange={(e) => {
          setPurchase(e.target.value);
          update("purchase_status", e.target.value);
        }}
      >
        {PURCHASE_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s.replace(/_/g, " ")}
          </option>
        ))}
      </select>
      <select
        className="input text-[11px] py-1 px-1.5 w-36"
        value={approval}
        disabled={saving}
        onChange={(e) => {
          setApproval(e.target.value);
          update("approval_status", e.target.value);
        }}
      >
        {APPROVAL_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </div>
  );
}

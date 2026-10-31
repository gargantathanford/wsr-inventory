"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The fields you fill in AFTER an order goes out.
 *
 * The API has always accepted all of these and the detail page has always
 * displayed them — there was simply nowhere to type them, so budget category,
 * tracking number and expected delivery read "—" forever and looked broken.
 *
 * They are edited here rather than on the create form because that is when they
 * exist: a tracking number arrives with the shipping confirmation, days after
 * somebody raised the order. Asking for it up front guarantees a blank field.
 */

const FIELDS: Array<{
  name: string;
  label: string;
  help: string;
  type?: "text" | "date";
  placeholder?: string;
}> = [
  {
    name: "budget_category",
    label: "Budget category",
    help: "Which pot this comes out of — sponsorship, university allocation, a specific grant.",
    placeholder: "e.g. Sponsorship — Phillips 66"
  },
  {
    name: "vendor_order_number",
    label: "Vendor order number",
    help: "Their reference, not ours. What you quote when you ring them about it.",
    placeholder: "e.g. 100-4827193"
  },
  {
    name: "tracking_number",
    label: "Tracking number",
    help: "Arrives with the shipping confirmation. Paste it here so nobody has to dig through email.",
    placeholder: "e.g. 1Z999AA10123456784"
  },
  {
    name: "date_ordered",
    label: "Date ordered",
    help: "When the order actually went to the vendor.",
    type: "date"
  },
  {
    name: "expected_delivery_date",
    label: "Expected delivery",
    help: "What the vendor promised. This is what the shopping list uses to work out lead-time risk.",
    type: "date"
  },
  {
    name: "actual_delivery_date",
    label: "Actual delivery",
    help: "When it turned up. The gap against the expected date is how you learn which vendors to trust.",
    type: "date"
  }
];

export function PurchaseOrderDetailsEditor({ order, canEdit }: { order: any; canEdit: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(FIELDS.map((f) => [f.name, order[f.name] ?? ""]))
  );

  const filled = FIELDS.filter((f) => order[f.name]).length;

  async function save() {
    setSaving(true);
    setError(null);
    // Empty string means "clear it", which is different from not sending the
    // field at all — the route only updates keys present in the body.
    const body: Record<string, string | null> = {};
    for (const f of FIELDS) body[f.name] = values[f.name]?.trim() ? values[f.name].trim() : null;

    const res = await fetch(`/api/purchase-orders/${order.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "Could not save these details.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  if (!canEdit) return null;

  if (!open) {
    return (
      <button className="btn-ghost text-xs" onClick={() => setOpen(true)}>
        {filled === 0 ? "Add shipping and budget details" : `Edit shipping and budget details (${filled}/${FIELDS.length} filled)`}
      </button>
    );
  }

  return (
    <div className="panel p-5 space-y-4">
      <div>
        <div className="data-label">SHIPPING AND BUDGET</div>
        <p className="text-[11px] text-graphite-500 mt-1 leading-relaxed max-w-prose">
          Filled in as the order progresses, not when it is raised. Leave anything blank that you do
          not know yet.
        </p>
      </div>

      {error && <p className="text-xs text-telemetry-red leading-relaxed">{error}</p>}

      <div className="grid sm:grid-cols-2 gap-4">
        {FIELDS.map((f) => (
          <label key={f.name} className="block">
            <span className="data-label block mb-1">{f.label}</span>
            <input
              className="input w-full"
              type={f.type ?? "text"}
              value={values[f.name] ?? ""}
              placeholder={f.placeholder}
              onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
            />
            <span className="block text-[11px] text-graphite-600 mt-1 leading-relaxed">{f.help}</span>
          </label>
        ))}
      </div>

      <div className="flex gap-2">
        <button className="btn-primary text-xs" disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save details"}
        </button>
        <button
          className="btn-ghost text-xs"
          onClick={() => {
            setValues(Object.fromEntries(FIELDS.map((f) => [f.name, order[f.name] ?? ""])));
            setError(null);
            setOpen(false);
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

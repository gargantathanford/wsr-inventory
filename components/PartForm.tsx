"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DESIGN_STATUSES, SPONSOR_ASKS, UNITS, checkPartGates } from "@/lib/partRules";

const STATUSES = [
  "NEEDED",
  "PARTIALLY_OWNED",
  "OWNED",
  "ORDERED",
  "BACKORDERED",
  "MANUFACTURING",
  "AVAILABLE_FOR_INSTALLATION",
  "INSTALLED",
  "UNAVAILABLE",
  "NO_LONGER_NEEDED"
];
const IMPORTANCE = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

const DESIGN_STATUS_HELP: Record<string, string> = {
  PLACEHOLDER: "The line exists but no specific part has been identified yet.",
  CANDIDATE: "A specific part is named, but the price and mass are not confirmed.",
  QUOTED: "A vendor has confirmed price and mass in writing.",
  SELECTED: "Chosen. Needs an acceptance criterion and its governing rule.",
  FROZEN: "Locked at design freeze. Changes from here need a change record."
};

const SPONSOR_ASK_LABEL: Record<string, string> = {
  CASH: "Cash — ask a sponsor to fund the purchase",
  IN_KIND: "In-kind — ask for the part or service to be donated",
  DISCOUNT: "Discount — ask for team pricing",
  BUY: "Buy — team purchases at retail, not pitched to sponsors"
};

type Subsystem = { id: string; name: string; code?: string | null };
type Subteam = { id: string; name: string; subsystem_id: string };

/**
 * New-part form.
 *
 * The parts record has 24 editable fields. Showing all of them at once is how
 * you get a database full of part names and nothing else, so the form is split:
 * what a part cannot exist without is always visible, and the rest opens in
 * sections. Every field carries a line explaining what belongs in it — this
 * form is where most of the team learns what the dashboard expects.
 */
export function PartForm({ subsystems }: { subsystems: Subsystem[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Mirrored in state only where a value changes what the form shows.
  const [subsystemId, setSubsystemId] = useState("");
  const [designStatus, setDesignStatus] = useState("PLACEHOLDER");
  const [acceptance, setAcceptance] = useState("");
  const [governingRule, setGoverningRule] = useState("");
  const [allocMass, setAllocMass] = useState("");
  const [weight, setWeight] = useState("");
  const [costLow, setCostLow] = useState("");
  const [costHigh, setCostHigh] = useState("");
  const [qty, setQty] = useState("1");

  const [subteams, setSubteams] = useState<Subteam[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({
    design: true,
    cost: false,
    mass: false,
    procurement: false,
    detail: false
  });

  // Subteams depend on the chosen subsystem, so they load on change rather than
  // shipping every subteam in the page.
  useEffect(() => {
    if (!subsystemId) {
      setSubteams([]);
      return;
    }
    let live = true;
    fetch(`/api/subteams?subsystem=${encodeURIComponent(subsystemId)}`)
      .then((r) => r.json())
      .then((d) => live && setSubteams(d.subteams ?? []))
      .catch(() => live && setSubteams([]));
    return () => {
      live = false;
    };
  }, [subsystemId]);

  // Same function the server runs, so the form can show the blocker before a
  // round trip. The server still re-checks; this is a courtesy, not a control.
  const gates = useMemo(
    () =>
      checkPartGates({
        design_status: designStatus,
        acceptance_criterion: acceptance,
        cited_rule_count: 0,
        governing_rule: governingRule,
        allocated_mass_kg: allocMass ? Number(allocMass) : null,
        weight_kg: weight ? Number(weight) : null
      }),
    [designStatus, acceptance, governingRule, allocMass, weight]
  );

  const lineLow = costLow && qty ? Number(costLow) * Number(qty) : null;
  const lineHigh = costHigh && qty ? Number(costHigh) * Number(qty) : null;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (gates.errors.length) {
      setError(gates.errors.join(" "));
      return;
    }
    setLoading(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    // Blank inputs post as "" — drop them so optional numbers and dates arrive
    // as absent rather than as an empty string the coercion would reject.
    const payload: Record<string, unknown> = {};
    for (const [k, v] of fd.entries()) if (v !== "") payload[k] = v;

    const res = await fetch("/api/parts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(
        typeof data.error === "string"
          ? data.error
          : data.error
          ? "Some fields were rejected. Check the values and try again."
          : "Could not create part."
      );
      return;
    }
    const data = await res.json();
    router.push(`/parts/${data.id}`);
  }

  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  return (
    <form onSubmit={onSubmit} className="panel p-6 space-y-6 max-w-3xl">
      {error && (
        <div className="text-sm text-telemetry-red font-mono border border-telemetry-red/40 bg-telemetry-red/10 rounded-sm px-3 py-2">
          {error}
        </div>
      )}
      {/* ---- always visible: what a part cannot exist without ---- */}
      <div className="grid sm:grid-cols-2 gap-4">
        <Field
          label="Part name"
          required
          help="What it is, not what it does. 'Rear upright' — not 'the thing holding the hub'."
        >
          <input className="input" name="part_name" required maxLength={200} />
        </Field>
        <Field label="Subsystem" required help="Which subsystem owns this part. Decides who can edit it.">
          <select
            className="input"
            name="subsystem_id"
            required
            value={subsystemId}
            onChange={(e) => setSubsystemId(e.target.value)}
          >
            <option value="" disabled>
              Select subsystem
            </option>
            {subsystems.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code ? `${s.code} — ${s.name}` : s.name}
              </option>
            ))}
          </select>
        </Field>

        {subteams.length > 0 && (
          <Field label="Subteam" help="Optional. A finer grouping inside the subsystem, such as Engine or Intake.">
            <select className="input" name="subteam_id" defaultValue="">
              <option value="">— none —</option>
              {subteams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Quantity required" help="How many the car needs. Spares go on their own line.">
          <input
            className="input"
            type="number"
            min={1}
            name="quantity_required"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
        </Field>
        <Field label="Unit" help="What one of them is. Matters for stock and raw material.">
          <select className="input" name="unit_of_measure" defaultValue="ea">
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Quantity owned" help="How many are physically in the shop right now. Readiness is built from this.">
          <input className="input" type="number" min={0} name="quantity_owned" defaultValue={0} />
        </Field>
      </div>

      <Field
        label="Scope / what it does"
        help="One or two lines on the part's job in the car. This is what somebody reads when they find the part later."
      >
        <textarea className="input min-h-20" name="description" />
      </Field>

      {/* ---- design maturity and compliance ---- */}
      <Section
        title="Design maturity"
        subtitle="Where this part is in the design process — separate from whether it has been bought"
        open={open.design}
        onToggle={() => toggle("design")}
      >
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Design status" help={DESIGN_STATUS_HELP[designStatus]}>
            <select
              className="input"
              name="design_status"
              value={designStatus}
              onChange={(e) => setDesignStatus(e.target.value)}
            >
              {DESIGN_STATUSES.map((d) => (
                <option key={d} value={d}>
                  {d.charAt(0) + d.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Driving target"
            help="Which vehicle target this part exists to hit, e.g. 'Target peak power (hp)'."
          >
            <input className="input" name="driving_target" maxLength={300} />
          </Field>
        </div>

        <Field
          label="Acceptance criterion"
          required={designStatus === "SELECTED" || designStatus === "FROZEN"}
          help="How you will know this part is correct once it is here. A test, a measurement, a check — not 'works properly'."
        >
          <textarea
            className="input min-h-20"
            name="acceptance_criterion"
            value={acceptance}
            onChange={(e) => setAcceptance(e.target.value)}
            maxLength={1000}
            placeholder="Runs reliably; compression and leak-down pass."
          />
        </Field>

        <Field
          label="Governing rule (free text)"
          help="The FSAE clause this part must satisfy. Once the part is saved you can attach real clauses from the ruleset on its page, which is better than typing them here."
        >
          <input
            className="input"
            name="governing_rule"
            value={governingRule}
            onChange={(e) => setGoverningRule(e.target.value)}
            maxLength={500}
            placeholder="T.5.1; T.5.2"
          />
        </Field>

        {gates.errors.length > 0 && (
          <ul className="text-xs text-telemetry-red space-y-1 border-l-2 border-telemetry-red/50 pl-3">
            {gates.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        {gates.warnings.length > 0 && (
          <ul className="text-xs text-graphite-500 space-y-1 border-l-2 border-graphite-700 pl-3">
            {gates.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
      </Section>

      {/* ---- cost ---- */}
      <Section
        title="Cost"
        subtitle="A range until a vendor quotes it. Costs are per unit; line totals are shown as you type"
        open={open.cost}
        onToggle={() => toggle("cost")}
      >
        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="Cost low, per unit" help="Cheapest credible price you have seen.">
            <input
              className="input"
              type="number"
              step="0.01"
              min={0}
              name="estimated_cost_low"
              value={costLow}
              onChange={(e) => setCostLow(e.target.value)}
            />
          </Field>
          <Field label="Cost high, per unit" help="Worst credible case. Leave both equal once quoted.">
            <input
              className="input"
              type="number"
              step="0.01"
              min={0}
              name="estimated_cost_high"
              value={costHigh}
              onChange={(e) => setCostHigh(e.target.value)}
            />
          </Field>
          <Field label="Actual cost, per unit" help="Fill this in once paid. It overrides the estimate everywhere.">
            <input className="input" type="number" step="0.01" min={0} name="actual_cost" />
          </Field>
        </div>
        {lineLow != null && lineHigh != null && (
          <p className="text-xs font-mono text-graphite-400">
            line total: ${lineLow.toLocaleString()} – ${lineHigh.toLocaleString()} for {qty} {" "}
            <span className="text-graphite-600">(per-unit × quantity)</span>
          </p>
        )}
        <Field
          label="Sponsor ask"
          help="How the team intends to get it. This is what sponsor outreach is built from."
        >
          <select className="input" name="sponsor_ask" defaultValue="">
            <option value="">— not decided —</option>
            {SPONSOR_ASKS.map((a) => (
              <option key={a} value={a}>
                {SPONSOR_ASK_LABEL[a]}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      {/* ---- mass ---- */}
      <Section
        title="Mass"
        subtitle="The vehicle has a mass budget and every subsystem gets a share of it"
        open={open.mass}
        onToggle={() => toggle("mass")}
      >
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Allocated mass, kg per unit" help="The target the lead assigns this line before a part is chosen.">
            <input
              className="input"
              type="number"
              step="0.001"
              min={0}
              name="allocated_mass_kg"
              value={allocMass}
              onChange={(e) => setAllocMass(e.target.value)}
            />
          </Field>
          <Field label="Measured mass, kg per unit" help="What it actually weighs. Weigh it; do not trust the datasheet.">
            <input
              className="input"
              type="number"
              step="0.001"
              min={0}
              name="weight_kg"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />
          </Field>
        </div>
      </Section>

      {/* ---- procurement ---- */}
      <Section
        title="Buying it"
        subtitle="Where it comes from and when it has to be ordered"
        open={open.procurement}
        onToggle={() => toggle("procurement")}
      >
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Vendor / supplier" help="Who you would buy it from, or the sponsor you would ask.">
            <input className="input" name="supplier" />
          </Field>
          <Field label="Manufacturer" help="Who makes it, if that differs from who sells it.">
            <input className="input" name="manufacturer" />
          </Field>
          <Field label="Part number" help="The vendor's or manufacturer's number, exactly as they write it.">
            <input className="input" name="part_number" />
          </Field>
          <Field label="Lead time, days" help="Order-to-door. Drives how early this has to be ordered.">
            <input className="input" type="number" min={0} name="lead_time_days" />
          </Field>
          <Field label="Needed by" help="The date it must be in hand. Order-by date is computed from this minus lead time.">
            <input className="input" type="date" name="required_by_date" />
          </Field>
          <Field label="Purchase URL" help="Direct link to the product or datasheet page.">
            <input className="input" name="purchase_url" placeholder="https://" />
          </Field>
        </div>
      </Section>

      {/* ---- stock status and priority ---- */}
      <Section
        title="Status and priority"
        subtitle="Defaults are usually right — change these when you know better"
        open={open.detail}
        onToggle={() => toggle("detail")}
      >
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Stock status" help="Where the physical part is, as distinct from its design status.">
            <select className="input" name="status" defaultValue="NEEDED">
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, " ").toLowerCase()}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Importance"
            help="Critical means the car cannot run or pass tech without it. Use it sparingly or it stops meaning anything."
          >
            <select className="input" name="importance" defaultValue="MEDIUM">
              {IMPORTANCE.map((i) => (
                <option key={i} value={i}>
                  {i.toLowerCase()}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Priority score, 1–10" help="Your own ordering within the same importance level.">
            <input className="input" type="number" min={1} max={10} name="priority_score" defaultValue={5} />
          </Field>
          <Field label="Material" help="Optional. What it is made of, when that matters.">
            <input className="input" name="material" />
          </Field>
        </div>
      </Section>

      <div className="flex items-center gap-3 pt-2">
        <button type="submit" disabled={loading || gates.errors.length > 0} className="btn-primary">
          {loading ? "Creating…" : "Create part"}
        </button>
        {gates.errors.length > 0 && (
          <span className="text-xs text-graphite-500">
            {designStatus.toLowerCase()} parts need the fields above filled in first
          </span>
        )}
      </div>
    </form>
  );
}

function Section({
  title,
  subtitle,
  open,
  onToggle,
  children
}: {
  title: string;
  subtitle?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-graphite-800 pt-4">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-baseline justify-between text-left group"
        aria-expanded={open}
      >
        <span>
          <span className="text-sm font-medium text-graphite-200 group-hover:text-graphite-100">{title}</span>
          {subtitle && <span className="block text-xs text-graphite-500 mt-0.5">{subtitle}</span>}
        </span>
        <span className="font-mono text-xs text-graphite-500 shrink-0 ml-3">{open ? "hide" : "show"}</span>
      </button>
      {open && <div className="mt-4 space-y-4">{children}</div>}
    </div>
  );
}

function Field({
  label,
  children,
  required,
  help
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  help?: string;
}) {
  return (
    <label className="block">
      <span className="data-label block mb-1.5">
        {label}
        {required && <span className="text-signal"> *</span>}
      </span>
      {children}
      {help && <span className="block text-[11px] leading-snug text-graphite-500 mt-1.5">{help}</span>}
    </label>
  );
}

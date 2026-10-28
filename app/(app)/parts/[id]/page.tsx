import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getPartById,
  getPartSuppliers,
  getPartDocuments,
  getPartTools,
  getPartDependencies,
  getPartDependents,
  getPartProcedures,
  lineCost,
  getRuleCitations,
  getActiveRuleset
} from "@/lib/queries";
import { getSession, canEditSubsystem } from "@/lib/auth";
import { ownershipPercent, procurementPriority, priorityBand } from "@/lib/scoring";
import { StatusBadge, ImportanceBadge } from "@/components/StatusBadge";
import { ProgressBar } from "@/components/ProgressBar";
import { PartEditPanel } from "@/components/PartEditPanel";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { DocumentCard } from "@/components/DocumentCard";
import { DocumentUploadForm } from "@/components/DocumentUploadForm";
import { getAllSubsystems } from "@/lib/queries";
import { DependencyGraph } from "@/components/DependencyGraph";
import { DependencyEditor, RemoveDependencyButton } from "@/components/DependencyEditor";
import { RuleCitationPicker } from "@/components/RuleCitationPicker";
import { getAllParts } from "@/lib/queries";

export default async function PartDetailPage({ params }: { params: { id: string } }) {
  const part = getPartById(params.id);
  if (!part) notFound();
  const user = await getSession();
  const canEdit = user ? canEditSubsystem(user, part.subsystem_id) : false;

  const suppliers = getPartSuppliers(part.id);
  const documents = getPartDocuments(part.id);
  const tools = getPartTools(part.id);
  const dependencies = getPartDependencies(part.id);
  const dependents = getPartDependents(part.id);
  const procedures = getPartProcedures(part.id);
  const pct = ownershipPercent(part.quantity_owned, part.quantity_required);
  const priority = procurementPriority({
    status: part.status,
    importance: part.importance,
    priority_score: part.priority_score,
    lead_time_days: part.lead_time_days,
    quantity_required: part.quantity_required,
    quantity_owned: part.quantity_owned,
    dependents_count: dependents.length
  });
  const band = priorityBand(priority);
  const ruleCitations = getRuleCitations("PART", part.id);
  const activeRuleset = getActiveRuleset();

  // Line total, not unit price: quantity matters on a part the team needs 25 of.
  const totalCost = lineCost(part);
  const totalCostLow = lineCost(part, "low");
  const totalCostHigh = lineCost(part, "high");
  const hasCostRange =
    part.actual_cost == null && totalCostHigh > totalCostLow;

  return (
    <div className="p-6 md:p-8 max-w-[1200px] mx-auto space-y-8">
      <div>
        <Breadcrumbs
          items={[
            { label: "Parts Database", href: "/parts" },
            { label: part.part_name }
          ]}
        />
        <div className="flex items-start justify-between mt-3 gap-4 flex-wrap">
          <div>
            <div className="data-label">{part.subsystem_name}</div>
            <h1 className="text-3xl font-semibold text-graphite-100 mt-1">{part.part_name}</h1>
            {part.part_number && (
              <div className="font-mono text-xs text-graphite-500 mt-1">P/N {part.part_number}</div>
            )}
          </div>
          <PartEditPanel part={part} canEdit={canEdit} />
        </div>
      </div>

      <div className="grid sm:grid-cols-4 gap-4">
        <div className="panel p-5">
          <div className="data-label">STATUS</div>
          <div className="mt-2">
            <StatusBadge status={part.status} />
          </div>
        </div>
        <div className="panel p-5">
          <div className="data-label">QUANTITY</div>
          <div className="stat-figure mt-1 text-2xl">
            {part.quantity_owned} / {part.quantity_required}
          </div>
          <ProgressBar pct={pct} colorClass={pct >= 100 ? "bg-telemetry-green" : "bg-telemetry-amber"} />
        </div>
        <div className="panel p-5">
          <div className="data-label">IMPORTANCE</div>
          <div className="mt-2">
            <ImportanceBadge importance={part.importance} />
          </div>
          <div className="text-xs font-mono text-graphite-500 mt-2">Priority {part.priority_score}/10</div>
        </div>
        <div className="panel p-5">
          <div className="data-label">SHOPPING LIST PRIORITY</div>
          <div
            className={`stat-figure mt-1 text-2xl ${
              band === "URGENT"
                ? "text-telemetry-red"
                : band === "HIGH"
                ? "text-telemetry-amber"
                : "text-graphite-100"
            }`}
          >
            {band === "NONE" ? "—" : band}
          </div>
          <div className="text-xs font-mono text-graphite-500 mt-2">
            Score {priority} · importance {part.importance.toLowerCase()}
            {part.lead_time_days != null ? ` · ${part.lead_time_days}d lead` : " · no lead time set"}
            {dependents.length > 0 ? ` · blocks ${dependents.length}` : ""}
          </div>
        </div>
      </div>

      {part.description && (
        <div>
          <h2 className="text-sm font-medium text-graphite-200 mb-2">Description</h2>
          <p className="text-sm text-graphite-400 leading-relaxed max-w-2xl">{part.description}</p>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        <section className="panel p-6">
          <h2 className="text-sm font-medium text-graphite-200">Procurement</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <Row label="Purchase status" value={part.purchase_status.replace(/_/g, " ")} accent />
            <Row label="Approval status" value={part.approval_status} />
            <Row label="Requested by" value={part.requested_by_name || "—"} />
            <Row label="Estimated cost" value={part.estimated_cost != null ? `$${part.estimated_cost.toLocaleString()}` : "—"} />
            <Row label="Actual cost" value={part.actual_cost != null ? `$${part.actual_cost.toLocaleString()}` : "—"} />
            <Row label="Shipping" value={part.shipping_cost != null ? `$${part.shipping_cost.toLocaleString()}` : "—"} />
            <Row label="Total cost" value={`$${totalCost.toLocaleString()}`} accent />
            <Row label="Lead time" value={part.lead_time_days != null ? `${part.lead_time_days} days` : "—"} />
            <Row label="Supplier" value={part.supplier || "—"} />
            <Row label="PO number" value={part.purchase_order_number || "—"} />
            <Row label="Date ordered" value={part.date_ordered || "—"} />
            <Row label="Date received" value={part.date_received || "—"} />
            {part.purchase_url && (
              <div className="pt-2">
                <a href={part.purchase_url} target="_blank" rel="noreferrer" className="btn-primary inline-flex">
                  Visit supplier →
                </a>
              </div>
            )}
          </dl>

          {suppliers.length > 0 && (
            <div className="mt-6 border-t border-graphite-800 pt-4">
              <div className="data-label mb-2">SUPPLIER OPTIONS</div>
              <div className="space-y-2">
                {suppliers.map((s: any) => (
                  <div
                    key={s.id}
                    className={`rounded-sm border px-3 py-2.5 ${
                      s.is_preferred ? "border-signal/50 bg-signal/5" : "border-graphite-700"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-graphite-100">{s.supplier_name}</span>
                      {s.is_preferred ? (
                        <span className="pill border-signal/50 text-signal bg-signal/10">Preferred</span>
                      ) : null}
                    </div>
                    <div className="flex gap-4 mt-1 font-mono text-xs text-graphite-400">
                      <span>{s.cost != null ? `$${s.cost.toLocaleString()}` : "cost n/a"}</span>
                      <span>{s.lead_time_days != null ? `${s.lead_time_days}d lead` : "lead unknown"}</span>
                      {s.url && (
                        <a href={s.url} target="_blank" rel="noreferrer" className="text-signal hover:text-signal-bright">
                          link ↗
                        </a>
                      )}
                    </div>
                    {s.notes && <div className="text-xs text-graphite-500 mt-1">{s.notes}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="panel p-6">
          <h2 className="text-sm font-medium text-graphite-200">Technical information</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <Row label="Manufacturer" value={part.manufacturer || "—"} />
            <Row label="Weight" value={part.weight_kg != null ? `${part.weight_kg} kg` : "—"} />
            <Row label="Dimensions" value={part.dimensions || "—"} />
            <Row label="Material" value={part.material || "N/A"} />
            <Row label="CAD status" value={part.cad_status?.replace(/_/g, " ") || "—"} />
            <Row label="Documentation status" value={part.documentation_status?.replace(/_/g, " ") || "—"} />
          </dl>
          {part.operating_specifications && (
            <div className="mt-4 border-t border-graphite-800 pt-4">
              <div className="data-label mb-1.5">OPERATING SPECIFICATIONS</div>
              <p className="text-sm text-graphite-300 whitespace-pre-line">{part.operating_specifications}</p>
            </div>
          )}

          <div className="mt-6 border-t border-graphite-800 pt-4">
            <div className="data-label mb-2">REQUIRED TOOLS</div>
            {tools.length === 0 ? (
              <p className="text-sm text-graphite-500">No tools linked to this part.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {tools.map((t: any) => (
                  <Link key={t.id} href={`/tools/${t.id}`} className="pill border-graphite-600 text-graphite-300 bg-graphite-800 hover:border-signal/60">
                    {t.tool_name}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {(ruleCitations.length > 0 || canEdit) && (
        <section className="panel p-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h2 className="text-sm font-medium text-graphite-200">Governing rules</h2>
            {activeRuleset && (
              <span className="font-mono text-[10px] text-graphite-600">{activeRuleset.label}</span>
            )}
          </div>
          <div className="mt-4">
            <RuleCitationPicker partId={part.id} citations={ruleCitations} canEdit={canEdit} />
          </div>
          {/* The workbook's free-text rule field, kept visible while leads move
              their citations onto real clauses. */}
          {part.governing_rule && (
            <p className="mt-4 pt-3 border-t border-graphite-800 text-xs text-graphite-500">
              <span className="font-mono text-[10px] text-graphite-600">FROM SPREADSHEET: </span>
              {part.governing_rule}
            </p>
          )}
        </section>
      )}

      {(dependencies.length > 0 || dependents.length > 0 || canEdit) && (
        <section className="panel p-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h2 className="text-sm font-medium text-graphite-200">Dependencies</h2>
            {canEdit && (
              <DependencyEditor
                partId={part.id}
                allParts={getAllParts().map((p) => ({ id: p.id, part_name: p.part_name }))}
                currentDependencyIds={dependencies.map((d) => d.id)}
              />
            )}
          </div>
          <div className="grid sm:grid-cols-2 gap-6 mt-4">
            <div>
              <div className="data-label mb-2">REQUIRES</div>
              {dependencies.length === 0 ? (
                <p className="text-sm text-graphite-500">No dependencies.</p>
              ) : (
                <div className="space-y-1.5">
                  {dependencies.map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center justify-between text-sm rounded-sm border border-graphite-700 px-3 py-2"
                    >
                      <Link href={`/parts/${d.id}`} className="text-graphite-200 hover:text-signal">
                        {d.part_name}
                      </Link>
                      <span className="flex items-center">
                        <StatusBadge status={d.status} />
                        {canEdit && <RemoveDependencyButton partId={part.id} dependsOnId={d.id} />}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <div className="data-label mb-2">BLOCKS</div>
              {dependents.length === 0 ? (
                <p className="text-sm text-graphite-500">Nothing depends on this part.</p>
              ) : (
                <div className="space-y-1.5">
                  {dependents.map((d) => (
                    <Link
                      key={d.id}
                      href={`/parts/${d.id}`}
                      className="flex items-center justify-between text-sm rounded-sm border border-graphite-700 px-3 py-2 hover:border-signal/50"
                    >
                      <span className="text-graphite-200">{d.part_name}</span>
                      <StatusBadge status={d.status} />
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      <section className="panel p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-graphite-200">Documentation</h2>
          {canEdit && (
            <DocumentUploadForm
              subsystems={getAllSubsystems()}
              defaultSubsystemId={part.subsystem_id}
              defaultPartId={part.id}
            />
          )}
        </div>
        {documents.length === 0 ? (
          <p className="text-sm text-graphite-500 mt-3">No documentation attached.</p>
        ) : (
          <div className="mt-3 divide-y divide-graphite-800">
            {documents.map((d: any) => (
              <DocumentCard key={d.id} doc={d} canManage={canEdit} compact />
            ))}
          </div>
        )}
      </section>

      {(dependencies.length > 0 || dependents.length > 0) && (
        <section className="panel p-6">
          <h2 className="text-sm font-medium text-graphite-200 mb-4">Dependency graph</h2>
          <DependencyGraph centerLabel={part.part_name} requires={dependencies} blocks={dependents} />
        </section>
      )}

      {procedures.length > 0 && (
        <section className="panel p-6">
          <h2 className="text-sm font-medium text-graphite-200">Procedures</h2>
          <div className="mt-4 space-y-6">
            {procedures.map((proc: any) => (
              <div key={proc.id}>
                <Link href={`/procedures/${proc.id}`} className="text-sm text-graphite-100 hover:text-signal font-medium">
                  {proc.title}
                </Link>
                {proc.safety_warning && (
                  <div className="mt-2 text-xs text-telemetry-amber border border-telemetry-amber/40 bg-telemetry-amber/10 rounded-sm px-3 py-2">
                    ⚠ {proc.safety_warning}
                  </div>
                )}
                <ol className="mt-2 space-y-1.5 text-sm text-graphite-400 list-decimal list-inside">
                  {proc.steps.map((s: any) => (
                    <li key={s.id}>{s.content}</li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Row({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-graphite-500">{label}</span>
      <span className={`font-mono ${accent ? "text-signal font-semibold" : "text-graphite-200"}`}>{value}</span>
    </div>
  );
}

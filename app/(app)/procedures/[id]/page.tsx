import Link from "next/link";
import { notFound } from "next/navigation";
import { getProcedureById, getAllSubsystems } from "@/lib/queries";
import { getSession, canReviewSubsystem } from "@/lib/auth";
import { StatusBadge } from "@/components/StatusBadge";
import { DocumentCard } from "@/components/DocumentCard";
import { DocumentUploadForm } from "@/components/DocumentUploadForm";
import { ProcedureApprovalPanel, DeleteProcedureButton } from "@/components/ProcedureApprovalPanel";

const CATEGORY_LABEL: Record<string, string> = {
  DASHBOARD_USAGE: "Dashboard Usage",
  NAMING_CONVENTIONS: "Naming Conventions",
  CAD_STANDARDS: "CAD Standards",
  DESIGN_DOCUMENTATION: "Design Documentation",
  DRAWING_RELEASE: "Drawing Release",
  DESIGN_REVIEW: "Design Review",
  PROCUREMENT: "Procurement",
  MANUFACTURING: "Manufacturing",
  TESTING: "Testing",
  DESIGN_CHANGE: "Design Change",
  FILE_STORAGE: "File Storage",
  GENERAL: "General"
};

export default async function ProcedureDetailPage({ params }: { params: { id: string } }) {
  const proc = getProcedureById(params.id);
  if (!proc) notFound();
  const user = await getSession();
  const canReview = !!user && canReviewSubsystem(user, proc.subsystem_id ?? null);
  const canManage = canReview || (user && proc.author_id === user.id);
  const subsystems = getAllSubsystems();

  return (
    <div className="p-6 md:p-8 max-w-[900px] mx-auto space-y-8">
      <div>
        <Link href="/procedures" className="text-xs font-mono text-graphite-500 hover:text-graphite-200">
          ← PROCEDURES
        </Link>
        <div className="flex items-start justify-between mt-2 gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="pill border-graphite-600 text-graphite-300 bg-graphite-800">
                {CATEGORY_LABEL[proc.category] || proc.category}
              </span>
              <StatusBadge status={proc.approval_status} />
              <span className="font-mono text-[11px] text-graphite-500">Rev {proc.revision_number}</span>
            </div>
            <h1 className="text-3xl font-semibold text-graphite-100 mt-2">{proc.title}</h1>
          </div>
          {canManage && <DeleteProcedureButton procedureId={proc.id} />}
        </div>
      </div>

      <ProcedureApprovalPanel procedureId={proc.id} canReview={!!canReview} />

      {proc.safety_warning && (
        <div className="border border-telemetry-amber/40 bg-telemetry-amber/10 rounded-md p-4 text-sm text-telemetry-amber">
          ⚠ {proc.safety_warning}
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-6">
        <div className="panel p-5">
          <div className="data-label mb-1.5">DESCRIPTION</div>
          <p className="text-sm text-graphite-300 whitespace-pre-line">{proc.description || "—"}</p>
        </div>
        <div className="panel p-5">
          <div className="data-label mb-1.5">PURPOSE</div>
          <p className="text-sm text-graphite-300 whitespace-pre-line">{proc.purpose || "—"}</p>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-6 text-sm">
        <Row label="Applicable team(s)" value={proc.subsystem_name || proc.applicable_teams || "All Teams"} />
        <Row label="Author" value={proc.author_name || "—"} />
        <Row label="Created" value={proc.created_at?.slice(0, 10) || "—"} />
        <Row label="Last updated" value={proc.updated_at?.slice(0, 10) || "—"} />
        {proc.approved_by_name && <Row label="Approved by" value={`${proc.approved_by_name} on ${proc.approved_at?.slice(0, 10)}`} />}
        {proc.part_name && <Row label="Related part" value={proc.part_name} />}
      </div>

      {(proc.required_documentation || proc.supporting_links) && (
        <div className="grid sm:grid-cols-2 gap-6">
          {proc.required_documentation && (
            <div className="panel p-5">
              <div className="data-label mb-1.5">REQUIRED DOCUMENTATION</div>
              <p className="text-sm text-graphite-300 whitespace-pre-line">{proc.required_documentation}</p>
            </div>
          )}
          {proc.supporting_links && (
            <div className="panel p-5">
              <div className="data-label mb-1.5">SUPPORTING LINKS</div>
              <p className="text-sm text-graphite-300 whitespace-pre-line">{proc.supporting_links}</p>
            </div>
          )}
        </div>
      )}

      <div>
        <div className="data-label mb-2">STEPS</div>
        <ol className="space-y-2">
          {proc.steps.map((s: any) => (
            <li key={s.id} className="panel p-4 flex gap-4">
              <span className="font-mono text-signal font-semibold shrink-0">{String(s.step_number).padStart(2, "0")}</span>
              <span className="text-sm text-graphite-200 leading-relaxed">{s.content}</span>
            </li>
          ))}
          {proc.steps.length === 0 && <p className="text-sm text-graphite-500">No steps recorded.</p>}
        </ol>
      </div>

      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="data-label">SUPPORTING FILES</div>
          {canManage && (
            <DocumentUploadForm subsystems={subsystems.map((s: any) => ({ id: s.id, name: s.name }))} defaultProcedureId={proc.id} defaultSubsystemId={proc.subsystem_id} />
          )}
        </div>
        {proc.attachments.length === 0 ? (
          <p className="text-sm text-graphite-500">No files attached.</p>
        ) : (
          <div className="panel divide-y divide-graphite-800">
            {proc.attachments.map((d: any) => (
              <DocumentCard key={d.id} doc={d} canManage={!!canManage} compact />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-graphite-800 pb-2">
      <span className="text-graphite-500">{label}</span>
      <span className="text-graphite-200">{value}</span>
    </div>
  );
}

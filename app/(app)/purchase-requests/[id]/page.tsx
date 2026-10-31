import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getSession, canReviewSubsystem } from "@/lib/auth";
import { StatusBadge, ImportanceBadge } from "@/components/StatusBadge";
import { PurchaseRequestActions } from "@/components/PurchaseRequestActions";
import { formatDateTime, formatDay } from "@/lib/datetime";

export default async function PurchaseRequestDetailPage({ params }: { params: { id: string } }) {
  const db = getDb();
  const request = db
    .prepare(
      `SELECT pr.*, u.name as requesting_user_name, s.name as subsystem_name, d.name as decided_by_name
       FROM purchase_requests pr
       JOIN users u ON u.id = pr.requesting_user_id
       LEFT JOIN subsystems s ON s.id = pr.subsystem_id
       LEFT JOIN users d ON d.id = pr.decided_by
       WHERE pr.id = ?`
    )
    .get(params.id) as any;
  if (!request) notFound();

  // Counted here so the heading can say a thread exists without the reader
  // having to scroll to the bottom of the page to find out.
  const events = db
    .prepare(
      `SELECT e.*, u.name as user_name FROM purchase_request_events e LEFT JOIN users u ON u.id = e.user_id
       WHERE e.request_id = ? ORDER BY e.created_at ASC`
    )
    .all(params.id) as any[];

  const commentCount = events.filter((e: any) => e.event_type === "COMMENT").length;
  const infoRequests = events.filter((e: any) => e.event_type === "INFO_REQUESTED").length;

  const user = await getSession();
  const isOwner = !!user && user.id === request.requesting_user_id;
  const isApprover = !!user && canReviewSubsystem(user, request.subsystem_id);

  return (
    <div className="p-6 md:p-8 max-w-[900px] mx-auto space-y-8">
      <Link href="/purchase-requests" className="text-xs font-mono text-graphite-500 hover:text-graphite-200">
        ← PURCHASE REQUESTS
      </Link>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="data-label">{request.request_number}</div>
          <h1 className="text-2xl font-semibold text-graphite-100 mt-1">{request.item_name}</h1>
          <div className="flex items-center gap-2 mt-2">
            <StatusBadge status={request.status} />
            <ImportanceBadge importance={request.priority} />
          </div>
        </div>
        {request.purchase_order_id && (
          <Link href={`/purchase-orders/${request.purchase_order_id}`} className="btn-ghost text-xs">
            View Purchase Order →
          </Link>
        )}
      </div>

      <div className="grid sm:grid-cols-2 gap-6 text-sm">
        <Row label="Requesting user" value={request.requesting_user_name} />
        <Row label="Responsible team" value={request.subsystem_name || "—"} />
        <Row label="Quantity" value={String(request.quantity)} />
        <Row label="Estimated cost" value={request.estimated_cost != null ? `$${request.estimated_cost.toLocaleString()}` : "—"} />
        <Row label="Vendor" value={request.vendor || "—"} />
        <Row label="Required by" value={request.required_date || "—"} />
        <Row label="Project association" value={request.project_association || "—"} />
        <Row label="Submitted" value={formatDateTime(request.submitted_at, "Not yet submitted")} />
        {request.decided_by_name && <Row label="Decided by" value={`${request.decided_by_name} on ${formatDay(request.decided_at)}`} />}
      </div>

      {request.item_description && (
        <div>
          <div className="data-label mb-1.5">DESCRIPTION</div>
          <p className="text-sm text-graphite-300 whitespace-pre-line">{request.item_description}</p>
        </div>
      )}
      {request.justification && (
        <div>
          <div className="data-label mb-1.5">JUSTIFICATION</div>
          <p className="text-sm text-graphite-300 whitespace-pre-line">{request.justification}</p>
        </div>
      )}
      {request.product_link && (
        <a href={request.product_link} target="_blank" rel="noreferrer" className="text-signal text-sm hover:text-signal-bright">
          Product link →
        </a>
      )}

      <div className="panel p-5">
        <div className="data-label mb-3">TICKET ACTIONS</div>
        <PurchaseRequestActions request={request} isOwner={isOwner} isApprover={isApprover} />
      </div>

      {/*
        Discussion, not "HISTORY".
        A comment and a status change used to render identically in one flat
        list at the bottom of the page, so somebody asking a question looked
        exactly like the system noting a transition — which is how a comment
        got lost. Comments now carry the accent edge and their text at full
        size; status changes shrink to a single timeline line, because the fact
        that something moved SUBMITTED → UNDER_REVIEW is reference material,
        not conversation.
      */}
      <div>
        <div className="flex items-baseline justify-between mb-3">
          <div className="data-label">DISCUSSION &amp; HISTORY</div>
          <span className="font-mono text-[11px] text-graphite-500">
            {commentCount === 0
              ? "no comments yet"
              : `${commentCount} comment${commentCount === 1 ? "" : "s"}`}
            {infoRequests > 0 && ` · ${infoRequests} information request${infoRequests === 1 ? "" : "s"}`}
          </span>
        </div>
        <div className="space-y-2">
          {events.map((e: any) => {
            const isTalk = e.event_type === "COMMENT" || e.event_type === "INFO_REQUESTED";
            const asked = e.event_type === "INFO_REQUESTED";

            if (!isTalk) {
              return (
                <div key={e.id} className="flex items-baseline gap-3 px-3 py-1.5 text-xs text-graphite-500">
                  <span className="font-mono text-[10px] text-graphite-600 shrink-0">
                    {formatDateTime(e.created_at)}
                  </span>
                  <span>
                    {e.user_name || "System"} moved {e.from_status || "—"} → {e.to_status}
                  </span>
                  {e.comment && <span className="text-graphite-400 truncate">— {e.comment}</span>}
                </div>
              );
            }

            return (
              <div
                key={e.id}
                className={`panel p-4 border-l-2 ${asked ? "border-l-telemetry-amber" : "border-l-signal"}`}
              >
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <span className="text-sm text-graphite-100">
                    {e.user_name}
                    {asked && (
                      <span className="ml-2 font-mono text-[10px] text-telemetry-amber">
                        ASKED FOR MORE INFORMATION
                      </span>
                    )}
                  </span>
                  <span className="font-mono text-[11px] text-graphite-500">
                    {formatDateTime(e.created_at)}
                  </span>
                </div>
                {e.comment && <p className="text-sm text-graphite-300 mt-2 leading-relaxed">{e.comment}</p>}
              </div>
            );
          })}
          {events.length === 0 && (
            <p className="text-xs text-graphite-500">Nothing yet. Comments and decisions both land here.</p>
          )}
        </div>
      </div>
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

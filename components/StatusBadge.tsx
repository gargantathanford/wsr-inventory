import { statusLabel } from "@/lib/scoring";

const STATUS_STYLES: Record<string, string> = {
  OWNED: "border-telemetry-green/50 text-telemetry-green bg-telemetry-green/10",
  AVAILABLE_FOR_INSTALLATION: "border-telemetry-green/50 text-telemetry-green bg-telemetry-green/10",
  INSTALLED: "border-telemetry-green/50 text-telemetry-green bg-telemetry-green/10",
  PARTIALLY_OWNED: "border-telemetry-amber/50 text-telemetry-amber bg-telemetry-amber/10",
  NEEDED: "border-graphite-500 text-graphite-300 bg-graphite-800",
  ORDERED: "border-telemetry-blue/50 text-telemetry-blue bg-telemetry-blue/10",
  BACKORDERED: "border-telemetry-red/50 text-telemetry-red bg-telemetry-red/10",
  MANUFACTURING: "border-signal/50 text-signal bg-signal/10",
  UNAVAILABLE: "border-telemetry-red/50 text-telemetry-red bg-telemetry-red/10",
  NO_LONGER_NEEDED: "border-graphite-600 text-graphite-500 bg-graphite-850 line-through",
  AVAILABLE: "border-telemetry-green/50 text-telemetry-green bg-telemetry-green/10",
  CHECKED_OUT: "border-telemetry-amber/50 text-telemetry-amber bg-telemetry-amber/10",
  MISSING: "border-telemetry-red/50 text-telemetry-red bg-telemetry-red/10",
  DAMAGED: "border-telemetry-red/50 text-telemetry-red bg-telemetry-red/10",
  NEEDS_CALIBRATION: "border-telemetry-amber/50 text-telemetry-amber bg-telemetry-amber/10",
  // Shopping List purchase workflow
  RESEARCHING: "border-telemetry-blue/50 text-telemetry-blue bg-telemetry-blue/10",
  AWAITING_APPROVAL: "border-telemetry-amber/50 text-telemetry-amber bg-telemetry-amber/10",
  APPROVED: "border-telemetry-green/50 text-telemetry-green bg-telemetry-green/10",
  RECEIVED: "border-telemetry-green/50 text-telemetry-green bg-telemetry-green/10",
  // Approval workflow
  PENDING: "border-telemetry-amber/50 text-telemetry-amber bg-telemetry-amber/10",
  REJECTED: "border-telemetry-red/50 text-telemetry-red bg-telemetry-red/10",
  DRAFT: "border-graphite-500 text-graphite-300 bg-graphite-800",
  PENDING_APPROVAL: "border-telemetry-amber/50 text-telemetry-amber bg-telemetry-amber/10",
  // Task workflow
  OPEN: "border-graphite-500 text-graphite-300 bg-graphite-800",
  IN_PROGRESS: "border-telemetry-blue/50 text-telemetry-blue bg-telemetry-blue/10",
  SUBMITTED_FOR_REVIEW: "border-telemetry-amber/50 text-telemetry-amber bg-telemetry-amber/10",
  COMPLETED: "border-telemetry-green/50 text-telemetry-green bg-telemetry-green/10"
};

const IMPORTANCE_STYLES: Record<string, string> = {
  CRITICAL: "border-telemetry-red/50 text-telemetry-red bg-telemetry-red/10",
  HIGH: "border-signal/50 text-signal bg-signal/10",
  MEDIUM: "border-telemetry-amber/50 text-telemetry-amber bg-telemetry-amber/10",
  LOW: "border-graphite-500 text-graphite-400 bg-graphite-800"
};

export function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_STYLES[status] ?? "border-graphite-600 text-graphite-300 bg-graphite-800";
  return <span className={`pill ${cls}`}>{statusLabel(status)}</span>;
}

export function ImportanceBadge({ importance }: { importance: string }) {
  const cls = IMPORTANCE_STYLES[importance] ?? "border-graphite-600 text-graphite-300 bg-graphite-800";
  return <span className={`pill ${cls}`}>{importance}</span>;
}

export type Importance = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export const IMPORTANCE_WEIGHT: Record<Importance, number> = {
  CRITICAL: 10,
  HIGH: 7,
  MEDIUM: 4,
  LOW: 2
};

const NEEDED_STATUSES = new Set(["NEEDED", "BACKORDERED", "ORDERED"]);
const OWNED_STATUSES = new Set(["OWNED", "AVAILABLE_FOR_INSTALLATION", "INSTALLED"]);

export interface PartForScoring {
  status: string;
  importance: Importance;
  priority_score: number;
  lead_time_days: number | null;
  quantity_required: number;
  quantity_owned: number;
  dependents_count?: number;
}

/**
 * PROCUREMENT PRIORITY = Importance x Lead Time Factor x Dependency Factor
 *
 * Returns the RAW score. Owned/installed parts score 0 (nothing to procure).
 *
 * This used to divide by the theoretical maximum (10 x 5 x 2.25 = 112.5) and
 * present the result as a percentage. That maximum requires a CRITICAL part,
 * priority 10, a 12-week lead time and five dependents all at once. Measured
 * against the real parts workbook, the whole 157-part list landed between 5 and
 * 13 out of 100 and read as "nothing here is urgent". A score that can never
 * approach its own ceiling should not be shown as a percentage of it, so the
 * raw value is returned and ranking happens across the actual set.
 */
export function procurementPriority(part: PartForScoring): number {
  if (OWNED_STATUSES.has(part.status) || part.status === "NO_LONGER_NEEDED") return 0;
  if (part.quantity_owned >= part.quantity_required) return 0;

  const importanceWeight = IMPORTANCE_WEIGHT[part.importance] ?? 4;
  const manualWeight = Math.min(Math.max(part.priority_score, 1), 10);
  const baseImportance = (importanceWeight + manualWeight) / 2; // 1-10

  const leadDays = part.lead_time_days ?? 14;
  const leadTimeFactor = 1 + Math.min(leadDays / 14, 4); // 1x (no lead time) to 5x (12+ weeks)

  const dependencyFactor = 1 + Math.min(part.dependents_count ?? 0, 5) * 0.25; // up to 2.25x

  return Math.round(baseImportance * leadTimeFactor * dependencyFactor * 10) / 10;
}

/**
 * Rescale a set of raw priority scores across the set that actually exists, so
 * the highest-priority part in the list reads as 100 and the rest sit where
 * they fall relative to it. Pass every part currently in view; the band is
 * meaningful relative to that view, which is what a lead is deciding within.
 *
 * Parts that score 0 (already owned, or no longer needed) stay at 0.
 */
export function normalizePriorities<T extends { priorityScore: number }>(parts: T[]): Array<T & { priorityRank: number }> {
  const max = parts.reduce((m, p) => Math.max(m, p.priorityScore), 0);
  return parts.map((p) => ({
    ...p,
    priorityRank: max > 0 && p.priorityScore > 0 ? Math.round((p.priorityScore / max) * 100) : 0
  }));
}

/**
 * Label for a raw procurement priority, independent of the rest of the set.
 * Thresholds are on the raw scale: base importance 1-10 x lead 1-5x x deps 1-2.25x.
 */
export function priorityBand(raw: number): "URGENT" | "HIGH" | "NORMAL" | "LOW" | "NONE" {
  if (raw <= 0) return "NONE";
  if (raw >= 40) return "URGENT";
  if (raw >= 20) return "HIGH";
  if (raw >= 9) return "NORMAL";
  return "LOW";
}

export function isNeeded(status: string): boolean {
  return NEEDED_STATUSES.has(status);
}

export function isOwned(status: string): boolean {
  return OWNED_STATUSES.has(status);
}

export function ownershipPercent(quantityOwned: number, quantityRequired: number): number {
  if (quantityRequired <= 0) return 100;
  return Math.min(Math.round((quantityOwned / quantityRequired) * 100), 100);
}

export function statusLabel(status: string): string {
  return status
    .split("_")
    .map((w) => w[0] + w.slice(1).toLowerCase())
    .join(" ");
}

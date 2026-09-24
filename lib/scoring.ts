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
 * Normalized to a 0-100 scale. Owned/installed parts score 0 (nothing to procure).
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

  const raw = baseImportance * leadTimeFactor * dependencyFactor; // max ~ 10*5*2.25=112.5
  const score = Math.round(Math.min((raw / 112.5) * 100, 100));
  return score;
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

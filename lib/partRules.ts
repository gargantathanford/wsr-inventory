/**
 * Rules governing what a part record must contain before it may claim a given
 * level of design maturity. Shared by the API route and the form so the two
 * cannot drift — the browser gets the same answer the server will give, and the
 * server never trusts the browser's.
 *
 * These mirror the parts workbook's own gate, from its README:
 *
 *   "A line cannot move to Selected unless M = OK, rule is cited (col S), and
 *    acceptance criterion (col U) is written."
 *
 * The dashboard enforces the two it can check on a single record — a cited rule
 * and a written acceptance criterion. The mass check needs an allocation and a
 * measured weight, so it is reported as a warning rather than a hard gate: a
 * lead is allowed to select a part whose mass is over allocation as long as
 * they can see that it is.
 */

export const DESIGN_STATUSES = ["PLACEHOLDER", "CANDIDATE", "QUOTED", "SELECTED", "FROZEN"] as const;
export type DesignStatus = (typeof DESIGN_STATUSES)[number];

export const SPONSOR_ASKS = ["CASH", "IN_KIND", "DISCOUNT", "BUY"] as const;
export const UNITS = ["ea", "lot", "ft", "sheet", "part", "hr"] as const;

/** Maturity levels that assert the design decision is made. */
const COMMITTED: readonly DesignStatus[] = ["SELECTED", "FROZEN"];

export interface PartGateInput {
  design_status?: string | null;
  acceptance_criterion?: string | null;
  /** Count of clauses cited from the ruleset. Free text does not count. */
  cited_rule_count?: number;
  /** Legacy free-text rule from the spreadsheet, accepted as a fallback. */
  governing_rule?: string | null;
  allocated_mass_kg?: number | null;
  weight_kg?: number | null;
  quantity_required?: number | null;
}

export interface GateResult {
  /** Blocking problems. The record may not be saved at this maturity. */
  errors: string[];
  /** Non-blocking. Shown, saved anyway. */
  warnings: string[];
}

export function checkPartGates(input: PartGateInput): GateResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const status = (input.design_status ?? "PLACEHOLDER") as DesignStatus;
  const committed = COMMITTED.includes(status);

  if (committed) {
    const criterion = (input.acceptance_criterion ?? "").trim();
    if (criterion.length < 10) {
      errors.push(
        `A ${status.toLowerCase()} part needs a written acceptance criterion — how will you know this part is ` +
          `correct? (At least a sentence.)`
      );
    }

    const hasCitation = (input.cited_rule_count ?? 0) > 0;
    const hasLegacyRule = (input.governing_rule ?? "").trim().length > 0;
    if (!hasCitation && !hasLegacyRule) {
      errors.push(
        `A ${status.toLowerCase()} part needs its governing FSAE rule cited, or an explicit note that no rule ` +
          `applies. Tech inspection checks against the rules, not against the design.`
      );
    }
  }

  // Mass is advisory: being over allocation is a real engineering fact a lead
  // may knowingly accept, not a data error.
  const alloc = input.allocated_mass_kg;
  const actual = input.weight_kg;
  if (alloc != null && actual != null && actual > alloc) {
    const over = (((actual - alloc) / alloc) * 100).toFixed(0);
    warnings.push(`Measured mass is ${over}% over its allocation (${actual} kg vs ${alloc} kg allocated).`);
  }
  if (committed && alloc == null) {
    warnings.push(`No mass allocation set, so this part is not counted against the subsystem's mass budget.`);
  }

  return { errors, warnings };
}

/** True when the record may be saved at the requested maturity. */
export function passesPartGates(input: PartGateInput): boolean {
  return checkPartGates(input).errors.length === 0;
}

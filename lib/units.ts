/**
 * Mass units.
 *
 * WHY THIS EXISTS. Every mass column is named `_kg` and the forms accepted a
 * bare number, so a supplier quoting tubing in pounds got entered as if it were
 * kilograms — a 2.2x error, silently, on the one number the whole mass budget
 * depends on. Jonathan hit exactly that entering the chassis tubing.
 *
 * THE RULE: kilograms are the only thing ever stored. A unit is a property of
 * how somebody typed a number, not of the number itself, and a database with
 * mixed units in one column is a database whose sums are meaningless. The
 * chosen unit is remembered per part purely so the value is displayed back the
 * way it was entered — the supplier said 4.4 lb, so the part should say 4.4 lb,
 * even though 1.995806 kg is what is stored and summed.
 *
 * Conversion factors are exact by definition (the international pound is
 * defined as exactly 0.45359237 kg), so there is no accumulating error.
 */

export const MASS_UNITS = ["kg", "g", "lb", "oz"] as const;
export type MassUnit = (typeof MASS_UNITS)[number];

export const MASS_UNIT_LABEL: Record<MassUnit, string> = {
  kg: "kilograms",
  g: "grams",
  lb: "pounds",
  oz: "ounces"
};

/** Kilograms per one of each unit. Exact definitions, not approximations. */
const TO_KG: Record<MassUnit, number> = {
  kg: 1,
  g: 0.001,
  lb: 0.45359237,
  oz: 0.45359237 / 16
};

export function isMassUnit(u: string | null | undefined): u is MassUnit {
  return !!u && (MASS_UNITS as readonly string[]).includes(u);
}

/** A value the user typed, in their unit, to canonical kilograms. */
export function toKg(value: number, unit: MassUnit): number {
  return value * TO_KG[unit];
}

/** Canonical kilograms back to the unit it should be displayed in. */
export function fromKg(kg: number, unit: MassUnit): number {
  return kg / TO_KG[unit];
}

/**
 * How many decimal places to show, by unit.
 *
 * Grams and ounces are small enough that decimals are noise; kilograms and
 * pounds on an FSAE part are routinely under one, so they need three. Showing
 * "0 kg" for a 4-gram fastener is how a mass budget quietly loses track of a
 * few hundred grams of hardware.
 */
const PLACES: Record<MassUnit, number> = { kg: 3, g: 0, lb: 3, oz: 1 };

/** Formatted for display, with the unit. */
export function formatMass(kg: number | null | undefined, unit: MassUnit = "kg"): string {
  if (kg === null || kg === undefined || !Number.isFinite(kg)) return "—";
  const v = fromKg(kg, unit);
  return `${v.toFixed(PLACES[unit])} ${unit}`;
}

/**
 * Parse a form field that may carry its own unit, e.g. "4.4 lb" or "250g".
 *
 * Accepting a unit in the text as well as from the dropdown is deliberate:
 * people paste "0.85 kg" straight out of a datasheet, and rejecting that for
 * having a unit in it would be pedantry. Returns null when there is no number
 * at all, which is different from zero.
 */
export function parseMass(input: string | number | null | undefined, fallbackUnit: MassUnit = "kg"): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") {
    return Number.isFinite(input) ? toKg(input, fallbackUnit) : null;
  }
  const text = input.trim();
  if (text === "") return null;

  const m = /^([-+]?\d*\.?\d+)\s*(kg|kilograms?|g|grams?|lb|lbs|pounds?|oz|ounces?)?$/i.exec(text);
  if (!m) return null;

  const value = Number(m[1]);
  if (!Number.isFinite(value)) return null;

  const written = m[2]?.toLowerCase();
  const unit: MassUnit = written
    ? written.startsWith("kg") || written.startsWith("kilo")
      ? "kg"
      : written.startsWith("lb") || written.startsWith("pound")
        ? "lb"
        : written.startsWith("oz") || written.startsWith("ounce")
          ? "oz"
          : "g"
    : fallbackUnit;

  return toKg(value, unit);
}

/**
 * Is this part small enough that a missing mass is reasonable?
 *
 * Used only to word the warning on the freeze gate, never to skip the check —
 * a lead marks a part as mass-not-applicable deliberately, and the dashboard
 * does not get to decide on their behalf that a bracket is "basically a
 * fastener". Guessing here is how a few hundred grams of hardware disappears.
 */
const SMALL_PART = /\b(bolt|nut|washer|screw|rivet|clip|zip ?tie|fastener|o-?ring|shim|cotter|circlip|grommet|terminal|lug|heat ?shrink|cable ?tie)\b/i;

export function looksLikeSmallPart(name: string, category?: string | null): boolean {
  return SMALL_PART.test(`${name} ${category ?? ""}`);
}

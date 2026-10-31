/**
 * Part-level gates, and specifically: a frozen part must have a mass.
 *
 * This file used not to exist — the rules were only covered through the
 * subsystem gate, which meant a part could be frozen with no mass and the
 * subsystem gate then refused to close for a reason invisible from the part.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { checkPartGates, passesPartGates } from "./partRules";

describe("mass is required to freeze a part", () => {
  const base = {
    acceptance_criterion: "Passes a 2g bump load case with no yield",
    cited_rule_count: 1
  };

  test("frozen with no mass at all is an ERROR", () => {
    const r = checkPartGates({ ...base, design_status: "FROZEN" });
    assert.ok(r.errors.some((e) => /needs a mass/.test(e)));
  });

  test("the error names the way out", () => {
    const r = checkPartGates({ ...base, design_status: "FROZEN" });
    const e = r.errors.find((x) => /needs a mass/.test(x))!;
    assert.match(e, /mass not applicable/);
  });

  test("an allocation is enough", () => {
    const r = checkPartGates({ ...base, design_status: "FROZEN", allocated_mass_kg: 1.2 });
    assert.equal(r.errors.length, 0);
  });

  test("a measured mass is enough", () => {
    const r = checkPartGates({ ...base, design_status: "FROZEN", weight_kg: 1.2 });
    assert.equal(r.errors.length, 0);
  });

  test("an excused part is enough", () => {
    const r = checkPartGates({ ...base, design_status: "FROZEN", mass_not_applicable: true });
    assert.equal(r.errors.length, 0);
  });

  test("zero is a mass, not an absence", () => {
    const r = checkPartGates({ ...base, design_status: "FROZEN", weight_kg: 0 });
    assert.equal(r.errors.length, 0);
  });

  test("SELECTED only warns — choosing before weighing is normal", () => {
    const r = checkPartGates({ ...base, design_status: "SELECTED" });
    assert.equal(r.errors.filter((e) => /needs a mass/.test(e)).length, 0);
    assert.ok(r.warnings.some((w) => /required before you can freeze/.test(w)));
  });

  test("a placeholder is not nagged about mass at all", () => {
    const r = checkPartGates({ design_status: "PLACEHOLDER" });
    assert.equal(r.errors.length, 0);
    assert.equal(r.warnings.filter((w) => /mass/i.test(w)).length, 0);
  });

  test("over-allocation still only warns", () => {
    const r = checkPartGates({ ...base, design_status: "FROZEN", allocated_mass_kg: 1, weight_kg: 1.5 });
    assert.equal(r.errors.length, 0);
    assert.ok(r.warnings.some((w) => /50% over its allocation/.test(w)));
  });

  test("an excused part is not warned about being over", () => {
    const r = checkPartGates({
      ...base, design_status: "FROZEN", mass_not_applicable: true,
      allocated_mass_kg: 1, weight_kg: 5
    });
    assert.equal(r.warnings.filter((w) => /over its allocation/.test(w)).length, 0);
  });
});

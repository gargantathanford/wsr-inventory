import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { toKg, fromKg, parseMass, formatMass, isMassUnit, looksLikeSmallPart, MASS_UNITS } from "./units";

describe("conversion is exact, not approximate", () => {
  test("one pound is exactly 0.45359237 kg", () => {
    assert.equal(toKg(1, "lb"), 0.45359237);
  });

  test("the chassis tubing case: a supplier quoting lb", () => {
    // The failure this exists to stop: 4.4 entered against a column named _kg
    // when the supplier meant pounds. Nearly 2.4 kg of error on one part.
    assert.equal(toKg(4.4, "kg"), 4.4);
    assert.ok(Math.abs(toKg(4.4, "lb") - 1.9958) < 0.001);
  });

  test("round-trips through every unit without drift", () => {
    for (const u of MASS_UNITS) {
      for (const v of [0.001, 0.5, 1, 12.75, 500]) {
        assert.ok(Math.abs(fromKg(toKg(v, u), u) - v) < 1e-9, `${v} ${u} did not round-trip`);
      }
    }
  });

  test("grams and ounces", () => {
    assert.equal(toKg(1000, "g"), 1);
    assert.ok(Math.abs(toKg(16, "oz") - 0.45359237) < 1e-12);
  });
});

describe("parsing what people actually type", () => {
  test("a bare number uses the dropdown's unit", () => {
    assert.equal(parseMass("4.4", "lb"), toKg(4.4, "lb"));
    assert.equal(parseMass("4.4", "kg"), 4.4);
  });

  test("a unit written in the field wins over the dropdown", () => {
    // Pasting "0.85 kg" out of a datasheet must not be silently read as lb.
    assert.equal(parseMass("0.85 kg", "lb"), 0.85);
    assert.equal(parseMass("4.4 lb", "kg"), toKg(4.4, "lb"));
  });

  test("spacing and spelling variants", () => {
    assert.equal(parseMass("250g"), 0.25);
    assert.equal(parseMass("250 grams"), 0.25);
    assert.equal(parseMass("2 lbs", "kg"), toKg(2, "lb"));
    assert.equal(parseMass("1 POUND", "kg"), toKg(1, "lb"));
  });

  test("empty is null, which is NOT zero", () => {
    // "no mass recorded" and "weighs nothing" are different facts, and the
    // freeze gate turns on exactly that distinction.
    assert.equal(parseMass(""), null);
    assert.equal(parseMass("   "), null);
    assert.equal(parseMass(null), null);
    assert.equal(parseMass(undefined), null);
    assert.equal(parseMass("0"), 0, "an explicit zero IS a recorded mass");
  });

  test("junk is refused rather than guessed at", () => {
    assert.equal(parseMass("heavy"), null);
    assert.equal(parseMass("4.4 stone"), null);
    assert.equal(parseMass("1,200"), null, "a thousands separator is ambiguous, so refuse it");
  });
});

describe("display", () => {
  test("shows the unit it was entered in", () => {
    const kg = toKg(4.4, "lb");
    assert.equal(formatMass(kg, "lb"), "4.400 lb");
    assert.match(formatMass(kg, "kg"), /^1\.996 kg$/);
  });

  test("small parts keep their precision in kg, lose it in grams", () => {
    assert.equal(formatMass(0.004, "kg"), "0.004 kg");
    assert.equal(formatMass(0.004, "g"), "4 g");
  });

  test("a missing mass is a dash, not a zero", () => {
    assert.equal(formatMass(null), "—");
    assert.equal(formatMass(undefined), "—");
    assert.equal(formatMass(0), "0.000 kg", "zero is a real value and shows as one");
  });
});

describe("unit validation", () => {
  test("accepts the four, rejects everything else", () => {
    for (const u of MASS_UNITS) assert.equal(isMassUnit(u), true);
    for (const u of ["", "stone", "KG", null, undefined]) assert.equal(isMassUnit(u as any), false);
  });
});

describe("small-part detection is advisory only", () => {
  test("recognises hardware", () => {
    assert.equal(looksLikeSmallPart("M8 bolt"), true);
    assert.equal(looksLikeSmallPart("zip tie", "consumable"), true);
    assert.equal(looksLikeSmallPart("O-ring"), true);
  });

  test("does not claim a real component is a fastener", () => {
    assert.equal(looksLikeSmallPart("Upright"), false);
    assert.equal(looksLikeSmallPart("Chassis tubing, 1018 DOM"), false);
    assert.equal(looksLikeSmallPart("Brake master cylinder"), false);
  });
});

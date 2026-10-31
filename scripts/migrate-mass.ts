/**
 * Mass migration — units, the not-applicable marker, and subsystem budgets.
 *
 * Usage (from the project root):
 *   npx tsx scripts/migrate-mass.ts            # report what would change
 *   npx tsx scripts/migrate-mass.ts --commit   # apply
 *
 * In Docker:
 *   docker compose run --rm maint npx tsx scripts/migrate-mass.ts --commit
 *
 * Additive, and safe to run twice.
 *
 * THE BUDGET SPLIT is seeded from target_vehicle_mass_lb with the shares the
 * workbook's Vehicle Targets tab uses. It is a STARTING POINT, not an
 * assertion: the first split of a mass budget is always a guess, and the whole
 * point of putting it in the dashboard is that leads argue with it. Every value
 * is editable afterwards, and re-running this never overwrites an edited one.
 */
import path from "path";
import fs from "fs";
import Database from "better-sqlite3";

const DB_PATH = process.env.WSR_DB_PATH || path.join(process.cwd(), "data", "wsr.db");
const commit = process.argv.includes("--commit");

if (!fs.existsSync(DB_PATH)) {
  console.error(`No database at ${DB_PATH}.`);
  process.exit(1);
}

const db = new Database(DB_PATH);
db.pragma("foreign_keys = ON");

const hasColumn = (t: string, c: string) =>
  (db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).some((x) => x.name === c);

const STEPS = [
  {
    label: "parts.mass_unit",
    done: hasColumn("parts", "mass_unit"),
    sql: [`ALTER TABLE parts ADD COLUMN mass_unit TEXT NOT NULL DEFAULT 'kg'`]
  },
  {
    label: "parts.mass_not_applicable",
    done: hasColumn("parts", "mass_not_applicable"),
    sql: [`ALTER TABLE parts ADD COLUMN mass_not_applicable INTEGER NOT NULL DEFAULT 0`]
  },
  {
    label: "subsystems.mass_budget_kg",
    done: hasColumn("subsystems", "mass_budget_kg"),
    sql: [`ALTER TABLE subsystems ADD COLUMN mass_budget_kg REAL`]
  }
];

/**
 * Shares from the workbook's Vehicle Targets tab. They sum to 1.00; anything
 * not listed gets nothing and a lead sets it by hand, which is more honest
 * than inventing a number for a subsystem nobody has scoped.
 */
const SHARES: Record<string, number> = {
  CHS: 0.18, SUS: 0.14, WHE: 0.13, PWT: 0.20, CVT: 0.07,
  BRK: 0.06, ELE: 0.08, ERG: 0.05, AER: 0.06, STE: 0.03
};

const pending = STEPS.filter((s) => !s.done);

console.log(`database : ${DB_PATH}`);
console.log(`mode     : ${commit ? "COMMIT" : "DRY RUN (nothing written)"}`);
console.log(`steps    : ${STEPS.length} total, ${STEPS.length - pending.length} already applied, ${pending.length} pending`);
for (const s of pending) console.log(`  + ${s.label}`);

const targetRow = db
  .prepare(`SELECT value_numeric, unit FROM vehicle_targets WHERE target_key = 'target_vehicle_mass_lb'`)
  .get() as { value_numeric: number; unit: string } | undefined;

const LB_TO_KG = 0.45359237;
const targetKg = targetRow?.value_numeric ? targetRow.value_numeric * LB_TO_KG : null;

if (targetKg) {
  console.log(`\nvehicle mass target : ${targetRow!.value_numeric} lb (${targetKg.toFixed(1)} kg)`);
  console.log("proposed split (editable afterwards, and never overwritten on a re-run):\n");
  for (const [code, share] of Object.entries(SHARES)) {
    console.log(`  ${code.padEnd(5)} ${(share * 100).toFixed(0).padStart(3)}%   ${(targetKg * share).toFixed(1).padStart(6)} kg`);
  }
} else {
  console.log("\nNo target_vehicle_mass_lb in vehicle_targets — budgets will be left empty for leads to set.");
}

if (!commit) {
  console.log("\nDry run complete. Re-run with --commit to apply.");
  process.exit(0);
}

const run = db.transaction(() => {
  for (const s of pending) for (const sql of s.sql) db.exec(sql);

  if (targetKg) {
    // Only where a budget has not been set. A lead's edit is never clobbered
    // by re-running the migration.
    const upd = db.prepare(
      `UPDATE subsystems SET mass_budget_kg = ? WHERE code = ? AND mass_budget_kg IS NULL`
    );
    let n = 0;
    for (const [code, share] of Object.entries(SHARES)) {
      n += upd.run(Number((targetKg * share).toFixed(2)), code).changes;
    }
    console.log(`\nbudgets seeded : ${n}`);
  }
});
run();

console.log(`steps applied : ${pending.length}`);
console.log("\nDone. Masses are stored in kilograms; mass_unit only controls display.");
db.close();

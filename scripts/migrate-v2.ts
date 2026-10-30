/**
 * v2 migration — parts-workbook ingest fields.
 *
 * Brings an EXISTING database up to the v2 schema.sql. Additive only: it adds
 * columns, tables and indexes. It never drops or rewrites a column, and it
 * never touches a row's data. Safe to run on a database with live accounts in
 * it, and safe to run twice — every step checks whether it has already been
 * applied.
 *
 * Usage (from the project root):
 *   npx tsx scripts/migrate-v2.ts            # report what would change
 *   npx tsx scripts/migrate-v2.ts --commit   # apply
 *
 * Back up first. The dashboard ships a backup script:
 *   npm run backup
 *
 * ONE KNOWN ASYMMETRY, stated plainly: SQLite cannot add a CHECK constraint to
 * an existing table with ALTER TABLE. A database created fresh from schema.sql
 * enforces the allowed values for design_status and sponsor_ask in the database
 * itself; a database brought here by this migration does not. Both enforce them
 * in the application layer (zod on every API route), which is where enforcement
 * has to live anyway since the import path and the forms both go through it.
 * The alternative — rebuilding the parts table — would mean dropping and
 * recreating every foreign key that points at it, which is a far worse risk
 * than the asymmetry. Fresh deployments get the constraints; this one gets the
 * columns.
 */
import path from "path";
import fs from "fs";
import Database from "better-sqlite3";
import { nanoid } from "nanoid";

const DB_PATH = process.env.WSR_DB_PATH || path.join(process.cwd(), "data", "wsr.db");

type Step = { label: string; applied: (db: Database.Database) => boolean; apply: string[] };

const columnExists = (db: Database.Database, table: string, column: string): boolean => {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
};

const tableExists = (db: Database.Database, table: string): boolean =>
  !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).get(table);

const addColumn = (table: string, column: string, decl: string): Step => ({
  label: `${table}.${column}`,
  applied: (db) => columnExists(db, table, column),
  apply: [`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`]
});

const STEPS: Step[] = [
  // ---- subsystems: workbook tab code + allocation shares
  addColumn("subsystems", "code", "TEXT"),
  addColumn("subsystems", "mass_share", "REAL"),
  addColumn("subsystems", "budget_share", "REAL"),

  // ---- parts: the workbook fields that currently survive only as prose
  addColumn("parts", "sheet_ref", "TEXT"),
  addColumn("parts", "design_status", "TEXT NOT NULL DEFAULT 'PLACEHOLDER'"),
  addColumn("parts", "estimated_cost_low", "REAL"),
  addColumn("parts", "estimated_cost_high", "REAL"),
  addColumn("parts", "governing_rule", "TEXT"),
  addColumn("parts", "driving_target", "TEXT"),
  addColumn("parts", "acceptance_criterion", "TEXT"),
  addColumn("parts", "sponsor_ask", "TEXT"),
  addColumn("parts", "unit_of_measure", "TEXT"),
  addColumn("parts", "allocated_mass_kg", "REAL"),

  {
    label: "index: unique parts.sheet_ref",
    applied: (db) =>
      !!db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_parts_sheet_ref'`).get(),
    apply: [
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_parts_sheet_ref ON parts(sheet_ref) WHERE sheet_ref IS NOT NULL`
    ]
  },
  {
    label: "index: unique subsystems.code",
    applied: (db) =>
      !!db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_subsystems_code'`).get(),
    apply: [
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_subsystems_code ON subsystems(code) WHERE code IS NOT NULL`
    ]
  },
  {
    label: "index: parts.design_status",
    applied: (db) =>
      !!db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_parts_design_status'`).get(),
    apply: [`CREATE INDEX IF NOT EXISTS idx_parts_design_status ON parts(design_status)`]
  },

  // ---- new tables
  {
    // The ruleset tables shipped in schema.sql but had no migration, so an
    // EXISTING database never got them and scripts/import-ruleset.ts failed
    // with "no such table: rules". Added here rather than in a new script
    // because these arrived with the rest of the v2 work; migrate-v2 checks
    // each step independently, so a database that already ran it picks up
    // only these on a re-run.
    label: "tables: rulesets, rules, rule_citations",
    applied: (db) => tableExists(db, "rules"),
    apply: [
      `CREATE TABLE IF NOT EXISTS rulesets (
        id TEXT PRIMARY KEY,
        label TEXT UNIQUE NOT NULL,
        year INTEGER NOT NULL,
        version TEXT,
        source_filename TEXT,
        clause_count INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 0,
        imported_by TEXT REFERENCES users(id),
        imported_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS rules (
        id TEXT PRIMARY KEY,
        ruleset_id TEXT NOT NULL REFERENCES rulesets(id) ON DELETE CASCADE,
        clause_id TEXT NOT NULL,
        section TEXT NOT NULL,
        parent_clause_id TEXT,
        depth INTEGER NOT NULL,
        heading TEXT NOT NULL,
        body TEXT,
        UNIQUE(ruleset_id, clause_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_rules_ruleset ON rules(ruleset_id, section)`,
      `CREATE INDEX IF NOT EXISTS idx_rules_clause ON rules(clause_id)`,
      `CREATE TABLE IF NOT EXISTS rule_citations (
        id TEXT PRIMARY KEY,
        rule_id TEXT NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
        entity_type TEXT NOT NULL CHECK (entity_type IN ('PART','PROCEDURE','TASK','INTERFACE')),
        entity_id TEXT NOT NULL,
        note TEXT,
        cited_by TEXT REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(rule_id, entity_type, entity_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_rule_citations_entity ON rule_citations(entity_type, entity_id)`
    ]
  },
  {
    label: "table: vehicle_targets",
    applied: (db) => tableExists(db, "vehicle_targets"),
    apply: [
      `CREATE TABLE IF NOT EXISTS vehicle_targets (
        id TEXT PRIMARY KEY,
        target_key TEXT UNIQUE NOT NULL,
        label TEXT NOT NULL,
        value_numeric REAL,
        value_text TEXT,
        unit TEXT,
        source TEXT,
        is_placeholder INTEGER NOT NULL DEFAULT 1,
        updated_by TEXT REFERENCES users(id),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    ]
  },
  {
    label: "table: interfaces",
    applied: (db) => tableExists(db, "interfaces"),
    apply: [
      `CREATE TABLE IF NOT EXISTS interfaces (
        id TEXT PRIMARY KEY,
        interface_ref TEXT UNIQUE NOT NULL,
        priority TEXT NOT NULL DEFAULT 'P2' CHECK (priority IN ('P1','P2','P3')),
        subsystem_a_id TEXT REFERENCES subsystems(id),
        subsystem_b_id TEXT REFERENCES subsystems(id),
        part_a_id TEXT REFERENCES parts(id) ON DELETE SET NULL,
        part_b_id TEXT REFERENCES parts(id) ON DELETE SET NULL,
        part_a_ref TEXT,
        part_b_ref TEXT,
        description TEXT,
        driver TEXT,
        owner_user_id TEXT REFERENCES users(id),
        owner_name TEXT,
        due_date TEXT,
        status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_WORK','AGREED','CLOSED')),
        notes TEXT,
        links TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_interfaces_priority ON interfaces(priority, status)`,
      `CREATE INDEX IF NOT EXISTS idx_interfaces_part_a ON interfaces(part_a_id)`,
      `CREATE INDEX IF NOT EXISTS idx_interfaces_part_b ON interfaces(part_b_id)`
    ]
  }
];

/**
 * Subsystem name -> workbook tab code. Backfilled onto existing rows so the
 * import can join on code. Names not listed here keep code NULL, which simply
 * means no workbook tab feeds them.
 */
const CODE_BY_NAME: Record<string, string> = {
  "aerodynamics": "AER",
  "aero / bodywork": "AER",
  "brakes": "BRK",
  "chassis": "CHS",
  "chassis / frame": "CHS",
  "drivetrain": "CVT",
  "electrical": "ELE",
  "ergonomics": "ERG",
  "manufacturing": "MFG",
  "powertrain": "PWT",
  "steering": "STE",
  "suspension": "SUS",
  "wheels & tires": "WHE",
  "wheels and tires": "WHE"
};

function main() {
  const commit = process.argv.includes("--commit");
  if (!fs.existsSync(DB_PATH)) {
    console.error(`No database at ${DB_PATH}.`);
    process.exit(1);
  }

  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");

  const hasCodeColumn = columnExists(db, "subsystems", "code");
  const pending = STEPS.filter((s) => !s.applied(db));
  const already = STEPS.length - pending.length;

  console.log(`database : ${DB_PATH}`);
  console.log(`mode     : ${commit ? "COMMIT" : "DRY RUN (nothing written)"}`);
  console.log(`steps    : ${STEPS.length} total, ${already} already applied, ${pending.length} pending`);
  if (pending.length) {
    console.log(`\npending:`);
    for (const s of pending) console.log(`  + ${s.label}`);
  }

  // Which subsystems would gain a code, and which workbook tabs still have no home.
  const subs = db.prepare(
    hasCodeColumn ? `SELECT id, name, code FROM subsystems` : `SELECT id, name, NULL AS code FROM subsystems`
  ).all() as Array<{ id: string; name: string; code: string | null }>;
  const matched = subs.filter((s) => CODE_BY_NAME[s.name.trim().toLowerCase()]);
  // Only rows whose code is still NULL will actually be written. Reporting the
  // name-match count instead made a finished migration look like it had work
  // pending.
  const needsBackfill = matched.filter((s) => !s.code);
  const codesPresent = new Set(matched.map((s) => CODE_BY_NAME[s.name.trim().toLowerCase()]));
  const codesMissing = [...new Set(Object.values(CODE_BY_NAME))].filter((c) => !codesPresent.has(c)).sort();

  console.log(
    `\nsubsystem codes : ${needsBackfill.length} to backfill, ` +
      `${matched.length - needsBackfill.length} already set, of ${subs.length} subsystems`
  );
  if (codesMissing.length) {
    console.log(`workbook tabs with NO subsystem in this database: ${codesMissing.join(", ")}`);
    console.log(`  -> create these subsystems before importing those tabs.`);
  }

  if (!commit) {
    console.log(`\nDry run complete. Re-run with --commit to apply.`);
    db.close();
    return;
  }

  // Each step is its own transaction. If one fails, the steps before it stay
  // applied and the step list is re-derived from the database on the next run,
  // so a re-run resumes rather than redoing.
  let applied = 0;
  for (const s of pending) {
    try {
      db.transaction(() => {
        for (const sql of s.apply) db.exec(sql);
      })();
      applied++;
      console.log(`  applied  ${s.label}`);
    } catch (e: any) {
      console.error(`  FAILED   ${s.label}: ${e.message}`);
      console.error(`  Stopping. Steps already applied are intact; fix the cause and re-run.`);
      db.close();
      process.exit(1);
    }
  }

  // Backfill codes. Only fills a NULL — never overwrites a code someone set.
  const setCode = db.prepare(`UPDATE subsystems SET code = ? WHERE id = ? AND code IS NULL`);
  let coded = 0;
  db.transaction(() => {
    for (const s of subs) {
      const code = CODE_BY_NAME[s.name.trim().toLowerCase()];
      if (code) coded += setCode.run(code, s.id).changes;
    }
  })();

  // Seed the vehicle targets the workbook already defines, as placeholders.
  // Values are the workbook's own placeholders; the Chief Engineer replaces them.
  const TARGETS: Array<[string, string, number | null, string | null, string | null]> = [
    ["target_vehicle_mass_lb", "Target vehicle mass, no driver (lb)", 500, "lb", "Placeholder"],
    ["design_driver_mass_lb", "Design driver mass (lb)", 175, "lb", "Placeholder"],
    ["front_mass_distribution", "Front mass distribution", 0.4, null, "Placeholder"],
    ["wheelbase_mm", "Wheelbase (mm)", 1600, "mm", "Placeholder"],
    ["front_track_mm", "Front track (mm)", 1270, "mm", "Placeholder"],
    ["rear_track_mm", "Rear track (mm)", 1219, "mm", "Placeholder"],
    ["wheel_diameter_in", "Wheel diameter (in)", 13, "in", "Placeholder"],
    ["target_peak_power_hp", "Target peak power (hp)", 55, "hp", "Placeholder"],
    ["total_project_value_usd", "Total Project Value ($)", 100000, "USD", "Placeholder"],
    ["contingency_held_back", "Contingency held back", 0.125, null, "Placeholder"]
  ];
  const insTarget = db.prepare(
    `INSERT OR IGNORE INTO vehicle_targets (id, target_key, label, value_numeric, unit, source, is_placeholder)
     VALUES (?, ?, ?, ?, ?, ?, 1)`
  );
  let targets = 0;
  db.transaction(() => {
    for (const [key, label, value, unit, source] of TARGETS) {
      targets += insTarget.run(`vt_${nanoid(12)}`, key, label, value, unit, source).changes;
    }
  })();

  console.log(`\nschema steps applied      : ${applied}`);
  console.log(`subsystem codes backfilled: ${coded}`);
  console.log(`vehicle targets seeded    : ${targets} (placeholders — replace before any sponsor sees them)`);
  console.log(`\nMigration complete.`);
  db.close();
}

main();

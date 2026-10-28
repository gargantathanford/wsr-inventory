/**
 * Import WSR_Subsystem_Parts_List into the dashboard parts table.
 *
 * Usage (from the project root, with the database already seeded):
 *   npx tsx scripts/import-parts-sheet.ts ./WSR_Subsystem_Parts_List_V0.5.xlsx
 *   npx tsx scripts/import-parts-sheet.ts ./WSR_Subsystem_Parts_List_V0.5.xlsx --commit
 *
 * Default is a DRY RUN: it reports exactly what would happen and writes nothing.
 * Add --commit to write.
 *
 * Re-runnable. Each sheet line carries a permanent ID (PWT-001). That ID is
 * stored in parts.sheet_ref, so a second run UPDATES the matching part instead
 * of creating a duplicate. Fields a human has since edited in the dashboard and
 * that the sheet leaves blank are never overwritten with null.
 *
 * SECURITY NOTE: this reads a spreadsheet with XLSX.read, which is the parse
 * path the two open SheetJS advisories live in. That is acceptable HERE and
 * only here: this is a command-line tool an admin runs against the team's own
 * file. Do not lift this logic into an HTTP route that accepts uploads without
 * revisiting ARCHITECTURE_REVIEW.md section 3.
 */
import path from "path";
import fs from "fs";
import Database from "better-sqlite3";
import * as XLSX from "xlsx";
import { nanoid } from "nanoid";

const DB_PATH = process.env.WSR_DB_PATH || path.join(process.cwd(), "data", "wsr.db");

/** Spreadsheet tab code -> subsystems.name in the dashboard. */
const SUBSYSTEM_BY_CODE: Record<string, string> = {
  AER: "Aerodynamics",
  BRK: "Brakes",
  CHS: "Chassis",
  CVT: "Drivetrain",
  ELE: "Electrical",
  ERG: "Ergonomics",
  MFG: "Manufacturing",
  PWT: "Powertrain",
  STE: "Steering",
  SUS: "Suspension",
  WHE: "Wheels & Tires"
};

/**
 * The workbook's Status column is DESIGN maturity. v2 stores it as such in
 * parts.design_status instead of flattening it into purchase_status.
 */
const DESIGN_STATUS: Record<string, string> = {
  Placeholder: "PLACEHOLDER",
  Candidate: "CANDIDATE",
  Quoted: "QUOTED",
  Selected: "SELECTED",
  Frozen: "FROZEN"
};

/**
 * Purchase status is a separate axis and the workbook does not track it, so it
 * is seeded from design maturity as a starting guess the leads then correct.
 * A QUOTED line has a price in writing but nobody has approved spending it.
 */
const PURCHASE_STATUS: Record<string, string> = {
  Placeholder: "NEEDED",
  Candidate: "RESEARCHING",
  Quoted: "AWAITING_APPROVAL",
  Selected: "APPROVED",
  Frozen: "APPROVED"
};

const SPONSOR_ASK: Record<string, string> = {
  Cash: "CASH",
  "In-kind": "IN_KIND",
  Discount: "DISCOUNT",
  Buy: "BUY"
};

const LB_TO_KG = 0.45359237;

/**
 * Importance is NOT a column in the spreadsheet, so it is inferred. Without this
 * every imported part lands on the same MEDIUM/5, and every priority view in the
 * dashboard — readiness %, procurement priority, the shopping list sort — becomes
 * a flat list. The inference is deliberately crude and leads are expected to
 * correct it; it exists to produce a usable spread on day one, not to be right.
 *
 *   CRITICAL  a specific rule clause is cited (contains a rule number), or the
 *             line sits on a P1 interface in the register
 *   HIGH      a rule family is cited without a clause number, or the line is
 *             already Selected / Frozen
 *   MEDIUM    everything else
 */
function inferImportance(rule: string | null, status: string | null, p1: boolean): "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" {
  const realRule = rule && !/^n\/?a/i.test(rule) && !/cite rule/i.test(rule) ? rule : null;
  if (p1) return "CRITICAL";
  if (realRule && /\d/.test(realRule)) return "CRITICAL";
  if (realRule) return "HIGH";
  if (status === "Selected" || status === "Frozen") return "HIGH";
  return "MEDIUM";
}

const STD_COLS: Record<string, number> = {
  id: 0, component: 1, scope: 2, qty: 3, status: 4, alloc_mass_ea: 5, alloc_mass_line: 6,
  candidate_pn: 7, vendor: 8, cand_mass_ea: 9, cand_mass_line: 10, mass_delta: 11, mass_check: 12,
  cost_low_ea: 13, cost_high_ea: 14, cost_low_line: 15, cost_high_line: 16, sponsor_ask: 17,
  governing_rule: 18, driving_target: 19, acceptance: 20, interfaces: 21, interface_ids: 22,
  owner: 23, needed_by: 24, lead_time_days: 25, order_by: 26, order_status: 27, notes: 28, links: 29
};
const MFG_COLS: Record<string, number> = {
  id: 0, component: 1, category: 2, scope: 3, used_by: 4, qty: 5, unit: 6, status: 7,
  make_method: 8, vendor: 9, cost_low_ea: 10, cost_high_ea: 11, cost_low_line: 12, cost_high_line: 13,
  sponsor_ask: 14, lead_time_days: 15, needed_by: 16, order_by: 17, order_status: 18, owner: 19,
  notes: 20, links: 21
};

type Row = Record<string, any>;

const str = (v: any): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || s === "TBD" || s === "N/A") return null;
  return s;
};
/** XLSX returns real Date objects for date cells; the sheet also holds "TBD" and plain text. */
const isoDate = (v: any): string | null => {
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = str(v);
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0] : null;
};
const num = (v: any): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
};

function ensureSheetRefColumn(db: Database.Database) {
  const cols = db.prepare(`PRAGMA table_info(parts)`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "sheet_ref")) {
    db.exec(`ALTER TABLE parts ADD COLUMN sheet_ref TEXT`);
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_parts_sheet_ref ON parts(sheet_ref) WHERE sheet_ref IS NOT NULL`);
}

function main() {
  const file = process.argv[2];
  const commit = process.argv.includes("--commit");
  if (!file || !fs.existsSync(file)) {
    console.error("Usage: npx tsx scripts/import-parts-sheet.ts <workbook.xlsx> [--commit]");
    process.exit(1);
  }
  if (!fs.existsSync(DB_PATH)) {
    console.error(`No database at ${DB_PATH}. Seed it first (npm run seed:prod).`);
    process.exit(1);
  }

  const wb = XLSX.read(fs.readFileSync(file), { type: "buffer", cellDates: true });
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");

  // v2 joins on subsystems.code (the workbook tab code), not the English name.
  // Falls back to the name map for a database that has not been migrated yet.
  const subByCode = new Map<string, string>();
  const subByName = new Map<string, string>();
  const hasCode = (db.prepare(`PRAGMA table_info(subsystems)`).all() as Array<{ name: string }>).some(
    (c) => c.name === "code"
  );
  for (const row of db.prepare(`SELECT * FROM subsystems`).all() as Array<any>) {
    subByName.set(String(row.name).toLowerCase(), row.id);
    if (hasCode && row.code) subByCode.set(String(row.code).toUpperCase(), row.id);
  }
  const resolveSubsystem = (code: string, fallbackName: string): string | undefined =>
    subByCode.get(code) ?? subByName.get(fallbackName.toLowerCase());

  // P1 interfaces, used to raise importance on the parts that sit on them.
  const p1Parts = new Set<string>();
  if (wb.Sheets["Interfaces"]) {
    const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets["Interfaces"], { header: 1, blankrows: false });
    for (const r of rows) {
      const id = str(r[0]);
      if (!id || !/^[A-Z]{3}_[A-Z]{3}_\d{3}$/.test(id)) continue;
      if (str(r[1]) !== "P1") continue;
      for (const side of [str(r[4]), str(r[5])]) if (side) p1Parts.add(side);
    }
  }

  const missingSubsystems = new Set<string>();
  const skippedBlank: string[] = [];
  const staged: Array<Record<string, any>> = [];

  for (const [code, subName] of Object.entries(SUBSYSTEM_BY_CODE)) {
    const ws = wb.Sheets[code];
    if (!ws) continue;
    const subId = resolveSubsystem(code, subName);
    if (!subId) missingSubsystems.add(`tab ${code} has no subsystem (code "${code}" or name "${subName}")`);
    const cols = code === "MFG" ? MFG_COLS : STD_COLS;
    const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, blankrows: false });
    const idRe = new RegExp(`^${code}-\\d+$`);

    for (const raw of rows) {
      const sheetRef = str(raw[cols.id]);
      if (!sheetRef || !idRe.test(sheetRef)) continue; // header block and the -EX example row
      const r: Row = {};
      for (const [k, i] of Object.entries(cols)) r[k] = raw[i];

      const name = str(r.component);
      if (!name) { skippedBlank.push(sheetRef); continue; }
      if (!subId) continue;

      const lo = num(r.cost_low_ea);
      const hi = num(r.cost_high_ea);
      const massLb = num(r.cand_mass_ea);
      const needed = isoDate(r.needed_by);

      // v2 gives governing rule, driving target, acceptance criterion, sponsor
      // ask, unit of measure and allocated mass their own columns, so only the
      // genuinely free-form text is left in description.
      const desc = [
        str(r.scope),
        str(r.make_method) ? `MAKE METHOD: ${str(r.make_method)}` : null,
        str(r.used_by) ? `USED BY: ${str(r.used_by)}` : null,
        str(r.mass_check) ? `MASS CHECK (sheet): ${str(r.mass_check)}` : null,
        str(r.interfaces) ? `INTERFACES (free text): ${str(r.interfaces)}` : null,
        str(r.owner) ? `DECISION OWNER (sheet): ${str(r.owner)}` : null,
        str(r.notes) ? `NOTES: ${str(r.notes)}` : null
      ].filter(Boolean).join("\n");

      staged.push({
        sheet_ref: sheetRef,
        part_name: name.slice(0, 200),
        part_number: str(r.candidate_pn),
        manufacturer: str(r.vendor),
        category: str(r.category),
        subsystem_id: subId,
        description: desc || null,
        quantity_required: Math.max(1, Math.round(num(r.qty) ?? 1)),
        status: "NEEDED",
        importance: inferImportance(str(r.governing_rule), str(r.status), p1Parts.has(sheetRef)),
        priority_score: 5,
        estimated_cost: lo !== null && hi !== null ? (lo + hi) / 2 : (lo ?? hi),
        estimated_cost_low: lo,
        estimated_cost_high: hi,
        design_status: DESIGN_STATUS[str(r.status) ?? ""] ?? "PLACEHOLDER",
        governing_rule: str(r.governing_rule),
        driving_target: str(r.driving_target),
        acceptance_criterion: str(r.acceptance),
        sponsor_ask: SPONSOR_ASK[str(r.sponsor_ask) ?? ""] ?? null,
        unit_of_measure: str(r.unit),
        allocated_mass_kg:
          num(r.alloc_mass_ea) !== null ? Number((num(r.alloc_mass_ea)! * LB_TO_KG).toFixed(3)) : null,
        lead_time_days: num(r.lead_time_days) !== null ? Math.round(num(r.lead_time_days)!) : null,
        purchase_url: str(r.links),
        supplier: str(r.vendor),
        weight_kg: massLb !== null ? Number((massLb * LB_TO_KG).toFixed(3)) : null,
        required_by_date: needed,
        purchase_status: PURCHASE_STATUS[str(r.status) ?? ""] ?? "NEEDED",
        approval_status: "APPROVED"
      });
    }
  }

  // ---- competition deadlines from the 'Vehicle Targets' tab -> calendar_events
  type Deadline = { title: string; competition: string | null; due: Date; cancel: Date | null; gfr: boolean };
  const deadlines: Deadline[] = [];
  if (wb.Sheets["Vehicle Targets"]) {
    const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets["Vehicle Targets"], { header: 1, blankrows: false });
    let inBlock = false;
    for (const r of rows) {
      if (str(r[0]) === "Deadlines") { inBlock = true; continue; }
      if (!inBlock) continue;
      const title = str(r[0]);
      if (!title || !(r[2] instanceof Date)) continue;
      if (/^\[R\]|^GFR|^Single \*|^Double \*|^Rules References/.test(title)) continue;
      deadlines.push({
        title,
        competition: str(r[1]),
        due: r[2] as Date,
        cancel: r[3] instanceof Date ? (r[3] as Date) : null,
        gfr: /^yes$/i.test(String(r[4] ?? ""))
      });
    }
  }

  const importance: Record<string, number> = {};
  for (const s of staged) importance[s.importance] = (importance[s.importance] || 0) + 1;

  console.log(`workbook              : ${path.basename(file)}`);
  console.log(`database              : ${DB_PATH}`);
  console.log(`mode                  : ${commit ? "COMMIT" : "DRY RUN (nothing written)"}`);
  console.log(`lines ready to import : ${staged.length}`);
  console.log(`blank lines skipped   : ${skippedBlank.length}${skippedBlank.length ? ` (${skippedBlank.slice(0, 4).join(", ")}${skippedBlank.length > 4 ? ", …" : ""})` : ""}`);
  console.log(`inferred importance   : ${JSON.stringify(importance)}`);
  console.log(`competition deadlines : ${deadlines.length} (-> calendar_events)`);
  const tally = (key: string) => {
    const t: Record<string, number> = {};
    for (const s2 of staged) { const v = String((s2 as any)[key] ?? "none"); t[v] = (t[v] || 0) + 1; }
    return JSON.stringify(t);
  };
  console.log(`design_status         : ${tally("design_status")}`);
  console.log(`sponsor_ask           : ${tally("sponsor_ask")}`);
  if (missingSubsystems.size) {
    console.log(`\nBLOCKED — these spreadsheet tabs have no matching subsystem in the dashboard:`);
    for (const m of missingSubsystems) console.log(`  ${m}`);
    console.log(`Create them in Settings (or seed them) and re-run.`);
  }

  if (!commit) {
    console.log(`\nDry run complete. Re-run with --commit to write.`);
    db.close();
    return;
  }

  ensureSheetRefColumn(db);

  const existing = new Map<string, string>();
  for (const r of db.prepare(`SELECT id, sheet_ref FROM parts WHERE sheet_ref IS NOT NULL`).all() as Array<{ id: string; sheet_ref: string }>) {
    existing.set(r.sheet_ref, r.id);
  }

  const FIELDS = ["part_name","part_number","manufacturer","category","subsystem_id","description",
    "quantity_required","importance","priority_score","estimated_cost","lead_time_days",
    "purchase_url","supplier","weight_kg","required_by_date","purchase_status",
    "estimated_cost_low","estimated_cost_high","design_status","governing_rule","driving_target",
    "acceptance_criterion","sponsor_ask","unit_of_measure","allocated_mass_kg"];

  const insert = db.prepare(`INSERT INTO parts (id, sheet_ref, status, approval_status, quantity_owned, ${FIELDS.join(", ")})
    VALUES (@id, @sheet_ref, @status, @approval_status, 0, ${FIELDS.map((f) => "@" + f).join(", ")})`);
  // Only overwrite a column when the sheet actually has a value for it, so a
  // lead's dashboard edits survive a re-import of a still-incomplete sheet.
  const updateSql = `UPDATE parts SET ${FIELDS.map((f) => `${f} = COALESCE(@${f}, ${f})`).join(", ")}, updated_at = datetime('now') WHERE id = @id`;
  const update = db.prepare(updateSql);

  let created = 0, updated = 0;
  const run = db.transaction(() => {
    for (const s of staged) {
      const id = existing.get(s.sheet_ref);
      if (id) { update.run({ ...s, id }); updated++; }
      else { insert.run({ ...s, id: `part_${nanoid(12)}` }); created++; }
    }
  });
  run();

  // calendar_events: title is not unique in the schema, so dedupe on (title, deadline_date).
  const existingEvent = db.prepare(
    `SELECT id FROM calendar_events WHERE title = ? AND deadline_date = ?`
  );
  const insertEvent = db.prepare(
    `INSERT INTO calendar_events (id, title, description, event_type, deadline_date, deadline_time,
       priority, links, is_actionable, status, reminder_intervals, notify_scope, created_by)
     VALUES (@id, @title, @description, 'DEADLINE', @deadline_date, @deadline_time,
       @priority, NULL, 1, 'UPCOMING', @reminder_intervals, 'EVERYONE', @created_by)`
  );
  const anyAdmin = db.prepare(`SELECT id FROM users WHERE role = 'ADMIN' ORDER BY created_at LIMIT 1`).get() as
    | { id: string }
    | undefined;
  let events = 0;
  const runEvents = db.transaction(() => {
    for (const d of deadlines) {
      const date = d.due.toISOString().slice(0, 10);
      if (existingEvent.get(d.title, date)) continue;
      insertEvent.run({
        id: `cal_${nanoid(12)}`,
        title: d.title,
        description: [
          d.competition ? `Competition: ${d.competition}` : null,
          d.cancel ? `Cancelation date: ${d.cancel.toISOString().slice(0, 16).replace("T", " ")}` : null,
          d.gfr ? "GROUNDS FOR REMOVAL if missed." : null,
          "Imported from the Vehicle Targets tab of the parts workbook."
        ].filter(Boolean).join("\n"),
        deadline_date: date,
        deadline_time: d.due.toISOString().slice(11, 16),
        // Grounds-for-removal submissions are CRITICAL; the rest are HIGH.
        priority: d.gfr ? "CRITICAL" : "HIGH",
        reminder_intervals: JSON.stringify(d.gfr ? [30, 14, 7, 3, 1, 0] : [14, 7, 1]),
        created_by: anyAdmin?.id ?? null
      });
      events++;
    }
  });
  runEvents();

  console.log(`\ncreated : ${created}`);
  console.log(`updated : ${updated}`);
  console.log(`calendar events added : ${events}`);
  console.log(`parts in database now : ${(db.prepare(`SELECT COUNT(*) c FROM parts`).get() as any).c}`);
  console.log(`calendar events now   : ${(db.prepare(`SELECT COUNT(*) c FROM calendar_events`).get() as any).c}`);
  db.close();
}

main();

/**
 * Import an FSAE ruleset into the dashboard so parts, procedures, tasks and
 * interfaces can cite clauses by selection instead of by recall.
 *
 * Usage (from the project root):
 *   # 1. turn the PDF into text, once, with whatever is on the machine:
 *   pdftotext -layout FSAE_Rules_2027_V1.pdf rules-2027.txt
 *
 *   # 2. import it
 *   npx tsx scripts/import-ruleset.ts rules-2027.txt --year 2027 --version 1.0
 *   npx tsx scripts/import-ruleset.ts rules-2027.txt --year 2027 --version 1.0 --commit
 *
 *   # make it the edition new citations are picked from
 *   npx tsx scripts/import-ruleset.ts rules-2027.txt --year 2027 --version 1.0 --commit --activate
 *
 * TAKES TEXT, NOT PDF, DELIBERATELY. Parsing a PDF means running a parser over
 * a file format designed for layout, and the team's rulesets arrive from SAE as
 * PDFs that somebody downloads. Converting first with pdftotext keeps the PDF
 * parser out of this codebase and out of any future upload route — the same
 * reasoning as ARCHITECTURE_REVIEW.md section 3 applies to spreadsheets.
 *
 * A ruleset is ADDED, never overwritten. Clause numbers move between editions,
 * so existing citations are reconciled against a new edition on purpose rather
 * than silently re-pointed. A part that quietly re-cites a renumbered clause is
 * worse than a part with no citation, because it reads as verified.
 */
import path from "path";
import fs from "fs";
import Database from "better-sqlite3";
import { nanoid } from "nanoid";

const DB_PATH = process.env.WSR_DB_PATH || path.join(process.cwd(), "data", "wsr.db");

/**
 * A clause line is an ID at the start of a line followed by its text:
 *   T.5.2.7 Chain Drive - Scatter shields for chains must:
 * Sections are one to three capitals; depth runs one to four levels.
 */
const CLAUSE = /^([A-Z]{1,3}(?:\.\d+){1,4})\s+(\S.*)$/;

/**
 * Table-of-contents lines look the same but end in dot leaders and a page
 * number: "T.5 Powertrain...........68". Those are not clauses.
 */
const TOC_LINE = /\.{4,}\s*\d+\s*$/;

type Clause = {
  clause_id: string;
  section: string;
  parent_clause_id: string | null;
  depth: number;
  heading: string;
  body: string;
};

export function parseRuleset(text: string): { clauses: Clause[]; tocSkipped: number } {
  const lines = text.split(/\r?\n/);
  const hits: Array<{ i: number; id: string; heading: string }> = [];
  let tocSkipped = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+$/, "");
    const m = CLAUSE.exec(line);
    if (!m) continue;
    if (TOC_LINE.test(line)) {
      tocSkipped++;
      continue;
    }
    hits.push({ i, id: m[1], heading: m[2].trim() });
  }

  // A clause ID can appear more than once — cross-references inside other
  // clauses, or a repeated header. The FIRST non-TOC occurrence is the clause
  // itself, since the document is in order.
  const firstAt = new Map<string, { i: number; heading: string }>();
  for (const h of hits) if (!firstAt.has(h.id)) firstAt.set(h.id, { i: h.i, heading: h.heading });

  const ordered = [...firstAt.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => a.i - b.i);

  const clauses: Clause[] = ordered.map((c, idx) => {
    // Body runs from this clause's line to the next clause's line.
    const end = idx + 1 < ordered.length ? ordered[idx + 1].i : lines.length;
    const body = lines
      .slice(c.i, end)
      .map((l) => l.trim())
      .filter(Boolean)
      .join(" ")
      // Drop the page furniture that pdftotext leaves inline.
      .replace(/Formula SAE® Rules \d{4} © \d{4} SAE International Page \d+ of \d+/g, "")
      .replace(/Version [\d.]+\s+\d+ \w+ \d{4}/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();

    const parts = c.id.split(".");
    return {
      clause_id: c.id,
      section: parts[0],
      parent_clause_id: parts.length > 2 ? parts.slice(0, -1).join(".") : parts.length === 2 ? parts[0] : null,
      depth: parts.length - 1,
      heading: c.heading.slice(0, 500),
      body: body || c.heading
    };
  });

  return { clauses, tocSkipped };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main() {
  const file = process.argv[2];
  const commit = process.argv.includes("--commit");
  const activate = process.argv.includes("--activate");
  const year = Number(arg("year"));
  const version = arg("version") ?? "1.0";

  if (!file || !fs.existsSync(file) || !Number.isFinite(year)) {
    console.error(
      `Usage: npx tsx scripts/import-ruleset.ts <rules.txt> --year 2027 [--version 1.0] [--commit] [--activate]\n` +
        `Convert the PDF first:  pdftotext -layout FSAE_Rules_2027_V1.pdf rules-2027.txt`
    );
    process.exit(1);
  }
  if (!fs.existsSync(DB_PATH)) {
    console.error(`No database at ${DB_PATH}.`);
    process.exit(1);
  }

  const label = `FSAE Rules ${year} V${version}`;
  const { clauses, tocSkipped } = parseRuleset(fs.readFileSync(file, "utf-8"));

  const bySection: Record<string, number> = {};
  for (const c of clauses) bySection[c.section] = (bySection[c.section] || 0) + 1;
  const thin = clauses.filter((c) => c.body.length <= 40).length;

  console.log(`source      : ${path.basename(file)}`);
  console.log(`ruleset     : ${label}`);
  console.log(`mode        : ${commit ? (activate ? "COMMIT + ACTIVATE" : "COMMIT") : "DRY RUN (nothing written)"}`);
  console.log(`clauses     : ${clauses.length}  (TOC lines skipped: ${tocSkipped})`);
  console.log(`sections    : ${Object.entries(bySection).sort().map(([k, v]) => `${k}=${v}`).join(" ")}`);
  console.log(`depth       : ${JSON.stringify(
    clauses.reduce<Record<number, number>>((a, c) => ((a[c.depth] = (a[c.depth] || 0) + 1), a), {})
  )}`);
  console.log(`heading-only: ${thin} clauses with 40 chars or less of body (section headers, mostly)`);

  if (clauses.length < 200) {
    console.error(
      `\nOnly ${clauses.length} clauses found. A full FSAE ruleset has well over a thousand.\n` +
        `The text extraction probably failed — re-run pdftotext with -layout, and check the\n` +
        `output actually contains lines like "T.5.2.7 Chain Drive - ...".`
    );
    process.exit(1);
  }

  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");

  const existing = db.prepare(`SELECT id, clause_count FROM rulesets WHERE label = ?`).get(label) as
    | { id: string; clause_count: number }
    | undefined;
  if (existing) {
    console.log(`\n"${label}" is already imported (${existing.clause_count} clauses). Nothing to do.`);
    console.log(`Importing a revised edition? Bump --version so it lands as its own ruleset.`);
    if (activate && commit) {
      db.transaction(() => {
        db.prepare(`UPDATE rulesets SET is_active = 0`).run();
        db.prepare(`UPDATE rulesets SET is_active = 1 WHERE id = ?`).run(existing.id);
      })();
      console.log(`Activated "${label}".`);
    }
    db.close();
    return;
  }

  console.log(`\nsample:`);
  for (const c of [clauses[0], clauses[Math.floor(clauses.length / 2)], clauses[clauses.length - 1]]) {
    console.log(`  ${c.clause_id.padEnd(12)} ${c.heading.slice(0, 64)}`);
  }

  if (!commit) {
    console.log(`\nDry run complete. Re-run with --commit to write.`);
    db.close();
    return;
  }

  const rulesetId = `rs_${nanoid(12)}`;
  const insRuleset = db.prepare(
    `INSERT INTO rulesets (id, label, year, version, source_filename, clause_count, is_active)
     VALUES (?, ?, ?, ?, ?, ?, 0)`
  );
  const insRule = db.prepare(
    `INSERT INTO rules (id, ruleset_id, clause_id, section, parent_clause_id, depth, heading, body)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  db.transaction(() => {
    insRuleset.run(rulesetId, label, year, version, path.basename(file), clauses.length);
    for (const c of clauses) {
      insRule.run(
        `rul_${nanoid(12)}`,
        rulesetId,
        c.clause_id,
        c.section,
        c.parent_clause_id,
        c.depth,
        c.heading,
        c.body
      );
    }
    if (activate) {
      db.prepare(`UPDATE rulesets SET is_active = 0`).run();
      db.prepare(`UPDATE rulesets SET is_active = 1 WHERE id = ?`).run(rulesetId);
    }
  })();

  console.log(`\nimported ${clauses.length} clauses as "${label}"${activate ? " (now active)" : ""}`);

  // Reconcile free-text citations already sitting in parts.governing_rule.
  // Report only — nothing is auto-linked, because a wrong auto-link reads as
  // verified compliance.
  const valid = new Set(
    (db.prepare(`SELECT clause_id FROM rules WHERE ruleset_id = ?`).all(rulesetId) as Array<{ clause_id: string }>).map(
      (r) => r.clause_id
    )
  );
  const parts = db
    .prepare(`SELECT id, part_name, governing_rule FROM parts WHERE governing_rule IS NOT NULL AND governing_rule != ''`)
    .all() as Array<{ id: string; part_name: string; governing_rule: string }>;

  const CITE = /\b[A-Z]{1,3}(?:\.\d+){1,4}\b/g;
  let withClause = 0;
  const resolved = new Set<string>();
  const unresolved = new Map<string, string[]>();
  for (const p of parts) {
    const found = p.governing_rule.match(CITE) ?? [];
    if (found.length) withClause++;
    for (const f of found) {
      if (valid.has(f)) resolved.add(f);
      else unresolved.set(f, [...(unresolved.get(f) ?? []), p.part_name]);
    }
  }

  console.log(`\nexisting governing_rule text, checked against this ruleset:`);
  console.log(`  parts with a free-text rule   : ${parts.length}`);
  console.log(`  of those, citing a clause ID  : ${withClause}`);
  console.log(`  distinct clauses resolved     : ${resolved.size}`);
  console.log(`  distinct clauses NOT resolved : ${unresolved.size}`);
  for (const [clause, names] of unresolved) {
    console.log(`    ${clause} — cited by ${names.length} part(s), e.g. ${names[0]}`);
  }
  console.log(
    `\nNothing was auto-linked. Leads attach clauses from the picker; a citation\n` +
      `pointed at the wrong clause by a script would read as verified compliance.`
  );

  db.close();
}

if (require.main === module) main();

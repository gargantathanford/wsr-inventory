/**
 * Taxonomy migration — reconcile the dashboard's subsystem list with the parts
 * workbook.
 *
 *   MERGE   Electronics  -> Electrical          (the workbook has one ELE tab)
 *   ADD     Wheels & Tires, code WHE            (13% of vehicle mass, 6% of budget)
 *   DEMOTE  Engine, Intake, Fuel System,        (the workbook treats these as
 *           Cooling, Exhaust -> subteams         Powertrain sub-leads, not
 *           of Powertrain                        subsystems)
 *
 * Usage (from the project root):
 *   npx tsx scripts/migrate-taxonomy.ts            # report what would change
 *   npx tsx scripts/migrate-taxonomy.ts --commit   # apply
 *
 * Run scripts/migrate-v2.ts FIRST — this needs subsystems.code to exist.
 * Back up before committing:  docker compose run --rm backup
 *
 * WHY THIS IS NOT A SIMPLE DELETE
 *
 * Thirteen columns across the schema reference subsystems(id), and six of them
 * are ON DELETE CASCADE: parts, subsystem_members, procedures, documents,
 * subteams and tasks. Deleting a subsystem silently deletes every part,
 * procedure, document and task attached to it. So every referencing row is
 * repointed FIRST, the subsystem is verified empty, and only then is it removed.
 *
 * The referencing columns are discovered at runtime with PRAGMA foreign_key_list
 * rather than hardcoded, so a column added later is still handled.
 *
 * Three unique constraints can collide when two subsystems fold into one:
 *   subsystem_members  UNIQUE(subsystem_id, user_id)   — user in both
 *   tool_subsystems    UNIQUE(tool_id, subsystem_id)   — tool linked to both
 *   subteams           UNIQUE(subsystem_id, name)      — same subteam name
 * In each case the row that would collide is dropped rather than repointed,
 * because it is a duplicate of a link that already exists on the target.
 */
import path from "path";
import fs from "fs";
import Database from "better-sqlite3";
import { nanoid } from "nanoid";

const DB_PATH = process.env.WSR_DB_PATH || path.join(process.cwd(), "data", "wsr.db");

const MERGE: Array<{ from: string; into: string }> = [{ from: "Electronics", into: "Electrical" }];

const ADD: Array<{ name: string; code: string; massShare: number; budgetShare: number }> = [
  { name: "Wheels & Tires", code: "WHE", massShare: 0.13, budgetShare: 0.06 }
];

const DEMOTE: Array<{ name: string; under: string }> = [
  { name: "Engine", under: "Powertrain" },
  { name: "Intake", under: "Powertrain" },
  { name: "Fuel System", under: "Powertrain" },
  { name: "Cooling", under: "Powertrain" },
  { name: "Exhaust", under: "Powertrain" }
];

/** (table, column) pairs that reference subsystems(id) — discovered, not hardcoded. */
function subsystemRefs(db: Database.Database): Array<{ table: string; column: string }> {
  const tables = (
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
      .all() as Array<{ name: string }>
  ).map((t) => t.name);

  const refs: Array<{ table: string; column: string }> = [];
  for (const table of tables) {
    if (table === "subsystems") continue;
    const fks = db.prepare(`PRAGMA foreign_key_list(${table})`).all() as Array<{
      table: string;
      from: string;
    }>;
    for (const fk of fks) {
      if (fk.table === "subsystems") refs.push({ table, column: fk.from });
    }
  }
  return refs;
}

const hasColumn = (db: Database.Database, table: string, column: string): boolean =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((c) => c.name === column);

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

type Sub = { id: string; name: string; code: string | null };

function main() {
  const commit = process.argv.includes("--commit");
  if (!fs.existsSync(DB_PATH)) {
    console.error(`No database at ${DB_PATH}.`);
    process.exit(1);
  }

  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");

  if (!hasColumn(db, "subsystems", "code")) {
    console.error(`subsystems.code is missing. Run scripts/migrate-v2.ts --commit first.`);
    process.exit(1);
  }

  const refs = subsystemRefs(db);
  const byName = new Map<string, Sub>();
  for (const s of db.prepare(`SELECT id, name, code FROM subsystems`).all() as Sub[]) {
    byName.set(s.name.trim().toLowerCase(), s);
  }
  const find = (name: string) => byName.get(name.trim().toLowerCase());

  const countRows = (sub: Sub) =>
    refs.map((r) => ({
      ...r,
      n: (db.prepare(`SELECT COUNT(*) c FROM ${r.table} WHERE ${r.column} = ?`).get(sub.id) as { c: number }).c
    }));

  console.log(`database : ${DB_PATH}`);
  console.log(`mode     : ${commit ? "COMMIT" : "DRY RUN (nothing written)"}`);
  console.log(`columns referencing subsystems(id): ${refs.length}`);
  console.log(`  ${refs.map((r) => `${r.table}.${r.column}`).join(", ")}`);

  // ---------- plan ----------
  console.log(`\n--- MERGE`);
  const mergePlan: Array<{ from: Sub; into: Sub; moves: Array<{ table: string; column: string; n: number }> }> = [];
  for (const m of MERGE) {
    const from = find(m.from);
    const into = find(m.into);
    if (!from) {
      console.log(`  skip: "${m.from}" does not exist (already merged?)`);
      continue;
    }
    if (!into) {
      console.log(`  BLOCKED: "${m.from}" exists but target "${m.into}" does not.`);
      process.exit(1);
    }
    const moves = countRows(from).filter((x) => x.n > 0);
    mergePlan.push({ from, into, moves });
    console.log(
      `  ${from.name} -> ${into.name}: ${moves.reduce((s, x) => s + x.n, 0)} rows` +
        (moves.length ? ` (${moves.map((x) => `${x.table}.${x.column}=${x.n}`).join(", ")})` : " (none)")
    );
  }

  console.log(`\n--- ADD`);
  const addPlan = ADD.filter((a) => {
    const existing = find(a.name);
    if (existing) {
      console.log(`  skip: "${a.name}" already exists${existing.code ? ` (code ${existing.code})` : ""}`);
      return false;
    }
    console.log(`  create: ${a.name} (code ${a.code}, mass ${a.massShare}, budget ${a.budgetShare})`);
    return true;
  });

  console.log(`\n--- DEMOTE to subteam`);
  const demotePlan: Array<{ sub: Sub; parent: Sub; moves: Array<{ table: string; column: string; n: number }> }> = [];
  for (const d of DEMOTE) {
    const sub = find(d.name);
    const parent = find(d.under);
    if (!sub) {
      console.log(`  skip: "${d.name}" does not exist (already demoted?)`);
      continue;
    }
    if (!parent) {
      console.log(`  BLOCKED: "${d.name}" exists but parent "${d.under}" does not.`);
      process.exit(1);
    }
    const moves = countRows(sub).filter((x) => x.n > 0);
    demotePlan.push({ sub, parent, moves });
    console.log(
      `  ${sub.name} -> subteam of ${parent.name}: ${moves.reduce((s, x) => s + x.n, 0)} rows` +
        (moves.length ? ` (${moves.map((x) => `${x.table}.${x.column}=${x.n}`).join(", ")})` : " (none)")
    );
  }

  if (!commit) {
    console.log(`\nDry run complete. Re-run with --commit to apply.`);
    db.close();
    return;
  }

  // ---------- apply ----------
  // parts.subteam_id is what preserves which Powertrain area a part belongs to
  // once the five areas stop being subsystems of their own.
  if (!hasColumn(db, "parts", "subteam_id")) {
    db.exec(`ALTER TABLE parts ADD COLUMN subteam_id TEXT REFERENCES subteams(id) ON DELETE SET NULL`);
    console.log(`\n  added parts.subteam_id`);
  }

  /**
   * Repoint every row referencing `fromId` to `toId`. Rows that would violate
   * one of the three unique constraints are deleted instead: they duplicate a
   * link the target already has.
   */
  function repoint(fromId: string, toId: string): { moved: number; dropped: number } {
    let moved = 0;
    let dropped = 0;
    for (const r of refs) {
      // Drop would-be duplicates first, so the UPDATE cannot fail.
      if (r.table === "subsystem_members" && r.column === "subsystem_id") {
        // A user who belongs to both keeps the SENIOR role. Dropping the
        // duplicate blindly would demote a lead to member whenever the lead of
        // the merged-away subsystem happened to be a member of the target.
        db.prepare(
          `UPDATE subsystem_members SET role_in_subsystem = 'LEADER'
             WHERE subsystem_id = ?
               AND user_id IN (
                 SELECT user_id FROM subsystem_members
                  WHERE subsystem_id = ? AND role_in_subsystem = 'LEADER'
               )`
        ).run(toId, fromId);
        dropped += db
          .prepare(
            `DELETE FROM subsystem_members WHERE subsystem_id = ?
               AND user_id IN (SELECT user_id FROM subsystem_members WHERE subsystem_id = ?)`
          )
          .run(fromId, toId).changes;
      } else if (r.table === "tool_subsystems" && r.column === "subsystem_id") {
        dropped += db
          .prepare(
            `DELETE FROM tool_subsystems WHERE subsystem_id = ?
               AND tool_id IN (SELECT tool_id FROM tool_subsystems WHERE subsystem_id = ?)`
          )
          .run(fromId, toId).changes;
      } else if (r.table === "subteams" && r.column === "subsystem_id") {
        dropped += db
          .prepare(
            `DELETE FROM subteams WHERE subsystem_id = ?
               AND name IN (SELECT name FROM subteams WHERE subsystem_id = ?)`
          )
          .run(fromId, toId).changes;
      }
      moved += db.prepare(`UPDATE ${r.table} SET ${r.column} = ? WHERE ${r.column} = ?`).run(toId, fromId).changes;
    }
    return { moved, dropped };
  }

  /** Refuse to delete a subsystem anything still points at — CASCADE would eat it. */
  function assertEmpty(sub: Sub) {
    const left = countRows(sub).filter((x) => x.n > 0);
    if (left.length) {
      throw new Error(
        `Refusing to delete "${sub.name}": still referenced by ` +
          left.map((x) => `${x.table}.${x.column}=${x.n}`).join(", ")
      );
    }
  }

  let summary = { merged: 0, movedRows: 0, droppedRows: 0, added: 0, demoted: 0, subteams: 0 };

  try {
    db.transaction(() => {
      // MERGE
      for (const p of mergePlan) {
        const { moved, dropped } = repoint(p.from.id, p.into.id);
        assertEmpty(p.from);
        db.prepare(`DELETE FROM subsystems WHERE id = ?`).run(p.from.id);
        summary.merged++;
        summary.movedRows += moved;
        summary.droppedRows += dropped;
        console.log(`  merged ${p.from.name} into ${p.into.name} (${moved} rows moved, ${dropped} duplicates dropped)`);
      }

      // ADD
      for (const a of addPlan) {
        db.prepare(
          `INSERT INTO subsystems (id, name, slug, description, code, mass_share, budget_share)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(`sub_${nanoid(12)}`, a.name, slugify(a.name), `${a.name} subsystem.`, a.code, a.massShare, a.budgetShare);
        summary.added++;
        console.log(`  created ${a.name} (${a.code})`);
      }

      // DEMOTE
      const findSubteam = db.prepare(`SELECT id FROM subteams WHERE subsystem_id = ? AND name = ?`);
      const insSubteam = db.prepare(`INSERT INTO subteams (id, subsystem_id, name) VALUES (?, ?, ?)`);
      for (const p of demotePlan) {
        // The subteam has to exist under the parent before rows move, so each
        // row can be tagged with which area it came from.
        let subteamId = (findSubteam.get(p.parent.id, p.sub.name) as { id: string } | undefined)?.id;
        if (!subteamId) {
          subteamId = `stm_${nanoid(12)}`;
          insSubteam.run(subteamId, p.parent.id, p.sub.name);
          summary.subteams++;
        }

        // Tag rows BEFORE repointing, while they still identify the old subsystem.
        let tagged = 0;
        for (const r of refs) {
          if (r.column !== "subsystem_id") continue;
          if (!hasColumn(db, r.table, "subteam_id")) continue;
          tagged += db
            .prepare(`UPDATE ${r.table} SET subteam_id = ? WHERE subsystem_id = ? AND subteam_id IS NULL`)
            .run(subteamId, p.sub.id).changes;
        }

        const { moved, dropped } = repoint(p.sub.id, p.parent.id);
        assertEmpty(p.sub);
        db.prepare(`DELETE FROM subsystems WHERE id = ?`).run(p.sub.id);
        summary.demoted++;
        summary.movedRows += moved;
        summary.droppedRows += dropped;
        console.log(
          `  demoted ${p.sub.name} to a subteam of ${p.parent.name} (${moved} rows moved, ${tagged} tagged with the subteam, ${dropped} duplicates dropped)`
        );
      }
    })();
  } catch (e: any) {
    console.error(`\nFAILED: ${e.message}`);
    console.error(`Nothing was written — the whole migration is one transaction.`);
    db.close();
    process.exit(1);
  }

  const finalSubs = db.prepare(`SELECT name, code FROM subsystems ORDER BY name`).all() as Sub[];
  console.log(`\nmerged   : ${summary.merged}`);
  console.log(`added    : ${summary.added}`);
  console.log(`demoted  : ${summary.demoted} (${summary.subteams} subteams created)`);
  console.log(`rows moved / duplicates dropped : ${summary.movedRows} / ${summary.droppedRows}`);
  console.log(`\nsubsystems now (${finalSubs.length}):`);
  for (const s of finalSubs) console.log(`  ${(s.code ?? "   ").padEnd(4)} ${s.name}`);
  const codes = finalSubs.filter((s) => s.code).map((s) => s.code);
  const WORKBOOK = ["AER", "BRK", "CHS", "CVT", "ELE", "ERG", "MFG", "PWT", "STE", "SUS", "WHE"];
  const missing = WORKBOOK.filter((c) => !codes.includes(c));
  console.log(
    `\nworkbook tab coverage: ${WORKBOOK.length - missing.length}/${WORKBOOK.length}` +
      (missing.length ? ` — still missing ${missing.join(", ")}` : " — complete")
  );
  db.close();
}

main();

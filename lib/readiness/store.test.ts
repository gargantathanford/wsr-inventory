/**
 * The store, against a real database built from the real schema.
 *
 * gates.test.ts proves the rules. This proves the rules are actually reachable
 * through SQL — which is where the last two bugs in this feature lived (a
 * column called doc_type, not document_type, and rule_citations keyed on
 * entity_id rather than a part_id that does not exist). Neither was visible to
 * the type checker.
 */
import { test, describe, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "wsr-readiness-"));
fs.mkdirSync(path.join(WORK, "data"), { recursive: true });
fs.mkdirSync(path.join(WORK, "lib"), { recursive: true });
fs.copyFileSync(path.join(process.cwd(), "lib", "schema.sql"), path.join(WORK, "lib", "schema.sql"));
process.chdir(WORK);

const DB_FILE = path.join(WORK, "data", "wsr.db");
let store: typeof import("./store");

const CHIEF = { id: "u_chief", role: "CHIEF_ENGINEER" };
const LEAD = { id: "u_lead", role: "TEAM_LEADER" };
const OTHER_LEAD = { id: "u_lead2", role: "TEAM_LEADER" };
const MEMBER = { id: "u_member", role: "TEAM_MEMBER" };

function seed() {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(DB_FILE + s, { force: true });
  const db = new Database(DB_FILE);
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(WORK, "lib", "schema.sql"), "utf-8"));

  const u = db.prepare(`INSERT INTO users (id,name,email,password_hash,role) VALUES (?,?,?,'h',?)`);
  u.run("u_chief", "Chief", "chief@x.org", "CHIEF_ENGINEER");
  u.run("u_lead", "Lead", "lead@x.org", "TEAM_LEADER");
  u.run("u_lead2", "Other Lead", "lead2@x.org", "TEAM_LEADER");
  u.run("u_member", "Member", "member@x.org", "TEAM_MEMBER");

  const s = db.prepare(`INSERT INTO subsystems (id,name,slug,code) VALUES (?,?,?,?)`);
  s.run("s_pwt", "Powertrain", "powertrain", "PWT");
  s.run("s_chs", "Chassis", "chassis", "CHS");

  db.prepare(
    `INSERT INTO subsystem_members (id,subsystem_id,user_id,role_in_subsystem) VALUES (?,?,?,'LEADER')`
  ).run("sm1", "s_pwt", "u_lead");
  db.prepare(
    `INSERT INTO subsystem_members (id,subsystem_id,user_id,role_in_subsystem) VALUES (?,?,?,'LEADER')`
  ).run("sm2", "s_chs", "u_lead2");

  // Two Powertrain parts, both bought and in hand, designs frozen.
  // Masses included: a frozen part without one no longer satisfies the
  // Design frozen gate, which is the point of that change.
  const p = db.prepare(
    `INSERT INTO parts (id,part_name,subsystem_id,status,design_status,quantity_required,quantity_owned,supplier,weight_kg)
     VALUES (?,?,?,?,?,1,1,?,?)`
  );
  p.run("p1", "Engine", "s_pwt", "INSTALLED", "FROZEN", "Honda", 42);
  p.run("p2", "ECU", "s_pwt", "INSTALLED", "FROZEN", "Haltech", 1.2);

  db.close();
  (globalThis as any).__wsrDb = undefined;
}

before(async () => {
  store = await import("./store");
});
beforeEach(() => seed());

function addInterface(ref: string, priority: string, a: string, b: string) {
  const db = new Database(DB_FILE);
  db.pragma("foreign_keys = ON");
  db.prepare(
    `INSERT INTO interfaces (id,interface_ref,priority,subsystem_a_id,subsystem_b_id,status) VALUES (?,?,?,?,?,'OPEN')`
  ).run("i_" + ref, ref, priority, a, b);
  db.close();
  (globalThis as any).__wsrDb = undefined;
}

describe("readiness reads through real SQL", () => {
  test("a subsystem with parts but no sign-offs is 0%", () => {
    const r = store.getReadiness("s_pwt");
    assert.equal(r.pct, 0);
    assert.equal(r.passed, 0);
  });

  test("a subsystem with NO parts is 0%, not 100%", () => {
    assert.equal(store.getReadiness("s_chs").pct, 0);
  });

  test("every subsystem appears, including empty ones", () => {
    const all = store.getAllReadiness();
    assert.equal(all.length, 2);
    assert.deepEqual(all.map((a) => a.name).sort(), ["Chassis", "Powertrain"]);
  });

  test("keyed by code for the schematic", () => {
    const byCode = store.getReadinessByCode();
    assert.ok(byCode.PWT);
    assert.equal(byCode.PWT.name, "Powertrain");
  });

  test("the derived signals actually work off the part rows", () => {
    const r = store.getReadiness("s_pwt");
    // Both parts frozen, bought, in hand and installed — so once SCOPED is
    // closed these should be READY rather than OPEN.
    store.declarePartListComplete("s_pwt", LEAD, true);
    store.endorseGate("s_pwt", "SCOPED", LEAD, null, null);
    store.approveGate("s_pwt", "SCOPED", CHIEF, null);
    const after = store.getReadiness("s_pwt");
    assert.equal(after.gates.find((g) => g.gate === "DESIGN_FROZEN")!.state, "READY");
    assert.equal(r.gates.length, 8);
  });
});

describe("the endorse / approve chain, through the database", () => {
  test("a member cannot endorse", () => {
    const res = store.endorseGate("s_pwt", "SCOPED", MEMBER, null, null);
    assert.equal(res.ok, false);
    assert.match((res as any).reason, /Only the subsystem lead/);
  });

  test("a lead of another subsystem cannot endorse", () => {
    const res = store.endorseGate("s_pwt", "SCOPED", OTHER_LEAD, null, null);
    assert.equal(res.ok, false);
    assert.match((res as any).reason, /lead a different subsystem/);
  });

  test("the subsystem's lead can endorse, and it does not count yet", () => {
    store.declarePartListComplete("s_pwt", LEAD, true);
    assert.equal(store.endorseGate("s_pwt", "SCOPED", LEAD, null, null).ok, true);
    const r = store.getReadiness("s_pwt");
    assert.equal(r.gates.find((g) => g.gate === "SCOPED")!.state, "ENDORSED");
    assert.equal(r.pct, 0, "endorsement is not approval");
  });

  test("a lead cannot approve their own endorsement", () => {
    store.declarePartListComplete("s_pwt", LEAD, true);
    store.endorseGate("s_pwt", "SCOPED", LEAD, null, null);
    const res = store.approveGate("s_pwt", "SCOPED", LEAD, null);
    assert.equal(res.ok, false);
    assert.match((res as any).reason, /Only the Chief Engineer or an Admin/);
  });

  test("the Chief approves and it counts", () => {
    store.declarePartListComplete("s_pwt", LEAD, true);
    store.endorseGate("s_pwt", "SCOPED", LEAD, null, null);
    assert.equal(store.approveGate("s_pwt", "SCOPED", CHIEF, null).ok, true);
    const r = store.getReadiness("s_pwt");
    assert.equal(r.gates.find((g) => g.gate === "SCOPED")!.state, "PASSED");
    assert.equal(r.passed, 1);
    assert.equal(r.pct, Math.round((1 / 8) * 100));
  });

  test("the Chief cannot approve a gate nobody endorsed", () => {
    store.declarePartListComplete("s_pwt", LEAD, true);
    const res = store.approveGate("s_pwt", "SCOPED", CHIEF, null);
    assert.equal(res.ok, false);
    assert.match((res as any).reason, /not been endorsed/);
  });

  test("an approved gate cannot be quietly re-endorsed — it must be reopened", () => {
    store.declarePartListComplete("s_pwt", LEAD, true);
    store.endorseGate("s_pwt", "SCOPED", LEAD, null, null);
    store.approveGate("s_pwt", "SCOPED", CHIEF, null);

    // Endorsing over the top would change what was approved without the
    // approval visibly going away. Refused, with the remedy named.
    const res = store.endorseGate("s_pwt", "SCOPED", LEAD, "redone after adding parts", null);
    assert.equal(res.ok, false);
    assert.match((res as any).reason, /already been approved/);
    assert.equal(store.getReadiness("s_pwt").gates.find((g) => g.gate === "SCOPED")!.state, "PASSED");

    // The documented route: the Chief reopens, then it goes round again.
    assert.equal(store.reopenGate("s_pwt", "SCOPED", CHIEF, "part list grew after the intake review").ok, true);
    assert.equal(store.endorseGate("s_pwt", "SCOPED", LEAD, null, null).ok, true);
    assert.equal(store.getReadiness("s_pwt").gates.find((g) => g.gate === "SCOPED")!.state, "ENDORSED");
  });

  test("every action is written to the append-only log", () => {
    store.declarePartListComplete("s_pwt", LEAD, true);
    store.endorseGate("s_pwt", "SCOPED", LEAD, null, null);
    store.approveGate("s_pwt", "SCOPED", CHIEF, null);
    const db = new Database(DB_FILE, { readonly: true });
    const rows = db.prepare(`SELECT gate, action, actor_id FROM subsystem_gate_log ORDER BY at`).all() as any[];
    db.close();
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.action), ["ENDORSED", "APPROVED"]);
  });
});

describe("evidence is required where the gate says so", () => {
  function closeThrough(gate: string) {
    store.declarePartListComplete("s_pwt", LEAD, true);
    for (const g of ["SCOPED", "DESIGN_FROZEN"]) {
      store.endorseGate("s_pwt", g as any, LEAD, null, null);
      store.approveGate("s_pwt", g as any, CHIEF, null);
    }
    return store.endorseGate("s_pwt", gate as any, LEAD, null, null);
  }

  test("Rules checked cannot be endorsed with nothing attached and nothing said", () => {
    const res = closeThrough("RULES_CHECKED");
    assert.equal(res.ok, false);
    assert.match((res as any).reason, /needs evidence/);
    assert.match((res as any).reason, /design judges will ask about/);
  });

  test("a written note is accepted as evidence", () => {
    store.declarePartListComplete("s_pwt", LEAD, true);
    store.endorseGate("s_pwt", "SCOPED", LEAD, null, null);
    store.approveGate("s_pwt", "SCOPED", CHIEF, null);
    const res = store.endorseGate("s_pwt", "RULES_CHECKED", LEAD, "T.5.2.7 and T.3.1.8 checked against the scatter shield drawing", null);
    assert.equal(res.ok, true);
  });

  test("Procured needs no evidence — the part statuses already say it", () => {
    store.declarePartListComplete("s_pwt", LEAD, true);
    for (const g of ["SCOPED", "DESIGN_FROZEN"]) {
      store.endorseGate("s_pwt", g as any, LEAD, null, null);
      store.approveGate("s_pwt", g as any, CHIEF, null);
    }
    assert.equal(store.endorseGate("s_pwt", "PROCURED", LEAD, null, null).ok, true);
  });
});

describe("out of scope", () => {
  test("a lead cannot mark a gate out of scope", () => {
    const res = store.markNotApplicable("s_pwt", "TESTED", LEAD, "no track time this season");
    assert.equal(res.ok, false);
    assert.match((res as any).reason, /Only the Chief Engineer or an Admin/);
  });

  test("the Chief can, with a reason, and it leaves the denominator", () => {
    assert.equal(store.markNotApplicable("s_pwt", "TESTED", CHIEF, "no track time this season").ok, true);
    const r = store.getReadiness("s_pwt");
    assert.equal(r.applicable, 7);
    assert.match(r.gates.find((g) => g.gate === "TESTED")!.detail, /Out of scope: no track time/);
  });

  test("a one-word reason is refused", () => {
    const res = store.markNotApplicable("s_pwt", "TESTED", CHIEF, "nope");
    assert.equal(res.ok, false);
    assert.match((res as any).reason, /at least a few words/);
  });

  test("SCOPED can never be marked out of scope", () => {
    const res = store.markNotApplicable("s_pwt", "SCOPED", CHIEF, "we already know what we need");
    assert.equal(res.ok, false);
  });
});

describe("reopening", () => {
  test("a lead cannot reopen", () => {
    const res = store.reopenGate("s_pwt", "SCOPED", LEAD, "the part list grew a lot");
    assert.equal(res.ok, false);
  });

  test("the Chief can, and the gate goes back to being derived", () => {
    store.declarePartListComplete("s_pwt", LEAD, true);
    store.endorseGate("s_pwt", "SCOPED", LEAD, null, null);
    store.approveGate("s_pwt", "SCOPED", CHIEF, null);
    assert.equal(store.reopenGate("s_pwt", "SCOPED", CHIEF, "adding the intake parts we forgot").ok, true);
    const g = store.getReadiness("s_pwt").gates.find((x) => x.gate === "SCOPED")!;
    assert.equal(g.state, "READY", "back to derived, and the data still says the list is declared");
    assert.equal(g.approvedBy, null);
  });

  test("a reopen needs a reason and is logged", () => {
    const res = store.reopenGate("s_pwt", "SCOPED", CHIEF, "oops");
    assert.equal(res.ok, false);
    assert.match((res as any).reason, /goes in the gate history/);
  });
});

describe("interfaces need both leads", () => {
  test("one lead agreeing does not satisfy the gate", () => {
    addInterface("PWT_CHS_001", "P1", "s_pwt", "s_chs");
    assert.equal(store.agreeInterface("PWT_CHS_001", LEAD).ok, true);
    const r = store.getReadiness("s_pwt");
    const g = r.gates.find((x) => x.gate === "INTERFACES_AGREED")!;
    assert.notEqual(g.state, "READY");
    assert.equal(r.pct <= 84, true);
  });

  test("both leads agreeing flips the status to AGREED", () => {
    addInterface("PWT_CHS_001", "P1", "s_pwt", "s_chs");
    store.agreeInterface("PWT_CHS_001", LEAD);
    store.agreeInterface("PWT_CHS_001", OTHER_LEAD);
    const db = new Database(DB_FILE, { readonly: true });
    const row = db.prepare(`SELECT status, agreed_by_a, agreed_by_b FROM interfaces`).get() as any;
    db.close();
    assert.equal(row.status, "AGREED");
    assert.ok(row.agreed_by_a && row.agreed_by_b);
  });

  test("a lead on neither side cannot agree it", () => {
    addInterface("CHS_AER_001", "P2", "s_chs", null as any);
    const res = store.agreeInterface("CHS_AER_001", LEAD);
    assert.equal(res.ok, false);
    assert.match((res as any).reason, /leads of the two subsystems/);
  });

  test("the same lead agreeing twice does NOT count as both sides", () => {
    addInterface("PWT_CHS_001", "P1", "s_pwt", "s_chs");
    store.agreeInterface("PWT_CHS_001", LEAD);
    store.agreeInterface("PWT_CHS_001", LEAD);
    const db = new Database(DB_FILE, { readonly: true });
    const row = db.prepare(`SELECT status, agreed_by_a, agreed_by_b FROM interfaces`).get() as any;
    db.close();
    assert.equal(row.agreed_by_b, null, "a lead can only sign their own side");
    assert.notEqual(row.status, "AGREED");
  });

  test("an interface holds BOTH subsystems, via the ceiling", () => {
    // Checked through the ceiling rather than the gate detail, because an
    // unreached gate correctly reports its blocker instead. The ceiling applies
    // regardless of how far along the gates are — which is the point: a shared
    // joint is not one team's problem to reach in sequence.
    addInterface("PWT_CHS_001", "P1", "s_pwt", "s_chs");
    for (const id of ["s_pwt", "s_chs"]) {
      const facts = store.getReadiness(id);
      assert.ok(facts.pct <= 84, `${id} is held by the open joint`);
    }
    // And once a subsystem's own gates get far enough, it names the interface.
    store.declarePartListComplete("s_pwt", LEAD, true);
    store.endorseGate("s_pwt", "SCOPED", LEAD, null, null);
    store.approveGate("s_pwt", "SCOPED", CHIEF, null);
    store.endorseGate("s_pwt", "DESIGN_FROZEN", LEAD, null, null);
    store.approveGate("s_pwt", "DESIGN_FROZEN", CHIEF, null);
    const g = store.getReadiness("s_pwt").gates.find((x) => x.gate === "INTERFACES_AGREED")!;
    assert.match(g.detail, /PWT_CHS_001 with Chassis/);
  });
});

describe("the P1 ceiling, end to end", () => {
  function closeEveryGate() {
    store.declarePartListComplete("s_pwt", LEAD, true);
    // MANUFACTURED is settled FIRST. Installed waits on Procured AND
    // Manufactured, so leaving it unsettled blocks Installed and Tested — the
    // prerequisite chain working exactly as intended.
    store.markNotApplicable("s_pwt", "MANUFACTURED", CHIEF, "everything in this subsystem is bought");
    for (const g of ["SCOPED", "DESIGN_FROZEN", "RULES_CHECKED", "INTERFACES_AGREED", "PROCURED", "INSTALLED", "TESTED"]) {
      const e = store.endorseGate("s_pwt", g as any, LEAD, "checked", null);
      assert.equal(e.ok, true, `endorse ${g}: ${(e as any).reason ?? ""}`);
      const a = store.approveGate("s_pwt", g as any, CHIEF, null);
      assert.equal(a.ok, true, `approve ${g}: ${(a as any).reason ?? ""}`);
    }
  }

  test("an open P1 interface caps a fully signed subsystem at 84", () => {
    addInterface("PWT_CHS_001", "P1", "s_pwt", "s_chs");
    closeEveryGate();
    const r = store.getReadiness("s_pwt");
    assert.equal(r.gatePct, 100, "every gate is signed");
    assert.equal(r.pct, 84, "but the engine does not bolt to the chassis yet");
    assert.match(r.ceiling!.reason, /PWT_CHS_001 with Chassis/);
  });

  test("both leads agreeing lifts it to 100", () => {
    addInterface("PWT_CHS_001", "P1", "s_pwt", "s_chs");
    closeEveryGate();
    store.agreeInterface("PWT_CHS_001", LEAD);
    store.agreeInterface("PWT_CHS_001", OTHER_LEAD);
    const r = store.getReadiness("s_pwt");
    assert.equal(r.pct, 100);
    assert.equal(r.ceiling, null);
  });

  test("a P2 left open does not cap", () => {
    addInterface("PWT_CHS_009", "P2", "s_pwt", "s_chs");
    closeEveryGate();
    assert.equal(store.getReadiness("s_pwt").pct, 100);
  });
});

describe("staleness survives the round trip", () => {
  test("unfreezing a part after approval flags the gate, without unsigning it", () => {
    store.declarePartListComplete("s_pwt", LEAD, true);
    for (const g of ["SCOPED", "DESIGN_FROZEN"]) {
      store.endorseGate("s_pwt", g as any, LEAD, null, null);
      store.approveGate("s_pwt", g as any, CHIEF, null);
    }
    const db = new Database(DB_FILE);
    db.prepare(`UPDATE parts SET design_status = 'CANDIDATE' WHERE id = 'p1'`).run();
    db.close();
    (globalThis as any).__wsrDb = undefined;

    const r = store.getReadiness("s_pwt");
    const g = r.gates.find((x) => x.gate === "DESIGN_FROZEN")!;
    assert.equal(g.state, "PASSED");
    assert.equal(g.stale, true);
    assert.equal(r.stale.length, 1);
    assert.equal(r.next!.gate, "DESIGN_FROZEN", "the disagreement is the next thing to look at");
  });
});

describe("the interface register end to end", () => {
  test("raising one, then both leads agreeing, lifts the ceiling", () => {
    addInterface("PWT_CHS_001", "P1", "s_pwt", "s_chs");

    // Before: both subsystems are capped by the shared joint.
    assert.ok(store.getReadiness("s_pwt").pct <= 84);
    assert.ok(store.getReadiness("s_chs").pct <= 84);

    store.agreeInterface("PWT_CHS_001", LEAD);
    const half = store.getReadiness("s_pwt");
    assert.ok(half.pct <= 84, "one signature is not agreement");

    store.agreeInterface("PWT_CHS_001", OTHER_LEAD);
    assert.equal(store.getReadiness("s_pwt").ceiling, null);
    assert.equal(store.getReadiness("s_chs").ceiling, null);
  });

  test("a Chief can sign the outstanding side when a subsystem has no lead", () => {
    addInterface("PWT_CHS_002", "P2", "s_pwt", "s_chs");
    assert.equal(store.agreeInterface("PWT_CHS_002", LEAD).ok, true);
    // The Chief takes whichever side is still outstanding.
    assert.equal(store.agreeInterface("PWT_CHS_002", CHIEF).ok, true);
    const db = new Database(DB_FILE, { readonly: true });
    const row = db.prepare(`SELECT status, agreed_by_a, agreed_by_b FROM interfaces WHERE interface_ref='PWT_CHS_002'`).get() as any;
    db.close();
    assert.equal(row.status, "AGREED");
    assert.notEqual(row.agreed_by_a, row.agreed_by_b, "two different people signed");
  });

  test("a team member cannot agree anything", () => {
    addInterface("PWT_CHS_003", "P2", "s_pwt", "s_chs");
    const res = store.agreeInterface("PWT_CHS_003", { id: "u_member", role: "TEAM_MEMBER" });
    assert.equal(res.ok, false);
    assert.match((res as any).reason, /leads of the two subsystems/);
  });
});

describe("mass, through the database", () => {
  function setMass(id: string, cols: Record<string, number | null>) {
    const db = new Database(DB_FILE);
    const sets = Object.keys(cols).map((k) => `${k} = @${k}`).join(", ");
    db.prepare(`UPDATE parts SET ${sets} WHERE id = @id`).run({ ...cols, id });
    db.close();
    (globalThis as any).__wsrDb = undefined;
  }

  test("a frozen part with its mass cleared reopens the gate", () => {
    setMass("p1", { weight_kg: null, allocated_mass_kg: null });
    store.declarePartListComplete("s_pwt", LEAD, true);
    store.endorseGate("s_pwt", "SCOPED", LEAD, null, null);
    store.approveGate("s_pwt", "SCOPED", CHIEF, null);
    const g = store.getReadiness("s_pwt").gates.find((x) => x.gate === "DESIGN_FROZEN")!;
    assert.equal(g.state, "OPEN");
    assert.match(g.detail, /no mass recorded/);
    assert.match(g.detail, /Engine/, "names the part, not just a count");
  });

  test("excusing it closes the gap without inventing a number", () => {
    setMass("p1", { weight_kg: null, allocated_mass_kg: null, mass_not_applicable: 1 as any });
    store.declarePartListComplete("s_pwt", LEAD, true);
    store.endorseGate("s_pwt", "SCOPED", LEAD, null, null);
    store.approveGate("s_pwt", "SCOPED", CHIEF, null);
    assert.equal(store.getReadiness("s_pwt").gates.find((x) => x.gate === "DESIGN_FROZEN")!.state, "READY");
  });

  test("mass standing counts QUANTITY, unlike the gate", () => {
    // The gate asks whether a mass is known — per unit. The budget asks what
    // the car will weigh, so four uprights at 1.2 kg is 4.8 kg.
    const db = new Database(DB_FILE);
    db.prepare(
      `INSERT INTO parts (id,part_name,subsystem_id,status,quantity_required,quantity_owned,weight_kg)
       VALUES ('p3','Upright','s_pwt','OWNED',4,4,1.2)`
    ).run();
    db.close();
    (globalThis as any).__wsrDb = undefined;

    const m = store.getMassStanding("s_pwt");
    // 42 + 1.2 + (1.2 x 4)
    assert.ok(Math.abs(m.committedKg - 48) < 0.001, `got ${m.committedKg}`);
  });

  test("an excused part contributes nothing and is counted separately", () => {
    setMass("p2", { mass_not_applicable: 1 as any });
    const m = store.getMassStanding("s_pwt");
    assert.equal(m.excusedParts, 1);
    assert.ok(Math.abs(m.committedKg - 42) < 0.001);
  });

  test("a part with no mass at all is reported as unknown, not as zero", () => {
    setMass("p2", { weight_kg: null, allocated_mass_kg: null });
    const m = store.getMassStanding("s_pwt");
    assert.equal(m.unknownParts, 1);
  });

  test("the budget is editable by the lead and refuses nonsense", () => {
    assert.equal(store.setMassBudget("s_pwt", LEAD, 45).ok, true);
    assert.equal(store.getMassStanding("s_pwt").budgetKg, 45);

    const bad = store.setMassBudget("s_pwt", LEAD, -5);
    assert.equal(bad.ok, false);
    assert.match((bad as any).reason, /positive number of kilograms/);
  });

  test("a lead from another subsystem cannot change it", () => {
    const res = store.setMassBudget("s_pwt", OTHER_LEAD, 45);
    assert.equal(res.ok, false);
    assert.match((res as any).reason, /lead or the Chief Engineer/);
  });

  test("over budget is reported, and binds once the gates get high enough", () => {
    store.setMassBudget("s_pwt", CHIEF, 10);
    const m = store.getMassStanding("s_pwt");
    assert.ok(m.overBy !== null && m.overBy > 30, `43.2 kg against 10 kg, got overBy ${m.overBy}`);

    // The ceiling is deliberately NOT reported while the gates are below it —
    // announcing a cap of 92% to a subsystem sitting at 0% is noise. Close the
    // gates and it starts binding.
    assert.equal(store.getReadiness("s_pwt").ceiling, null, "nothing signed yet, so the cap is not the story");

    store.declarePartListComplete("s_pwt", LEAD, true);
    for (const g of ["SCOPED", "DESIGN_FROZEN", "RULES_CHECKED", "PROCURED"]) {
      store.endorseGate("s_pwt", g as any, LEAD, "checked", null);
      store.approveGate("s_pwt", g as any, CHIEF, null);
    }
    store.markNotApplicable("s_pwt", "MANUFACTURED", CHIEF, "everything in this subsystem is bought");
    store.markNotApplicable("s_pwt", "INTERFACES_AGREED", CHIEF, "no interfaces recorded for this subsystem");
    for (const g of ["INSTALLED", "TESTED"]) {
      store.endorseGate("s_pwt", g as any, LEAD, "checked", null);
      store.approveGate("s_pwt", g as any, CHIEF, null);
    }

    const r = store.getReadiness("s_pwt");
    assert.ok(r.gatePct > 92, `gates alone reach ${r.gatePct}%`);
    assert.equal(r.pct, 92, "capped by the mass overage");
    assert.match(r.ceiling!.reason, /against a 10\.0 kg budget/);
  });
});

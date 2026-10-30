/**
 * Store tests — these run against a REAL SQLite database built from the real
 * schema, not a mock. The pure modules are tested in rules.test.ts; what
 * matters here is that the database enforces what the pure rules promise, and
 * that nothing in the wiring loses or duplicates points.
 */
import { test, describe, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";

// lib/db.ts resolves its path from process.cwd(); point it at a scratch copy of
// the project so the real data directory is never touched.
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "wsr-xp-"));
fs.mkdirSync(path.join(WORK, "data"), { recursive: true });
fs.mkdirSync(path.join(WORK, "lib"), { recursive: true });
fs.copyFileSync(path.join(process.cwd(), "lib", "schema.sql"), path.join(WORK, "lib", "schema.sql"));
process.chdir(WORK);

const DB_FILE = path.join(WORK, "data", "wsr.db");

let store: typeof import("./store");

function seed() {
  if (fs.existsSync(DB_FILE)) for (const s of ["", "-wal", "-shm"]) fs.rmSync(DB_FILE + s, { force: true });
  const db = new Database(DB_FILE);
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(WORK, "lib", "schema.sql"), "utf-8"));
  db.prepare(`INSERT INTO subsystems (id,name,slug,code) VALUES ('sub_pwt','Powertrain','powertrain','PWT')`).run();
  db.prepare(`INSERT INTO subsystems (id,name,slug,code) VALUES ('sub_ele','Electrical','electrical','ELE')`).run();
  for (const [id, name] of [
    ["u_lead", "Umar"],
    ["u_member", "Harper"],
    ["u_admin", "Jonathan"]
  ]) {
    db.prepare(`INSERT INTO users (id,name,email,password_hash,role) VALUES (?,?,?,?,'TEAM_MEMBER')`).run(
      id,
      name,
      `${id}@example.org`,
      "hash"
    );
  }
  db.close();
  // Drop the cached connection so the next getDb() opens the fresh file.
  (globalThis as any).__wsrDb = undefined;
}

before(async () => {
  store = await import("./store");
});

beforeEach(() => seed());

describe("award", () => {
  test("writes an AWARDED event and derives the total", () => {
    const r = store.award({
      userId: "u_member",
      kind: "po.reconciled",
      sourceType: "po",
      sourceId: "WSR-PO-2026-0142",
      transition: "reconciled",
      at: "2026-10-30T15:00:00Z",
      subsystemId: "sub_pwt"
    });
    assert.equal(r.ok, true);
    assert.equal(store.getTotals("u_member").total, 25);
  });

  test("the same transition twice pays once, and does not throw", () => {
    const req = {
      userId: "u_member",
      kind: "po.reconciled",
      sourceType: "po",
      sourceId: "P1",
      transition: "reconciled",
      at: "2026-10-30T15:00:00Z"
    };
    assert.equal(store.award(req).ok, true);
    const second = store.award(req);
    assert.equal(second.ok, false);
    assert.ok(!second.ok && second.reason === "duplicate");
    assert.equal(store.getTotals("u_member").total, 25, "still 25, not 50");
  });

  test("self-verified work pays 40% and is flagged", () => {
    store.award({
      userId: "u_member",
      kind: "task.completed",
      sourceType: "task",
      sourceId: "T1",
      transition: "completed",
      at: "2026-10-30T15:00:00Z",
      selfVerified: true
    });
    const t = store.getTotals("u_member");
    assert.equal(t.total, 8);
    assert.equal(t.selfVerifiedCount, 1);
  });

  test("the daily cap holds across many awards", () => {
    for (let i = 0; i < 8; i++) {
      store.award({
        userId: "u_member",
        kind: "po.reconciled",
        sourceType: "po",
        sourceId: `P${i}`,
        transition: "reconciled",
        at: "2026-10-30T15:00:00Z"
      });
    }
    assert.equal(store.getTotals("u_member").total, 100, "8 x 25 trimmed to the 100 cap");
  });

  test("approval-tier awards land PENDING and are not in the total", () => {
    store.award({
      userId: "u_member",
      kind: "part.designFrozen",
      sourceType: "part",
      sourceId: "PWT-001",
      transition: "frozen",
      at: "2026-10-30T15:00:00Z",
      subsystemId: "sub_pwt"
    });
    const t = store.getTotals("u_member");
    assert.equal(t.total, 0);
    assert.equal(t.pending, 40);
  });
});

describe("approval", () => {
  const freeze = () =>
    store.award({
      userId: "u_member",
      kind: "part.designFrozen",
      sourceType: "part",
      sourceId: "PWT-001",
      transition: "frozen",
      at: "2026-10-30T15:00:00Z",
      subsystemId: "sub_pwt"
    });

  test("approving moves pending into the total", () => {
    freeze();
    assert.equal(store.approve("part:PWT-001:frozen", "u_lead"), true);
    const t = store.getTotals("u_member");
    assert.equal(t.total, 40);
    assert.equal(t.pending, 0);
  });

  test("you cannot approve your own award", () => {
    freeze();
    assert.equal(store.approve("part:PWT-001:frozen", "u_member"), false, "self-approval must be refused");
    assert.equal(store.getTotals("u_member").total, 0);
  });

  test("approving twice is a no-op", () => {
    freeze();
    assert.equal(store.approve("part:PWT-001:frozen", "u_lead"), true);
    assert.equal(store.approve("part:PWT-001:frozen", "u_lead"), false);
    assert.equal(store.getTotals("u_member").total, 40);
  });

  test("rejecting pays nothing and keeps the record", () => {
    freeze();
    assert.equal(store.rejectAward("part:PWT-001:frozen", "u_lead", "Criterion is not testable"), true);
    const t = store.getTotals("u_member");
    assert.equal(t.total, 0);
    assert.equal(t.pending, 0);
    assert.equal(store.getUserEvents("u_member").length, 1, "the row survives as the record");
  });

  test("the pending queue excludes your own", () => {
    freeze();
    assert.equal(store.getPendingApprovals("u_member").length, 0);
    assert.equal(store.getPendingApprovals("u_lead").length, 1);
  });
});

describe("reversal", () => {
  test("a reversed award leaves zero but stays visible", () => {
    store.award({
      userId: "u_member",
      kind: "task.completed",
      sourceType: "task",
      sourceId: "T1",
      transition: "completed",
      at: "2026-10-30T15:00:00Z"
    });
    assert.equal(store.getTotals("u_member").total, 20);

    const rev = store.reverse("task", "T1", "completed", "Task reopened");
    assert.ok(rev);
    const t = store.getTotals("u_member");
    assert.equal(t.total, 0);
    assert.equal(t.reversedCount, 1);
    assert.equal(store.getUserEvents("u_member").length, 2, "original plus compensating row");
  });

  test("reversing twice does nothing the second time", () => {
    store.award({
      userId: "u_member",
      kind: "task.completed",
      sourceType: "task",
      sourceId: "T1",
      transition: "completed",
      at: "2026-10-30T15:00:00Z"
    });
    assert.ok(store.reverse("task", "T1", "completed", "reopened"));
    assert.equal(store.reverse("task", "T1", "completed", "reopened again"), null);
    assert.equal(store.getUserEvents("u_member").length, 2);
  });

  test("reversing something that never happened is null, not an error", () => {
    assert.equal(store.reverse("task", "NOPE", "completed", "x"), null);
  });

  test("every stored points value is non-negative", () => {
    store.award({
      userId: "u_member",
      kind: "po.reconciled",
      sourceType: "po",
      sourceId: "P1",
      transition: "reconciled",
      at: "2026-10-30T15:00:00Z"
    });
    store.reverse("po", "P1", "reconciled", "un-reconciled");
    const db = new Database(DB_FILE, { readonly: true });
    const min = db.prepare(`SELECT MIN(points) m FROM xp_events`).get() as { m: number };
    db.close();
    assert.ok(min.m >= 0, "the database must never hold negative points");
  });
});

describe("subsystem rollup", () => {
  test("totals by subsystem, excluding reversed", () => {
    store.award({
      userId: "u_member",
      kind: "po.reconciled",
      sourceType: "po",
      sourceId: "P1",
      transition: "reconciled",
      at: "2026-10-30T15:00:00Z",
      subsystemId: "sub_pwt"
    });
    store.award({
      userId: "u_lead",
      kind: "task.completed",
      sourceType: "task",
      sourceId: "T1",
      transition: "completed",
      at: "2026-10-30T15:00:00Z",
      subsystemId: "sub_ele"
    });
    store.award({
      userId: "u_lead",
      kind: "task.completed",
      sourceType: "task",
      sourceId: "T2",
      transition: "completed",
      at: "2026-10-30T15:00:00Z",
      subsystemId: "sub_ele"
    });
    store.reverse("task", "T2", "completed", "reopened");

    const rows = store.getSubsystemXp();
    const by = Object.fromEntries(rows.map((r) => [r.code, r.points]));
    assert.equal(by.PWT, 25);
    assert.equal(by.ELE, 20, "the reversed 20 must be excluded");
  });
});

describe("streak", () => {
  test("counts days with qualifying events in the team timezone", () => {
    // 04:30 UTC is the previous evening in Chicago — the boundary case.
    for (const [i, at] of ["2026-10-29T20:00:00Z", "2026-10-30T20:00:00Z", "2026-10-31T04:30:00Z"].entries()) {
      store.award({
        userId: "u_member",
        kind: "po.reconciled",
        sourceType: "po",
        sourceId: `P${i}`,
        transition: "reconciled",
        at
      });
    }
    const s = store.getStreak("u_member", "America/Chicago");
    // 10-29, 10-30 (twice: 20:00 and the 04:30 UTC event which is 10-30 local)
    assert.deepEqual(s.activeDays, ["2026-10-29", "2026-10-30"]);
  });

  test("self-verified events do not earn a streak day", () => {
    store.award({
      userId: "u_member",
      kind: "task.completed",
      sourceType: "task",
      sourceId: "T1",
      transition: "completed",
      at: "2026-10-30T20:00:00Z",
      selfVerified: true
    });
    assert.equal(store.getStreak("u_member", "America/Chicago").activeDays.length, 0);
  });

  test("a reversed event does not earn a streak day", () => {
    store.award({
      userId: "u_member",
      kind: "task.completed",
      sourceType: "task",
      sourceId: "T1",
      transition: "completed",
      at: "2026-10-30T20:00:00Z"
    });
    store.reverse("task", "T1", "completed", "reopened");
    assert.equal(store.getStreak("u_member", "America/Chicago").activeDays.length, 0);
  });

  test("an hour of settled shop time earns a day with no dashboard activity", () => {
    const db = new Database(DB_FILE);
    db.prepare(
      `INSERT INTO shop_sessions (id,user_id,opened_at,closed_at,open_factors,close_method,
         verified_minutes,unverified_minutes,state)
       VALUES ('shop1','u_member','2026-10-30T18:00:00Z','2026-10-30T20:00:00Z','["geofence","doorCode"]',
         'geofence',120,0,'settled')`
    ).run();
    db.close();
    (globalThis as any).__wsrDb = undefined;
    const s = store.getStreak("u_member", "America/Chicago");
    assert.deepEqual(s.activeDays, ["2026-10-30"], "mill work counts without touching the dashboard");
  });

  test("a short session does not earn a day", () => {
    const db = new Database(DB_FILE);
    db.prepare(
      `INSERT INTO shop_sessions (id,user_id,opened_at,closed_at,open_factors,close_method,
         verified_minutes,unverified_minutes,state)
       VALUES ('shop1','u_member','2026-10-30T18:00:00Z','2026-10-30T18:40:00Z','["geofence","doorCode"]',
         'geofence',40,0,'settled')`
    ).run();
    db.close();
    (globalThis as any).__wsrDb = undefined;
    assert.equal(store.getStreak("u_member", "America/Chicago").activeDays.length, 0);
  });
});

describe("shop settlement through the store", () => {
  function session(over: Record<string, unknown> = {}) {
    const db = new Database(DB_FILE);
    const row = {
      id: "shop1",
      user_id: "u_member",
      opened_at: "2026-10-30T16:00:00Z",
      closed_at: "2026-10-30T18:00:00Z",
      open_factors: '["geofence","doorCode"]',
      close_method: "geofence",
      verified_minutes: 120,
      unverified_minutes: 0,
      state: "settled",
      ...over
    };
    db.prepare(
      `INSERT INTO shop_sessions (id,user_id,opened_at,closed_at,open_factors,close_method,
         verified_minutes,unverified_minutes,state)
       VALUES (@id,@user_id,@opened_at,@closed_at,@open_factors,@close_method,
         @verified_minutes,@unverified_minutes,@state)`
    ).run(row);
    db.close();
    (globalThis as any).__wsrDb = undefined;
  }

  test("hours are recorded but presence XP is withheld in v1", () => {
    session();
    const r = store.settleSession("shop1", "America/Chicago");
    assert.equal(r?.points, 0, "PRESENCE_XP_ENABLED is false");
    assert.match(r!.reason, /120 minutes recorded/);
    assert.equal(store.getTotals("u_member").total, 0);
  });

  test("an open session awards nothing", () => {
    session({ state: "open", closed_at: null });
    assert.equal(store.settleSession("shop1", "America/Chicago")?.points, 0);
    assert.equal(store.getTotals("u_member").total, 0);
  });

  test("a voided session awards nothing", () => {
    session({ state: "void", close_method: "auto" });
    assert.equal(store.settleSession("shop1", "America/Chicago")?.points, 0);
    assert.equal(store.getTotals("u_member").total, 0);
  });

  test("a long session still records every minute", () => {
    session({ verified_minutes: 600 });
    const r = store.settleSession("shop1", "America/Chicago");
    assert.equal(r?.points, 0);
    const row = store.getSessions("u_member")[0];
    assert.equal(row.verified_minutes, 600, "the timesheet keeps the real hours");
  });
});

describe("deferred first-time-right", () => {
  function completedTask(reviewedAt: string, returnedAfter?: string) {
    const db = new Database(DB_FILE);
    db.prepare(
      `INSERT INTO tasks (id,title,status,submitted_by,reviewed_at,subsystem_id,created_by)
       VALUES ('T1','Degrease engine','COMPLETED','u_member',?, 'sub_pwt','u_lead')`
    ).run(reviewedAt);
    if (returnedAfter) {
      db.prepare(
        `INSERT INTO activity_log (id,user_id,action,entity_type,entity_id,details,created_at)
         VALUES ('log1','u_lead','RETURN','TASK','T1','needs rework',?)`
      ).run(returnedAfter);
    }
    db.close();
    (globalThis as any).__wsrDb = undefined;
  }

  test("does not pay before 7 days", () => {
    completedTask(new Date(Date.now() - 3 * 86_400_000).toISOString());
    assert.equal(store.settleDeferred("u_member"), 0);
    assert.equal(store.getTotals("u_member").total, 0);
  });

  test("pays after 7 days when never returned", () => {
    completedTask(new Date(Date.now() - 8 * 86_400_000).toISOString());
    assert.equal(store.settleDeferred("u_member"), 1);
    assert.equal(store.getTotals("u_member").total, 10);
  });

  test("never pays if the task was returned after approval", () => {
    const closed = new Date(Date.now() - 8 * 86_400_000).toISOString();
    const returned = new Date(Date.now() - 6 * 86_400_000).toISOString();
    completedTask(closed, returned);
    assert.equal(store.settleDeferred("u_member"), 0);
    assert.equal(store.getTotals("u_member").total, 0);
  });

  test("is idempotent on repeated reads", () => {
    completedTask(new Date(Date.now() - 8 * 86_400_000).toISOString());
    store.settleDeferred("u_member");
    store.settleDeferred("u_member");
    store.settleDeferred("u_member");
    assert.equal(store.getTotals("u_member").total, 10, "paid once however often the ledger is read");
  });
});


describe("check-in and check-out", () => {
  test("opening then closing records the elapsed minutes", () => {
    const opened = store.openSession("u_member", "2026-10-30T18:00:00Z");
    assert.equal(opened.state, "open");
    assert.equal(store.getOpenSession("u_member")?.id, opened.id);

    const closed = store.closeSession("u_member", "2026-10-30T20:30:00Z", "America/Chicago");
    assert.ok(closed);
    assert.equal(closed!.session.state, "settled");
    assert.equal(closed!.session.unverified_minutes, 150);
    assert.equal(store.getOpenSession("u_member"), undefined);
  });

  test("no verification factors are recorded in v1", () => {
    const s = store.openSession("u_member", "2026-10-30T18:00:00Z");
    assert.equal(s.open_factors, "[]", "the column exists but stays empty until verification lands");
  });

  test("opening a second session voids the first", () => {
    const first = store.openSession("u_member", "2026-10-30T14:00:00Z");
    const second = store.openSession("u_member", "2026-10-30T18:00:00Z");
    assert.notEqual(first.id, second.id);
    const rows = store.getSessions("u_member");
    const old = rows.find((r) => r.id === first.id)!;
    assert.equal(old.state, "void");
    assert.match(old.correction_note!, /newer session/);
    assert.equal(store.getOpenSession("u_member")?.id, second.id);
  });

  test("closing with nothing open is null, not an error", () => {
    assert.equal(store.closeSession("u_member", "2026-10-30T20:00:00Z", "America/Chicago"), null);
  });

  test("a session left open overnight voids on close", () => {
    store.openSession("u_member", "2026-10-31T01:00:00Z"); // 20:00 local on the 30th
    const closed = store.closeSession("u_member", "2026-10-31T16:00:00Z", "America/Chicago"); // 11:00 local
    assert.equal(closed!.session.state, "void");
    assert.match(closed!.session.correction_note!, /voided/i);
    assert.equal(closed!.points, 0);
  });

  test("the sweep voids stale sessions and leaves fresh ones alone", () => {
    store.openSession("u_member", "2026-10-31T01:00:00Z"); // overnight
    store.openSession("u_lead", "2026-10-31T15:00:00Z"); // same local day as the check below
    const voided = store.voidStaleSessions("2026-10-31T16:00:00Z", "America/Chicago");
    assert.equal(voided, 1);
    assert.equal(store.getOpenSession("u_member"), undefined, "stale one closed");
    assert.ok(store.getOpenSession("u_lead"), "fresh one untouched");
  });

  test("the sweep is idempotent", () => {
    store.openSession("u_member", "2026-10-31T01:00:00Z");
    assert.equal(store.voidStaleSessions("2026-10-31T16:00:00Z", "America/Chicago"), 1);
    assert.equal(store.voidStaleSessions("2026-10-31T16:00:00Z", "America/Chicago"), 0);
  });

  test("team hours roll up settled time and count voids separately", () => {
    store.openSession("u_member", "2026-10-30T18:00:00Z");
    store.closeSession("u_member", "2026-10-30T20:00:00Z", "America/Chicago");
    store.openSession("u_member", "2026-10-31T01:00:00Z"); // will void
    store.closeSession("u_member", "2026-10-31T16:00:00Z", "America/Chicago");

    const rows = store.getTeamHours("2026-10-01T00:00:00Z");
    const mine = rows.find((r) => r.id === "u_member")!;
    assert.equal(mine.minutes, 120, "only the settled session counts toward hours");
    assert.equal(mine.voided, 1);
    assert.equal(mine.sessions, 2);
  });
});

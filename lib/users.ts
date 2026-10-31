import { getDb } from "@/lib/db";

/**
 * What a user is attached to, and whether they can be deleted at all.
 *
 * THE PROBLEM. 35 columns reference users(id) with no ON DELETE clause, so
 * SQLite refuses to delete anyone who has sent a message, entered a part or
 * signed a gate. That refusal is correct — cascading would silently erase their
 * parts, their sign-offs and the log of what they did, which is the opposite of
 * what an audit trail is for. But the error escaped the route as a bodiless 500
 * and the UI said "Could not delete user", so the only signal was that
 * something was broken.
 *
 * So: a never-used account (a mistyped invite, a test row) deletes cleanly. An
 * account that has done anything cannot be deleted, and the refusal says what
 * it is attached to and that deactivating does the job instead. `is_active` is
 * already honoured by login, getSession, every picker and presence — the
 * machinery was all there, nothing pointed at it.
 *
 * Discovered through PRAGMA foreign_key_list rather than a hardcoded list, so a
 * table added later is covered without anyone remembering to update this.
 */

/** Columns the audit trail is made of. Counted, but reported separately. */
const AUDIT_TABLES = new Set(["activity_log", "subsystem_gate_log", "xp_events", "message_reads"]);

/** Human names for the tables a person is most likely to recognise. */
const TABLE_LABEL: Record<string, string> = {
  parts: "part",
  tasks: "task",
  task_assignees: "task assignment",
  messages: "message",
  documents: "document",
  procedures: "procedure",
  purchase_requests: "purchase request",
  purchase_orders: "purchase order",
  po_receipts: "receipt",
  calendar_events: "calendar event",
  subsystem_members: "subsystem membership",
  subsystem_gates: "gate sign-off",
  interfaces: "interface agreement",
  tools: "tool record",
  shop_sessions: "shop session",
  rule_citations: "rule citation",
  account_setup_tokens: "setup link"
};

export interface UserReference {
  table: string;
  column: string;
  count: number;
  label: string;
  isAudit: boolean;
}

/**
 * Every row in the database that points at this user.
 *
 * Skips columns declared ON DELETE CASCADE or SET NULL — those resolve
 * themselves and should not block a delete or be reported as an obstacle.
 */
export function getUserReferences(userId: string): UserReference[] {
  const db = getDb();
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
    .all() as Array<{ name: string }>;

  const out: UserReference[] = [];

  for (const { name: table } of tables) {
    const fks = db.prepare(`PRAGMA foreign_key_list(${table})`).all() as Array<{
      table: string;
      from: string;
      to: string;
      on_delete: string;
    }>;

    for (const fk of fks) {
      if (fk.table !== "users") continue;
      // CASCADE and SET NULL clean up on their own; they are not obstacles.
      const onDelete = (fk.on_delete || "").toUpperCase();
      if (onDelete === "CASCADE" || onDelete === "SET NULL") continue;

      const row = db
        .prepare(`SELECT COUNT(*) AS c FROM "${table}" WHERE "${fk.from}" = ?`)
        .get(userId) as { c: number };
      if (row.c > 0) {
        out.push({
          table,
          column: fk.from,
          count: row.c,
          label: TABLE_LABEL[table] ?? table.replace(/_/g, " "),
          isAudit: AUDIT_TABLES.has(table)
        });
      }
    }
  }

  return out.sort((a, b) => b.count - a.count);
}

export interface DeletabilityVerdict {
  deletable: boolean;
  /** Null when deletable. Otherwise the sentence to show the person. */
  reason: string | null;
  references: UserReference[];
}

/**
 * Can this account be removed outright, and if not, what to say.
 *
 * The message names the two or three biggest attachments rather than all of
 * them: "12 parts and 4 messages" is actionable, a list of nine table names is
 * not.
 */
export function canDeleteUser(userId: string): DeletabilityVerdict {
  const references = getUserReferences(userId);
  if (references.length === 0) {
    return { deletable: true, reason: null, references };
  }

  const real = references.filter((r) => !r.isAudit);
  const audit = references.filter((r) => r.isAudit);
  const describe = (rs: UserReference[]) =>
    rs
      .slice(0, 3)
      .map((r) => `${r.count} ${r.label}${r.count === 1 ? "" : "s"}`)
      .join(", ");

  const parts: string[] = [];
  if (real.length) parts.push(describe(real) + (real.length > 3 ? ", and more" : ""));
  if (audit.length) parts.push(`${audit.reduce((s, r) => s + r.count, 0)} audit-log entries`);

  return {
    deletable: false,
    references,
    reason:
      `This account is attached to ${parts.join(" plus ")}. ` +
      `Deleting it would erase that work and who did it, so it cannot be removed. ` +
      `Deactivate the account instead — they will not be able to sign in, they disappear from every ` +
      `picker, and everything they did stays attributed to them.`
  };
}

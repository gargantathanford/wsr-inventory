import { getDb } from "./db";

/**
 * Generates the next sequential PO number for the given year, e.g. WSR-PO-2026-0001.
 *
 * Concurrency note: better-sqlite3 is synchronous and Node.js runs this process
 * single-threaded, so there is no interleaving between the SELECT and INSERT below
 * within one process — this is safe against the "two users click Create at the same
 * instant" race as long as the app runs as a single Node process (true of the
 * Raspberry Pi / single-VM deployment this app targets). It would NOT be safe if
 * scaled to multiple server processes/instances without moving this into a real
 * transaction against a shared database with a UNIQUE constraint doing the final
 * enforcement — which is exactly why po_number also carries a UNIQUE constraint in
 * the schema as a hard backstop, not just this counter.
 */
export function generatePoNumber(): string {
  const db = getDb();
  const year = new Date().getFullYear();
  const prefix = `WSR-PO-${year}-`;
  const row = db
    .prepare(
      `SELECT po_number FROM purchase_orders WHERE po_number LIKE ? ORDER BY po_number DESC LIMIT 1`
    )
    .get(`${prefix}%`) as { po_number: string } | undefined;

  let next = 1;
  if (row) {
    const lastSeq = parseInt(row.po_number.slice(prefix.length), 10);
    if (!Number.isNaN(lastSeq)) next = lastSeq + 1;
  }
  return `${prefix}${String(next).padStart(4, "0")}`;
}

export function generateRequestNumber(): string {
  const db = getDb();
  const year = new Date().getFullYear();
  const prefix = `WSR-PR-${year}-`;
  const row = db
    .prepare(
      `SELECT request_number FROM purchase_requests WHERE request_number LIKE ? ORDER BY request_number DESC LIMIT 1`
    )
    .get(`${prefix}%`) as { request_number: string } | undefined;

  let next = 1;
  if (row) {
    const lastSeq = parseInt(row.request_number.slice(prefix.length), 10);
    if (!Number.isNaN(lastSeq)) next = lastSeq + 1;
  }
  return `${prefix}${String(next).padStart(4, "0")}`;
}

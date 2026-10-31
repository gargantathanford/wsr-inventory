import { getDb } from "@/lib/db";

/**
 * Reading the interface register.
 *
 * Kept out of the page so the dashboard, the subsystem page and the register
 * itself all answer the same question the same way.
 */

export interface InterfaceRow {
  id: string;
  interface_ref: string;
  priority: "P1" | "P2" | "P3";
  status: string;
  description: string | null;
  driver: string | null;
  due_date: string | null;
  subsystem_a_id: string | null;
  subsystem_b_id: string | null;
  subsystem_a_name: string | null;
  subsystem_b_name: string | null;
  agreed_by_a: string | null;
  agreed_by_b: string | null;
  agreed_a_name: string | null;
  agreed_b_name: string | null;
  owner_name_resolved: string | null;
  owner_name: string | null;
}

const BASE = `
  SELECT i.*,
         sa.name AS subsystem_a_name, sb.name AS subsystem_b_name,
         ua.name AS agreed_a_name, ub.name AS agreed_b_name,
         uo.name AS owner_name_resolved
    FROM interfaces i
    LEFT JOIN subsystems sa ON sa.id = i.subsystem_a_id
    LEFT JOIN subsystems sb ON sb.id = i.subsystem_b_id
    LEFT JOIN users ua ON ua.id = i.agreed_by_a
    LEFT JOIN users ub ON ub.id = i.agreed_by_b
    LEFT JOIN users uo ON uo.id = i.owner_user_id
`;

/** Unagreed criticals first — that is the list anyone opening this wants. */
const ORDER = `
  ORDER BY
    CASE WHEN i.priority = 'P1' AND (i.agreed_by_a IS NULL OR i.agreed_by_b IS NULL) THEN 0
         WHEN i.agreed_by_a IS NULL OR i.agreed_by_b IS NULL THEN 1
         ELSE 2 END,
    i.priority, i.interface_ref
`;

export function getAllInterfaces(): InterfaceRow[] {
  return getDb().prepare(`${BASE} ${ORDER}`).all() as InterfaceRow[];
}

/** Every interface one subsystem is party to, on either side. */
export function getInterfacesFor(subsystemId: string): InterfaceRow[] {
  return getDb()
    .prepare(`${BASE} WHERE i.subsystem_a_id = ? OR i.subsystem_b_id = ? ${ORDER}`)
    .all(subsystemId, subsystemId) as InterfaceRow[];
}

export function interfaceStats() {
  const all = getAllInterfaces();
  const open = all.filter((i) => !(i.agreed_by_a && i.agreed_by_b));
  return {
    total: all.length,
    agreed: all.length - open.length,
    open: open.length,
    criticalOpen: open.filter((i) => i.priority === "P1").length,
    /** One side has signed and is waiting on the other. The actionable middle. */
    halfAgreed: all.filter((i) => !!i.agreed_by_a !== !!i.agreed_by_b).length
  };
}

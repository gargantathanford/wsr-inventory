import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";
import { getSession } from "@/lib/auth";
import { invalid, dbError, optionalRef, optionalText } from "@/lib/apiValidation";

/**
 * The interface register.
 *
 *   GET  /api/interfaces            -> every interface, both sides resolved
 *   POST /api/interfaces            -> raise one
 *
 * An interface is where two subsystems meet. It is the one record in this app
 * that deliberately belongs to nobody: both sides see it, both sides are held
 * by it, and it only closes when both leads agree. That is the whole point —
 * the failure it exists to prevent is each team assuming the other owns the
 * joint.
 */

export async function GET(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const db = getDb();

  const where: string[] = [];
  const args: any[] = [];
  const subsystem = searchParams.get("subsystem");
  if (subsystem) {
    where.push("(i.subsystem_a_id = ? OR i.subsystem_b_id = ?)");
    args.push(subsystem, subsystem);
  }
  const status = searchParams.get("status");
  if (status) {
    where.push("i.status = ?");
    args.push(status);
  }

  const rows = db
    .prepare(
      `SELECT i.*,
              sa.name AS subsystem_a_name, sa.slug AS subsystem_a_slug,
              sb.name AS subsystem_b_name, sb.slug AS subsystem_b_slug,
              ua.name AS agreed_a_name, ub.name AS agreed_b_name,
              uo.name AS owner_name_resolved
         FROM interfaces i
         LEFT JOIN subsystems sa ON sa.id = i.subsystem_a_id
         LEFT JOIN subsystems sb ON sb.id = i.subsystem_b_id
         LEFT JOIN users ua ON ua.id = i.agreed_by_a
         LEFT JOIN users ub ON ub.id = i.agreed_by_b
         LEFT JOIN users uo ON uo.id = i.owner_user_id
        ${where.length ? "WHERE " + where.join(" AND ") : ""}
        ORDER BY
          -- Critical and unagreed first: that is the list anyone opening this
          -- page actually wants, and sorting by reference number buries it.
          CASE WHEN i.priority = 'P1' AND (i.agreed_by_a IS NULL OR i.agreed_by_b IS NULL) THEN 0
               WHEN i.agreed_by_a IS NULL OR i.agreed_by_b IS NULL THEN 1
               ELSE 2 END,
          i.priority, i.interface_ref`
    )
    .all(...args);

  return NextResponse.json({ interfaces: rows });
}

const InterfaceInput = z.object({
  interface_ref: z.string().min(1).max(40).optional(),
  priority: z.enum(["P1", "P2", "P3"]).default("P2"),
  subsystem_a_id: z.string().min(1),
  subsystem_b_id: z.string().min(1),
  description: z.string().min(10),
  driver: optionalText.optional(),
  owner_user_id: optionalRef.optional(),
  due_date: optionalText.optional(),
  notes: optionalText.optional(),
  links: optionalText.optional()
});

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role === "TEAM_MEMBER") {
    return NextResponse.json(
      { error: "Interfaces are raised by subsystem leads and above. Ask your lead to add it." },
      { status: 403 }
    );
  }

  const parsed = InterfaceInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalid(parsed.error, "Could not raise that interface");
  const data = parsed.data;

  if (data.subsystem_a_id === data.subsystem_b_id) {
    return NextResponse.json(
      { error: "An interface joins two DIFFERENT subsystems. Pick a second one." },
      { status: 422 }
    );
  }

  const db = getDb();

  // Reference numbers are generated from the two subsystem codes so they read
  // as what they are — CHS_PWT_001 — rather than as an opaque id. Generated
  // rather than typed, because a register whose keys people invent by hand
  // ends up with CHS-PWT-1, CHS_PWT_01 and chs_pwt_001 all meaning one joint.
  let ref = data.interface_ref?.trim();
  if (!ref) {
    const codes = db
      .prepare(`SELECT id, COALESCE(code, UPPER(SUBSTR(name,1,3))) AS code FROM subsystems WHERE id IN (?, ?)`)
      .all(data.subsystem_a_id, data.subsystem_b_id) as Array<{ id: string; code: string }>;
    const a = codes.find((c) => c.id === data.subsystem_a_id)?.code ?? "XXX";
    const b = codes.find((c) => c.id === data.subsystem_b_id)?.code ?? "XXX";
    // Sorted, so the same pair always produces the same prefix whichever way
    // round somebody raised it.
    const [first, second] = [a, b].sort();
    const n = db
      .prepare(`SELECT COUNT(*) AS c FROM interfaces WHERE interface_ref LIKE ?`)
      .get(`${first}_${second}_%`) as { c: number };
    ref = `${first}_${second}_${String(n.c + 1).padStart(3, "0")}`;
  }

  const id = newId("if");
  try {
    db.prepare(
      `INSERT INTO interfaces (
        id, interface_ref, priority, subsystem_a_id, subsystem_b_id,
        description, driver, owner_user_id, due_date, notes, links, status
      ) VALUES (@id, @ref, @priority, @a, @b, @description, @driver, @owner, @due, @notes, @links, 'OPEN')`
    ).run({
      id,
      ref,
      priority: data.priority,
      a: data.subsystem_a_id,
      b: data.subsystem_b_id,
      description: data.description,
      driver: data.driver ?? null,
      owner: data.owner_user_id ?? null,
      due: data.due_date ?? null,
      notes: data.notes ?? null,
      links: data.links ?? null
    });
  } catch (e) {
    return dbError(e, "Could not raise that interface");
  }

  db.prepare(
    `INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, 'CREATE', 'INTERFACE', ?, ?)`
  ).run(newId("log"), user.id, id, ref);

  return NextResponse.json({ id, interface_ref: ref }, { status: 201 });
}

import { getDb } from "./db";
import { procurementPriority, normalizePriorities, priorityBand, isNeeded, isOwned } from "./scoring";

export interface Part {
  id: string;
  part_name: string;
  part_number: string | null;
  manufacturer: string | null;
  category: string | null;
  subsystem_id: string;
  subsystem_name?: string;
  description: string | null;
  quantity_required: number;
  quantity_owned: number;
  status: string;
  importance: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  priority_score: number;
  estimated_cost: number | null;
  actual_cost: number | null;
  shipping_cost: number | null;
  lead_time_days: number | null;
  estimated_delivery_date: string | null;
  date_ordered: string | null;
  date_received: string | null;
  purchase_order_number: string | null;
  purchase_url: string | null;
  manufacturer_url: string | null;
  supplier: string | null;
  supplier_part_number: string | null;
  weight_kg: number | null;
  dimensions: string | null;
  material: string | null;
  operating_specifications: string | null;
  required_by_date: string | null;
  cad_status: string | null;
  documentation_status: string | null;
  owner_user_id: string | null;
  purchase_status: string;
  approval_status: string;
  requested_by: string | null;
  requested_by_name?: string;
  created_at: string;
  updated_at: string;
}

export function getAllSubsystems() {
  const db = getDb();
  return db
    .prepare(
      `SELECT s.*,
        (SELECT COUNT(*) FROM parts p WHERE p.subsystem_id = s.id) as part_count,
        (SELECT COUNT(*) FROM parts p WHERE p.subsystem_id = s.id AND p.status IN ('OWNED','AVAILABLE_FOR_INSTALLATION','INSTALLED')) as owned_count,
        (SELECT COUNT(*) FROM parts p WHERE p.subsystem_id = s.id AND p.status IN ('NEEDED','ORDERED','BACKORDERED')) as needed_count
       FROM subsystems s ORDER BY s.name ASC`
    )
    .all() as any[];
}

export function getSubsystemById(id: string) {
  const db = getDb();
  return db.prepare(`SELECT * FROM subsystems WHERE id = ?`).get(id) as any;
}

export function getSubsystemBySlug(slug: string) {
  const db = getDb();
  return db.prepare(`SELECT * FROM subsystems WHERE slug = ?`).get(slug) as any;
}

export function getSubsystemMembers(subsystemId: string) {
  const db = getDb();
  return db
    .prepare(
      `SELECT u.id, u.name, u.email, u.role, sm.role_in_subsystem
       FROM subsystem_members sm JOIN users u ON u.id = sm.user_id
       WHERE sm.subsystem_id = ?`
    )
    .all(subsystemId) as any[];
}

export function getAllParts(filters?: {
  subsystemId?: string;
  status?: string;
  importance?: string;
  search?: string;
}): Part[] {
  const db = getDb();
  let sql = `SELECT p.*, s.name as subsystem_name, u.name as requested_by_name\n    FROM parts p JOIN subsystems s ON s.id = p.subsystem_id\n    LEFT JOIN users u ON u.id = p.requested_by\n    WHERE 1=1`;
  const params: any[] = [];
  if (filters?.subsystemId) {
    sql += ` AND p.subsystem_id = ?`;
    params.push(filters.subsystemId);
  }
  if (filters?.status) {
    sql += ` AND p.status = ?`;
    params.push(filters.status);
  }
  if (filters?.importance) {
    sql += ` AND p.importance = ?`;
    params.push(filters.importance);
  }
  if (filters?.search) {
    sql += ` AND (p.part_name LIKE ? OR p.part_number LIKE ? OR p.manufacturer LIKE ? OR p.category LIKE ?)`;
    const like = `%${filters.search}%`;
    params.push(like, like, like, like);
  }
  sql += ` ORDER BY p.part_name ASC`;
  return db.prepare(sql).all(...params) as Part[];
}

export function getPartById(id: string): Part | undefined {
  const db = getDb();
  return db
    .prepare(
      `SELECT p.*, s.name as subsystem_name, u.name as requested_by_name
       FROM parts p JOIN subsystems s ON s.id = p.subsystem_id
       LEFT JOIN users u ON u.id = p.requested_by
       WHERE p.id = ?`
    )
    .get(id) as Part | undefined;
}

export function getDependentsCount(partId: string): number {
  const db = getDb();
  const row = db
    .prepare(`SELECT COUNT(*) as c FROM part_dependencies WHERE depends_on_part_id = ?`)
    .get(partId) as { c: number };
  return row.c;
}

export function getPartDependencies(partId: string) {
  const db = getDb();
  return db
    .prepare(
      `SELECT p.* FROM part_dependencies d JOIN parts p ON p.id = d.depends_on_part_id WHERE d.part_id = ?`
    )
    .all(partId) as Part[];
}

export function getPartDependents(partId: string) {
  const db = getDb();
  return db
    .prepare(
      `SELECT p.* FROM part_dependencies d JOIN parts p ON p.id = d.part_id WHERE d.depends_on_part_id = ?`
    )
    .all(partId) as Part[];
}

export function getPartSuppliers(partId: string) {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM part_suppliers WHERE part_id = ? ORDER BY is_preferred DESC`)
    .all(partId) as any[];
}

export function getPartDocuments(partId: string) {
  const db = getDb();
  return db.prepare(`SELECT * FROM documents WHERE part_id = ? ORDER BY created_at DESC`).all(partId) as any[];
}

export function getPartTools(partId: string) {
  const db = getDb();
  return db
    .prepare(
      `SELECT t.* FROM tool_parts tp JOIN tools t ON t.id = tp.tool_id WHERE tp.part_id = ?`
    )
    .all(partId) as any[];
}

export function getPartProcedures(partId: string) {
  const db = getDb();
  const procedures = db
    .prepare(
      `SELECT pr.*, a.name as author_name FROM procedures pr
       LEFT JOIN users a ON a.id = pr.author_id
       WHERE pr.part_id = ? ORDER BY pr.created_at DESC`
    )
    .all(partId) as any[];
  return procedures.map((proc) => ({
    ...proc,
    steps: db
      .prepare(`SELECT * FROM procedure_steps WHERE procedure_id = ? ORDER BY step_number ASC`)
      .all(proc.id)
  }));
}

export function getSubsystemDocuments(subsystemId: string) {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM documents WHERE subsystem_id = ? ORDER BY created_at DESC`)
    .all(subsystemId) as any[];
}

export function getSubsystemTools(subsystemId: string) {
  const db = getDb();
  return db
    .prepare(
      `SELECT t.* FROM tool_subsystems ts JOIN tools t ON t.id = ts.tool_id WHERE ts.subsystem_id = ?`
    )
    .all(subsystemId) as any[];
}

export function getAllTools(filters?: { search?: string; status?: string }) {
  const db = getDb();
  let sql = `SELECT * FROM tools WHERE 1=1`;
  const params: any[] = [];
  if (filters?.search) {
    sql += ` AND (tool_name LIKE ? OR tool_category LIKE ? OR manufacturer LIKE ?)`;
    const like = `%${filters.search}%`;
    params.push(like, like, like);
  }
  if (filters?.status) {
    sql += ` AND status = ?`;
    params.push(filters.status);
  }
  sql += ` ORDER BY tool_name ASC`;
  return db.prepare(sql).all(...params) as any[];
}

export function getToolById(id: string) {
  const db = getDb();
  const tool = db.prepare(`SELECT * FROM tools WHERE id = ?`).get(id) as any;
  if (!tool) return undefined;
  const subsystems = db
    .prepare(
      `SELECT s.* FROM tool_subsystems ts JOIN subsystems s ON s.id = ts.subsystem_id WHERE ts.tool_id = ?`
    )
    .all(id);
  const parts = db
    .prepare(`SELECT p.* FROM tool_parts tp JOIN parts p ON p.id = tp.part_id WHERE tp.tool_id = ?`)
    .all(id);
  return { ...tool, subsystems, parts };
}

export function getAllDocuments(filters?: { search?: string; subsystemId?: string }) {
  const db = getDb();
  let sql = `SELECT d.*, s.name as subsystem_name, p.part_name as part_name
    FROM documents d
    LEFT JOIN subsystems s ON s.id = d.subsystem_id
    LEFT JOIN parts p ON p.id = d.part_id
    WHERE 1=1`;
  const params: any[] = [];
  if (filters?.search) {
    sql += ` AND (d.title LIKE ? OR d.manufacturer LIKE ? OR d.category LIKE ?)`;
    const like = `%${filters.search}%`;
    params.push(like, like, like);
  }
  if (filters?.subsystemId) {
    sql += ` AND d.subsystem_id = ?`;
    params.push(filters.subsystemId);
  }
  sql += ` ORDER BY d.created_at DESC`;
  return db.prepare(sql).all(...params) as any[];
}

export function getAllProcedures(filters?: { category?: string; subsystemId?: string; search?: string }) {
  const db = getDb();
  let sql = `
    SELECT pr.*, p.part_name, s.name as subsystem_name, a.name as author_name, ap.name as approved_by_name
    FROM procedures pr
    LEFT JOIN parts p ON p.id = pr.part_id
    LEFT JOIN subsystems s ON s.id = pr.subsystem_id
    LEFT JOIN users a ON a.id = pr.author_id
    LEFT JOIN users ap ON ap.id = pr.approved_by
    WHERE 1=1
  `;
  const params: any[] = [];
  if (filters?.category) {
    sql += ` AND pr.category = ?`;
    params.push(filters.category);
  }
  if (filters?.subsystemId) {
    sql += ` AND pr.subsystem_id = ?`;
    params.push(filters.subsystemId);
  }
  if (filters?.search) {
    sql += ` AND (pr.title LIKE ? OR pr.description LIKE ? OR pr.purpose LIKE ?)`;
    const like = `%${filters.search}%`;
    params.push(like, like, like);
  }
  sql += ` ORDER BY pr.created_at DESC`;
  const procedures = db.prepare(sql).all(...params) as any[];
  return procedures.map((proc) => ({
    ...proc,
    stepCount: (
      db.prepare(`SELECT COUNT(*) as c FROM procedure_steps WHERE procedure_id = ?`).get(proc.id) as {
        c: number;
      }
    ).c
  }));
}

export function getProcedureById(id: string) {
  const db = getDb();
  const proc = db
    .prepare(
      `SELECT pr.*, p.part_name, s.name as subsystem_name, a.name as author_name, ap.name as approved_by_name
       FROM procedures pr
       LEFT JOIN parts p ON p.id = pr.part_id
       LEFT JOIN subsystems s ON s.id = pr.subsystem_id
       LEFT JOIN users a ON a.id = pr.author_id
       LEFT JOIN users ap ON ap.id = pr.approved_by
       WHERE pr.id = ?`
    )
    .get(id) as any;
  if (!proc) return undefined;
  const steps = db
    .prepare(`SELECT * FROM procedure_steps WHERE procedure_id = ? ORDER BY step_number ASC`)
    .all(id);
  const attachments = db
    .prepare(`SELECT * FROM documents WHERE procedure_id = ? ORDER BY created_at DESC`)
    .all(id);
  return { ...proc, steps, attachments };
}

// ---------------- STATS / DASHBOARD ----------------

export function getGlobalStats() {
  const parts = getAllParts();
  const total = parts.length;
  const owned = parts.filter((p) => isOwned(p.status)).length;
  const needed = parts.filter((p) => p.status === "NEEDED").length;
  const ordered = parts.filter((p) => p.status === "ORDERED").length;
  const backordered = parts.filter((p) => p.status === "BACKORDERED").length;
  const manufacturing = parts.filter((p) => p.status === "MANUFACTURING").length;
  const criticalMissing = parts.filter(
    (p) => p.importance === "CRITICAL" && !isOwned(p.status)
  ).length;

  // Cost fields are PER UNIT. A line costs unit price x quantity required, so
  // the rollup has to multiply. Summing the unit price as if it were the line
  // total under-reports the program by whatever the average quantity is above 1
  // (measured at 38% low against the real parts workbook).
  const totalCost = parts.reduce((sum, p) => sum + lineCost(p), 0);
  const totalCostLow = parts.reduce((sum, p) => sum + lineCost(p, "low"), 0);
  const totalCostHigh = parts.reduce((sum, p) => sum + lineCost(p, "high"), 0);

  // Readiness: weighted blend of ownership completion and critical parts secured.
  //
  // When nothing is marked CRITICAL the critical term has no denominator. It
  // used to default to 1, which handed out the full 45 points for free — a car
  // with zero parts owned reported 45% readiness. Nothing secured is 0%, so the
  // honest move is to drop the term and let ownership carry the whole score.
  const ownershipPct = total > 0 ? owned / total : 0;
  const criticalTotal = parts.filter((p) => p.importance === "CRITICAL").length;
  const criticalOwned = parts.filter((p) => p.importance === "CRITICAL" && isOwned(p.status)).length;
  const readiness =
    criticalTotal > 0
      ? Math.round((ownershipPct * 0.55 + (criticalOwned / criticalTotal) * 0.45) * 100)
      : Math.round(ownershipPct * 100);

  return {
    total,
    owned,
    needed,
    ordered,
    backordered,
    manufacturing,
    criticalMissing,
    totalCost,
    totalCostLow,
    totalCostHigh,
    readiness
  };
}

/**
 * Cost of one part LINE: unit price x quantity required, plus shipping once.
 * `band` picks which unit price to use — the single working figure, or the low
 * or high end of the quoted range when the workbook supplied one.
 */
export function lineCost(
  p: {
    actual_cost?: number | null;
    estimated_cost?: number | null;
    estimated_cost_low?: number | null;
    estimated_cost_high?: number | null;
    shipping_cost?: number | null;
    quantity_required?: number | null;
  },
  band: "mid" | "low" | "high" = "mid"
): number {
  // An actual cost is a fact and overrides any estimate, including the range.
  let unit = p.actual_cost ?? null;
  if (unit === null) {
    if (band === "low") unit = p.estimated_cost_low ?? p.estimated_cost ?? null;
    else if (band === "high") unit = p.estimated_cost_high ?? p.estimated_cost ?? null;
    else unit = p.estimated_cost ?? null;
  }
  if (unit === null) return 0;
  const qty = Math.max(1, Math.round(p.quantity_required ?? 1));
  return unit * qty + (p.shipping_cost ?? 0);
}

export function getStatusBreakdown() {
  const parts = getAllParts();
  const counts: Record<string, number> = {};
  for (const p of parts) counts[p.status] = (counts[p.status] ?? 0) + 1;
  return Object.entries(counts).map(([status, count]) => ({ status, count }));
}

export function getSubsystemReadiness() {
  const subsystems = getAllSubsystems();
  return subsystems
    .filter((s) => s.part_count > 0)
    .map((s) => ({
      id: s.id,
      name: s.name,
      slug: s.slug,
      partCount: s.part_count,
      ownedCount: s.owned_count,
      neededCount: s.needed_count,
      pct: s.part_count > 0 ? Math.round((s.owned_count / s.part_count) * 100) : 0
    }))
    .sort((a, b) => a.pct - b.pct);
}

export function getPartsWithPriority(filters?: {
  subsystemId?: string;
  status?: string;
  importance?: string;
  search?: string;
}) {
  const parts = getAllParts(filters);
  const scored = parts.map((p) => {
    const dependents = getDependentsCount(p.id);
    const raw = procurementPriority({
      status: p.status,
      importance: p.importance,
      priority_score: p.priority_score,
      lead_time_days: p.lead_time_days,
      quantity_required: p.quantity_required,
      quantity_owned: p.quantity_owned,
      dependents_count: dependents
    });
    return { ...p, dependents_count: dependents, procurement_priority_raw: raw, priorityScore: raw };
  });

  // `procurement_priority` is rescaled across the set actually returned, so the
  // most urgent part in view reads 100 and the rest sit relative to it. The raw
  // score is kept alongside for anything that needs an absolute comparison.
  return normalizePriorities(scored)
    .map(({ priorityScore, priorityRank, ...p }) => ({
      ...p,
      procurement_priority: priorityRank,
      procurement_priority_band: priorityBand(p.procurement_priority_raw)
    }))
    .sort((a, b) => b.procurement_priority_raw - a.procurement_priority_raw);
}

export function getCriticalProcurementItems(limit = 10) {
  return getPartsWithPriority()
    .filter((p) => p.procurement_priority > 0)
    .slice(0, limit);
}

export function getBlockingComponents() {
  const db = getDb();
  const parts = getAllParts();
  const blockers = parts.filter((p) => !isOwned(p.status) && p.status !== "NO_LONGER_NEEDED");
  const results: { subsystem: string; missing: Part[] }[] = [];
  const bySubsystem = new Map<string, Part[]>();
  for (const p of blockers) {
    const key = p.subsystem_name || "Unassigned";
    if (!bySubsystem.has(key)) bySubsystem.set(key, []);
    bySubsystem.get(key)!.push(p);
  }
  for (const [subsystem, missing] of bySubsystem.entries()) {
    if (missing.some((m) => m.importance === "CRITICAL" || m.importance === "HIGH")) {
      results.push({ subsystem, missing: missing.filter((m) => m.importance === "CRITICAL" || m.importance === "HIGH") });
    }
  }
  return results;
}

export function getMissingTools() {
  const db = getDb();
  return db
    .prepare(
      `SELECT t.*, GROUP_CONCAT(DISTINCT s.name) as subsystem_names
       FROM tools t
       LEFT JOIN tool_subsystems ts ON ts.tool_id = t.id
       LEFT JOIN subsystems s ON s.id = ts.subsystem_id
       WHERE t.status IN ('MISSING','DAMAGED','NEEDS_CALIBRATION')
       GROUP BY t.id`
    )
    .all() as any[];
}

export function getDependencyGraphData() {
  const db = getDb();
  const edges = db
    .prepare(
      `SELECT d.part_id, d.depends_on_part_id FROM part_dependencies d`
    )
    .all() as { part_id: string; depends_on_part_id: string }[];

  const involvedIds = new Set<string>();
  for (const e of edges) {
    involvedIds.add(e.part_id);
    involvedIds.add(e.depends_on_part_id);
  }
  if (involvedIds.size === 0) return [];

  const idsWithOwnEdges = new Set(edges.map((e) => e.part_id));
  return Array.from(idsWithOwnEdges).map((partId) => {
    const part = getPartById(partId)!;
    return {
      part,
      requires: getPartDependencies(partId),
      blocks: getPartDependents(partId)
    };
  });
}

export function globalSearch(query: string) {
  const db = getDb();
  const like = `%${query}%`;
  const parts = db
    .prepare(
      `SELECT id, part_name as title, subsystem_id FROM parts WHERE part_name LIKE ? OR part_number LIKE ? OR manufacturer LIKE ? LIMIT 8`
    )
    .all(like, like, like) as any[];
  const tools = db
    .prepare(`SELECT id, tool_name as title FROM tools WHERE tool_name LIKE ? OR tool_category LIKE ? LIMIT 8`)
    .all(like, like) as any[];
  const documents = db
    .prepare(`SELECT id, title FROM documents WHERE title LIKE ? OR manufacturer LIKE ? LIMIT 8`)
    .all(like, like) as any[];
  const procedures = db
    .prepare(`SELECT id, title FROM procedures WHERE title LIKE ? LIMIT 8`)
    .all(like) as any[];
  const subsystems = db
    .prepare(`SELECT id, name as title, slug FROM subsystems WHERE name LIKE ? LIMIT 8`)
    .all(like) as any[];
  return { parts, tools, documents, procedures, subsystems };
}

// ---------------- TASKS ----------------

function attachTaskExtras(task: any) {
  const db = getDb();
  const assignees = db
    .prepare(
      `SELECT u.id, u.name FROM task_assignees ta JOIN users u ON u.id = ta.user_id WHERE ta.task_id = ?`
    )
    .all(task.id);
  const blockedBy = db
    .prepare(
      `SELECT t.id, t.title, t.status FROM task_dependencies d JOIN tasks t ON t.id = d.blocked_by_task_id WHERE d.task_id = ?`
    )
    .all(task.id);
  const blocks = db
    .prepare(
      `SELECT t.id, t.title, t.status FROM task_dependencies d JOIN tasks t ON t.id = d.task_id WHERE d.blocked_by_task_id = ?`
    )
    .all(task.id);
  return { ...task, extra_assignees: assignees, blocked_by: blockedBy, blocks };
}

export function getAllTasksDetailed(filters?: { status?: string; subsystemId?: string }) {
  const db = getDb();
  let sql = `
    SELECT t.*, s.name as subsystem_name, st.name as subteam_name, p.part_name, pr.title as procedure_title,
      u.name as assignee_name, cb.name as created_by_name,
      sub.name as submitted_by_name, rev.name as reviewed_by_name
    FROM tasks t
    LEFT JOIN subsystems s ON s.id = t.subsystem_id
    LEFT JOIN subteams st ON st.id = t.subteam_id
    LEFT JOIN parts p ON p.id = t.part_id
    LEFT JOIN procedures pr ON pr.id = t.procedure_id
    LEFT JOIN users u ON u.id = t.assigned_to
    LEFT JOIN users cb ON cb.id = t.created_by
    LEFT JOIN users sub ON sub.id = t.submitted_by
    LEFT JOIN users rev ON rev.id = t.reviewed_by
    WHERE 1=1
  `;
  const params: any[] = [];
  if (filters?.status) {
    sql += ` AND t.status = ?`;
    params.push(filters.status);
  }
  if (filters?.subsystemId) {
    sql += ` AND t.subsystem_id = ?`;
    params.push(filters.subsystemId);
  }
  sql += ` ORDER BY (t.status = 'COMPLETED'), (t.priority = 'CRITICAL') DESC, t.due_date ASC`;
  const tasks = db.prepare(sql).all(...params) as any[];
  return tasks.map(attachTaskExtras);
}

export function getTaskById(id: string) {
  const db = getDb();
  const task = db
    .prepare(
      `SELECT t.*, s.name as subsystem_name, s.id as subsystem_id, st.name as subteam_name, p.part_name,
        pr.title as procedure_title, u.name as assignee_name, cb.name as created_by_name,
        sub.name as submitted_by_name, rev.name as reviewed_by_name
       FROM tasks t
       LEFT JOIN subsystems s ON s.id = t.subsystem_id
       LEFT JOIN subteams st ON st.id = t.subteam_id
       LEFT JOIN parts p ON p.id = t.part_id
       LEFT JOIN procedures pr ON pr.id = t.procedure_id
       LEFT JOIN users u ON u.id = t.assigned_to
       LEFT JOIN users cb ON cb.id = t.created_by
       LEFT JOIN users sub ON sub.id = t.submitted_by
       LEFT JOIN users rev ON rev.id = t.reviewed_by
       WHERE t.id = ?`
    )
    .get(id) as any;
  if (!task) return undefined;
  const attachments = db
    .prepare(`SELECT * FROM documents WHERE task_id = ? ORDER BY created_at DESC`)
    .all(id);
  return { ...attachTaskExtras(task), attachments };
}

/** Tasks awaiting leadership review, optionally scoped to the subsystems a Team Leader leads. */
export function getTasksAwaitingReview(subsystemIds?: string[]) {
  const db = getDb();
  let sql = `
    SELECT t.*, s.name as subsystem_name, u.name as assignee_name, sub.name as submitted_by_name
    FROM tasks t
    LEFT JOIN subsystems s ON s.id = t.subsystem_id
    LEFT JOIN users u ON u.id = t.assigned_to
    LEFT JOIN users sub ON sub.id = t.submitted_by
    WHERE t.status = 'SUBMITTED_FOR_REVIEW'
  `;
  const params: any[] = [];
  if (subsystemIds && subsystemIds.length > 0) {
    sql += ` AND t.subsystem_id IN (${subsystemIds.map(() => "?").join(",")})`;
    params.push(...subsystemIds);
  }
  sql += ` ORDER BY t.submitted_at ASC`;
  return db.prepare(sql).all(...params) as any[];
}

export function getTaskDocuments(taskId: string) {
  const db = getDb();
  return db.prepare(`SELECT * FROM documents WHERE task_id = ? ORDER BY created_at DESC`).all(taskId) as any[];
}

export function getSubteams(subsystemId?: string) {
  const db = getDb();
  if (subsystemId) {
    return db.prepare(`SELECT * FROM subteams WHERE subsystem_id = ? ORDER BY name ASC`).all(subsystemId) as any[];
  }
  return db
    .prepare(`SELECT st.*, s.name as subsystem_name FROM subteams st JOIN subsystems s ON s.id = st.subsystem_id ORDER BY s.name, st.name`)
    .all() as any[];
}

/** Tasks that are OPEN and assigned to this user (directly, or via their team/subsystem scope) — used for the "new task" notification. */
export function getNewlyAssignedTasksForUser(userId: string, subsystemIds: string[]) {
  const db = getDb();
  let sql = `
    SELECT t.*, s.name as subsystem_name, cb.name as created_by_name FROM tasks t
    LEFT JOIN subsystems s ON s.id = t.subsystem_id
    LEFT JOIN users cb ON cb.id = t.created_by
    WHERE t.status = 'OPEN' AND (
      t.assigned_to = ?
      OR t.id IN (SELECT task_id FROM task_assignees WHERE user_id = ?)
  `;
  const params: any[] = [userId, userId];
  if (subsystemIds.length > 0) {
    sql += ` OR (t.assignment_scope IN ('TEAM','SUBSYSTEM') AND t.subsystem_id IN (${subsystemIds.map(() => "?").join(",")}))`;
    params.push(...subsystemIds);
  }
  sql += `)`;
  return db.prepare(sql).all(...params) as any[];
}

// ---------------- TEAMS OVERVIEW ----------------

export function getTeamsOverview() {
  const db = getDb();
  const subsystems = db.prepare(`SELECT * FROM subsystems ORDER BY name ASC`).all() as any[];

  return subsystems.map((s) => {
    const members = db
      .prepare(
        `SELECT u.id, u.name, u.email, u.phone_number, u.role, u.last_active, sm.role_in_subsystem
         FROM subsystem_members sm JOIN users u ON u.id = sm.user_id
         WHERE sm.subsystem_id = ? AND u.is_active = 1
         ORDER BY (sm.role_in_subsystem = 'LEADER') DESC, u.name ASC`
      )
      .all(s.id) as any[];

    const withTaskCounts = members.map((m) => {
      const activeTasks = (
        db
          .prepare(
            `SELECT COUNT(*) as c FROM tasks WHERE assigned_to = ? AND subsystem_id = ? AND status IN ('OPEN','IN_PROGRESS','SUBMITTED_FOR_REVIEW')`
          )
          .get(m.id, s.id) as { c: number }
      ).c;
      return { ...m, activeTasks };
    });

    return {
      ...s,
      leaders: withTaskCounts.filter((m) => m.role_in_subsystem === "LEADER"),
      members: withTaskCounts.filter((m) => m.role_in_subsystem === "MEMBER")
    };
  });
}

// ---------------- CALENDAR ----------------

export function getAllCalendarEvents(filters?: { subsystemId?: string; status?: string }) {
  const db = getDb();
  let sql = `
    SELECT ce.*, s.name as subsystem_name, u.name as responsible_user_name, cb.name as created_by_name
    FROM calendar_events ce
    LEFT JOIN subsystems s ON s.id = ce.subsystem_id
    LEFT JOIN users u ON u.id = ce.responsible_user_id
    LEFT JOIN users cb ON cb.id = ce.created_by
    WHERE 1=1
  `;
  const params: any[] = [];
  if (filters?.subsystemId) {
    sql += ` AND ce.subsystem_id = ?`;
    params.push(filters.subsystemId);
  }
  if (filters?.status) {
    sql += ` AND ce.status = ?`;
    params.push(filters.status);
  }
  sql += ` ORDER BY ce.deadline_date ASC, ce.deadline_time ASC`;
  return db.prepare(sql).all(...params) as any[];
}

export function getCalendarEventById(id: string) {
  const db = getDb();
  const event = db
    .prepare(
      `SELECT ce.*, s.name as subsystem_name, u.name as responsible_user_name, cb.name as created_by_name,
        sub.name as submitted_by_name, rev.name as reviewed_by_name
       FROM calendar_events ce
       LEFT JOIN subsystems s ON s.id = ce.subsystem_id
       LEFT JOIN users u ON u.id = ce.responsible_user_id
       LEFT JOIN users cb ON cb.id = ce.created_by
       LEFT JOIN users sub ON sub.id = ce.submitted_by
       LEFT JOIN users rev ON rev.id = ce.reviewed_by
       WHERE ce.id = ?`
    )
    .get(id) as any;
  if (!event) return undefined;
  const attachments = db.prepare(`SELECT * FROM documents WHERE calendar_event_id = ? ORDER BY created_at DESC`).all(id);
  return { ...event, attachments };
}

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + "T00:00:00");
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

/** Deadlines due within their configured reminder window, scoped to a given user's visibility. */
export function getDueReminders(user: { id: string; role: string }, memberSubsystemIds: string[]) {
  const db = getDb();
  const events = db
    .prepare(`SELECT ce.*, s.name as subsystem_name FROM calendar_events ce LEFT JOIN subsystems s ON s.id = ce.subsystem_id WHERE ce.status != 'COMPLETED'`)
    .all() as any[];

  const wide = user.role === "ADMIN" || user.role === "CHIEF_ENGINEER";

  return events.filter((e) => {
    const remaining = daysUntil(e.deadline_date);
    if (remaining < 0 || remaining > 30) return false;
    let intervals: number[] = [];
    try {
      intervals = JSON.parse(e.reminder_intervals || "[]");
    } catch {
      intervals = [];
    }
    if (!intervals.includes(remaining) && remaining !== 0) return false;

    switch (e.notify_scope) {
      case "EVERYONE":
        return true;
      case "TEAM":
      case "SUBSYSTEM":
        return wide || (e.subsystem_id && memberSubsystemIds.includes(e.subsystem_id));
      case "ASSIGNED_USER":
        return e.responsible_user_id === user.id || wide;
      case "TEAM_LEADS":
        return user.role === "TEAM_LEADER" || wide;
      case "ADMINS":
        return wide;
      default:
        return wide;
    }
  }).map((e) => ({ ...e, daysRemaining: daysUntil(e.deadline_date) }));
}

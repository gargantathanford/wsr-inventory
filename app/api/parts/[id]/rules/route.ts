import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";
import { getSession, canEditSubsystem } from "@/lib/auth";
import { getPartById, getRuleByClauseId, getRuleCitations, getActiveRuleset } from "@/lib/queries";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const part = getPartById(params.id);
  if (!part) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ citations: getRuleCitations("PART", params.id) });
}

const CitationInput = z.object({
  // Accept the clause number a lead actually sees ("T.5.2.7") rather than an
  // internal rule row id, so the picker can post what it displays.
  clause_id: z.string().min(2).max(24),
  note: z.string().max(500).optional().nullable()
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const part = getPartById(params.id);
  if (!part) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canEditSubsystem(user, part.subsystem_id)) {
    return NextResponse.json({ error: "You do not have edit access to this subsystem." }, { status: 403 });
  }

  const parsed = CitationInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  if (!getActiveRuleset()) {
    return NextResponse.json(
      { error: "No ruleset is loaded. An admin must import the current FSAE rules first." },
      { status: 409 }
    );
  }

  const rule = getRuleByClauseId(parsed.data.clause_id);
  if (!rule) {
    // Refusing an unknown clause is the point of the feature: a citation that
    // does not exist in the active ruleset is worse than no citation, because
    // it reads as verified.
    return NextResponse.json(
      { error: `No clause "${parsed.data.clause_id}" in the active ruleset. Pick one from the list.` },
      { status: 400 }
    );
  }

  const db = getDb();
  try {
    db.prepare(
      `INSERT INTO rule_citations (id, rule_id, entity_type, entity_id, note, cited_by)
       VALUES (?, ?, 'PART', ?, ?, ?)`
    ).run(newId("cite"), rule.id, params.id, parsed.data.note ?? null, user.id);
  } catch {
    return NextResponse.json({ error: "That clause is already cited on this part." }, { status: 409 });
  }

  db.prepare(
    `INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, details)
     VALUES (?, ?, 'CITE_RULE', 'PART', ?, ?)`
  ).run(newId("log"), user.id, params.id, `${rule.clause_id} — ${part.part_name}`);

  return NextResponse.json({ ok: true, clause_id: rule.clause_id }, { status: 201 });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const part = getPartById(params.id);
  if (!part) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canEditSubsystem(user, part.subsystem_id)) {
    return NextResponse.json({ error: "You do not have edit access to this subsystem." }, { status: 403 });
  }

  const citationId = new URL(req.url).searchParams.get("citation");
  if (!citationId) return NextResponse.json({ error: "citation id required" }, { status: 400 });

  const db = getDb();
  const changes = db
    .prepare(`DELETE FROM rule_citations WHERE id = ? AND entity_type = 'PART' AND entity_id = ?`)
    .run(citationId, params.id).changes;
  if (!changes) return NextResponse.json({ error: "Citation not found on this part." }, { status: 404 });

  db.prepare(
    `INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, details)
     VALUES (?, ?, 'UNCITE_RULE', 'PART', ?, ?)`
  ).run(newId("log"), user.id, params.id, part.part_name);

  return NextResponse.json({ ok: true });
}

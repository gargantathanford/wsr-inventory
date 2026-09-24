import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";
import { getSession, canEditSubsystem } from "@/lib/auth";
import { getAllProcedures } from "@/lib/queries";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const procedures = getAllProcedures({
    category: searchParams.get("category") || undefined,
    subsystemId: searchParams.get("subsystem") || undefined,
    search: searchParams.get("q") || undefined
  });
  return NextResponse.json({ procedures });
}

const ProcedureInput = z.object({
  title: z.string().min(1),
  category: z.string().default("GENERAL"),
  description: z.string().optional().nullable(),
  purpose: z.string().optional().nullable(),
  applicable_teams: z.string().optional().nullable(),
  subsystem_id: z.string().optional().nullable(),
  part_id: z.string().optional().nullable(),
  required_documentation: z.string().optional().nullable(),
  supporting_links: z.string().optional().nullable(),
  safety_warning: z.string().optional().nullable(),
  revision_number: z.string().default("1.0"),
  steps: z.array(z.string().min(1)).default([])
});

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role === "TEAM_MEMBER") {
    return NextResponse.json({ error: "Team members cannot create procedures." }, { status: 403 });
  }

  const parsed = ProcedureInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const data = parsed.data;

  if (data.subsystem_id && !canEditSubsystem(user, data.subsystem_id)) {
    return NextResponse.json({ error: "You do not lead this subsystem." }, { status: 403 });
  }

  const db = getDb();
  const id = newId("proc");
  db.prepare(
    `INSERT INTO procedures (
      id, title, category, description, purpose, applicable_teams, subsystem_id, part_id,
      required_documentation, supporting_links, safety_warning, revision_number, author_id, approval_status
    ) VALUES (@id, @title, @category, @description, @purpose, @applicable_teams, @subsystem_id, @part_id,
      @required_documentation, @supporting_links, @safety_warning, @revision_number, @author_id, 'DRAFT')`
  ).run({
    id,
    title: data.title,
    category: data.category,
    description: data.description ?? null,
    purpose: data.purpose ?? null,
    applicable_teams: data.applicable_teams ?? null,
    subsystem_id: data.subsystem_id ?? null,
    part_id: data.part_id ?? null,
    required_documentation: data.required_documentation ?? null,
    supporting_links: data.supporting_links ?? null,
    safety_warning: data.safety_warning ?? null,
    revision_number: data.revision_number,
    author_id: user.id
  });

  const insertStep = db.prepare(
    `INSERT INTO procedure_steps (id, procedure_id, step_number, content) VALUES (?, ?, ?, ?)`
  );
  data.steps.forEach((content, i) => insertStep.run(newId("step"), id, i + 1, content));

  db.prepare(
    `INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, 'CREATE', 'PROCEDURE', ?, ?)`
  ).run(newId("log"), user.id, id, data.title);

  return NextResponse.json({ id }, { status: 201 });
}

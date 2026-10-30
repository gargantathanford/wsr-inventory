import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";
import { getSession, canEditSubsystem } from "@/lib/auth";
import { getAllProcedures } from "@/lib/queries";
import { invalid, dbError, optionalRef, optionalText } from "@/lib/apiValidation";

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
  description: optionalText.optional(),
  purpose: optionalText.optional(),
  applicable_teams: optionalText.optional(),
  // Both of these are FK columns and both are dropdowns with an empty default
  // option, so both arrived as "" and blew up the INSERT. See apiValidation.ts.
  subsystem_id: optionalRef.optional(),
  part_id: optionalRef.optional(),
  required_documentation: optionalText.optional(),
  supporting_links: optionalText.optional(),
  safety_warning: optionalText.optional(),
  revision_number: z.string().default("1.0"),
  // A procedure with no steps is not a procedure. This was `.default([])`, so a
  // form submitted with every step row left blank was accepted and stored as an
  // empty how-to.
  steps: z.array(z.string().min(1)).min(1, "add at least one step")
});

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role === "TEAM_MEMBER") {
    return NextResponse.json({ error: "Team members cannot create procedures." }, { status: 403 });
  }

  const parsed = ProcedureInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalid(parsed.error, "Could not create procedure");
  const data = parsed.data;

  if (data.subsystem_id && !canEditSubsystem(user, data.subsystem_id)) {
    return NextResponse.json({ error: "You do not lead this subsystem." }, { status: 403 });
  }

  const db = getDb();
  const id = newId("proc");
  try {
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
  } catch (e) {
    return dbError(e, "Could not create procedure");
  }

  return NextResponse.json({ id }, { status: 201 });
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { invalid, dbError } from "@/lib/apiValidation";
import { setMassBudget, getMassStanding } from "@/lib/readiness/store";

/**
 * A subsystem's mass budget.
 *
 *   POST /api/subsystems/{id}/mass  { budget_kg }
 *
 * Always kilograms. The browser converts before sending, the same as every
 * other mass in the app — a unit on the wire would be one more place the
 * conversion could be forgotten.
 */
const Input = z.object({
  budget_kg: z.number().nullable()
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalid(parsed.error, "Could not save that budget");

  try {
    const result = setMassBudget(params.id, user, parsed.data.budget_kg);
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 422 });
    return NextResponse.json({ mass: getMassStanding(params.id) });
  } catch (e) {
    return dbError(e, "Could not save that budget");
  }
}

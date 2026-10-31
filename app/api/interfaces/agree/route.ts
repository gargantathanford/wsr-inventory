import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { invalid, dbError } from "@/lib/apiValidation";
import { agreeInterface } from "@/lib/readiness/store";

/**
 * One side agrees an interface.
 *
 *   POST /api/interfaces/agree  { interface_ref }
 *
 * There is no "agree on behalf of both" call, deliberately. The whole reason
 * the interfaces gate exists is that each team assumed the other owned the
 * joint; a convenience endpoint that let one person close both sides would
 * hand that failure mode straight back.
 */
const Input = z.object({ interface_ref: z.string().min(1) });

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalid(parsed.error, "Could not agree that interface");

  try {
    const result = agreeInterface(parsed.data.interface_ref, user);
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 422 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return dbError(e, "Could not agree that interface");
  }
}

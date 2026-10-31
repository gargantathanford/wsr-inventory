import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { invalid, dbError } from "@/lib/apiValidation";
import { createWindow, deleteWindow, getAllWindows } from "@/lib/xp/store";

/**
 * Multiplier windows.
 *
 *   GET    /api/xp/windows    -> recent and upcoming
 *   POST   /api/xp/windows    -> open one
 *   DELETE /api/xp/windows    -> cancel an upcoming one
 *
 * Every limit is enforced in lib/xp/ranks.ts and the refusal explains the
 * reasoning rather than quoting a number — somebody asking for a 3x window on
 * a whole weekend is not being unreasonable, they just have not thought about
 * what it does to the three weeks around it.
 */

const Input = z.object({
  label: z.string().min(3),
  multiplier: z.number(),
  startsAt: z.string().min(1),
  endsAt: z.string().min(1)
});

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ windows: getAllWindows() });
}

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalid(parsed.error, "Could not open that window");
  try {
    const result = createWindow(parsed.data, user);
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 422 });
    return NextResponse.json({ windows: getAllWindows() }, { status: 201 });
  } catch (e) {
    return dbError(e, "Could not open that window");
  }
}

export async function DELETE(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!body.id) return NextResponse.json({ error: "Which window?" }, { status: 400 });
  try {
    const result = deleteWindow(String(body.id), user);
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 422 });
    return NextResponse.json({ windows: getAllWindows() });
  } catch (e) {
    return dbError(e, "Could not remove that window");
  }
}

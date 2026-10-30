import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hashPassword } from "@/lib/auth";
import { checkPassword } from "@/lib/password";
import { checkRateLimit } from "@/lib/rateLimit";
import { checkSetupToken, consumeSetupToken } from "@/lib/setupTokens";

const Input = z.object({
  token: z.string().min(10),
  password: z.string().min(1)
});

/**
 * Set a password from a setup link. Unauthenticated by design — the token IS
 * the authentication.
 */
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.ip || "unknown";
  // The token is 256 bits and not guessable, but rate limiting keeps this
  // endpoint from being a free hashing oracle.
  if (!checkRateLimit(`setup:${ip}`, 10, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });
  }

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const check = checkSetupToken(parsed.data.token);
  if (!check.valid) {
    const message =
      check.reason === "used"
        ? "This link has already been used. Ask an admin for a new one."
        : check.reason === "expired"
        ? "This link has expired. Ask an admin for a new one."
        : "This link is not valid. Check you copied all of it.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const pw = checkPassword(parsed.data.password, { name: check.name, email: check.email });
  if (!pw.ok) return NextResponse.json({ error: pw.problems.join(" ") }, { status: 400 });

  // Re-checked inside the transaction, so two submissions of the same link
  // cannot both win.
  if (!consumeSetupToken(parsed.data.token, hashPassword(parsed.data.password))) {
    return NextResponse.json({ error: "This link has already been used." }, { status: 409 });
  }

  // No session is issued here on purpose: the person signs in with the password
  // they just chose, which proves it works while they are still paying
  // attention rather than discovering a typo tomorrow.
  return NextResponse.json({ ok: true, email: check.email });
}

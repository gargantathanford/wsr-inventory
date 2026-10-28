import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { searchRules, getActiveRuleset, getAllRulesets } from "@/lib/queries";

/**
 * Clause search for the citation picker.
 *   GET /api/rules?q=scatter+shield
 *   GET /api/rules?q=T.5.2
 *   GET /api/rules?rulesets=1        -> which editions are loaded, and which is active
 *
 * Read-only. Rules are reference data imported by an admin from the command
 * line (scripts/import-ruleset.ts); there is no write route here on purpose.
 */
export async function GET(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);

  if (searchParams.get("rulesets")) {
    return NextResponse.json({ rulesets: getAllRulesets(), active: getActiveRuleset() ?? null });
  }

  const active = getActiveRuleset();
  if (!active) {
    return NextResponse.json({
      rules: [],
      active: null,
      // Said plainly so the picker can explain itself rather than looking broken.
      notice:
        "No ruleset has been imported yet. An admin runs scripts/import-ruleset.ts with the current FSAE rules."
    });
  }

  const q = searchParams.get("q") ?? "";
  const limitRaw = Number(searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 25;

  return NextResponse.json({ rules: searchRules(q, limit), active });
}

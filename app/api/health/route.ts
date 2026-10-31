import { NextResponse } from "next/server";
import { getDbHealth } from "@/lib/db";
import { getBuildStamp } from "@/lib/buildStamp";

// Without this, Next pre-renders this handler at build time: the build opens the
// database, and the Docker HEALTHCHECK gets a frozen "ok" instead of a live DB check.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // `SELECT 1` alone is not a health check. An empty database — the state a
    // destroyed or re-pointed data volume leaves behind — passes it, so the
    // container reports healthy while nobody can log in. Row counts are what
    // separate "the process is up" from "the data is there".
    const health = getDbHealth();
    const body = {
      status: health.ok ? "ok" : "degraded",
      db: health.ok ? "ok" : "empty",
      users: health.users,
      subsystems: health.subsystems,
      parts: health.parts,
      time: new Date().toISOString(),
      // Which build is serving this. A `build.at` earlier than your last pull
      // means the container is running an old image: `restart` does not
      // rebuild. See lib/buildStamp.ts.
      build: getBuildStamp(),
      ...(health.ok
        ? {}
        : {
            detail:
              "Database has no user accounts. The data volume is probably missing, " +
              "was destroyed, or a different volume got mounted. Restore a backup " +
              "(scripts/restore.ts) or initialize (npm run seed:prod)."
          })
    };
    return NextResponse.json(body, { status: health.ok ? 200 : 503 });
  } catch (err) {
    return NextResponse.json(
      { status: "error", db: "unreachable", error: err instanceof Error ? err.message : "unknown" },
      { status: 503 }
    );
  }
}

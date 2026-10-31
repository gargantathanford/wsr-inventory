import fs from "node:fs";
import path from "node:path";

/**
 * What is actually running.
 *
 * This exists because of a specific, repeated failure: pull new code, run
 * `docker compose restart app`, then look for the new feature and not find it.
 * Restart re-runs the built image; it does not rebuild it. Nothing errors,
 * nothing logs, and the app looks fine — it is just last week's app. Twice now
 * that has been diagnosed as a bug in the feature instead of a stale image.
 *
 * The stamp is written into the image at build time (see Dockerfile) and read
 * back here. Outside Docker there is no stamp, which is itself the right
 * answer: `next dev` compiles from the working tree, so there is nothing to be
 * stale against.
 */
export interface BuildStamp {
  /** Short commit, or "unknown" when the build arg was not passed. */
  ref: string;
  /** ISO-8601, UTC. Compare this against when you last pulled. */
  at: string | null;
  /** "docker" if a stamp was found in the image, "dev" otherwise. */
  source: "docker" | "dev";
}

let cached: BuildStamp | null = null;

export function getBuildStamp(): BuildStamp {
  if (cached) return cached;
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), ".build-stamp"), "utf8");
    const parsed = JSON.parse(raw) as { ref?: unknown; at?: unknown };
    cached = {
      ref: typeof parsed.ref === "string" && parsed.ref ? parsed.ref : "unknown",
      at: typeof parsed.at === "string" && parsed.at ? parsed.at : null,
      source: "docker"
    };
  } catch {
    // Missing, unreadable or malformed — all mean the same thing here, and
    // none of them is worth failing a health check over.
    cached = { ref: "dev", at: null, source: "dev" };
  }
  return cached;
}

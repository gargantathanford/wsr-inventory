// Edge-runtime safe (no Node built-ins) — this is imported by both middleware.ts
// (which may run on the edge runtime) and lib/auth.ts (Node runtime).

export const DEV_FALLBACK_SESSION_SECRET = "warp-speed-racing-dev-secret-change-me";

/**
 * Resolves the session-signing secret. Production correctness is enforced once,
 * at boot, by instrumentation.ts — this function just resolves the value for
 * everyday use and never has to re-validate it on every request.
 */
export function getSessionSecretString(): string {
  return process.env.SESSION_SECRET || DEV_FALLBACK_SESSION_SECRET;
}

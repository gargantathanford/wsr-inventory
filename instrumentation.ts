/**
 * Runs once, when the Next.js server process starts — before it accepts any
 * requests. This is the enforcement point for "refuse to boot without a real
 * session secret," closing the gap where a hardcoded dev fallback could
 * silently ship to production.
 *
 * Next.js calls this automatically because the file is named `instrumentation.ts`
 * at the project root (stable since Next 14). No wiring required elsewhere.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { DEV_FALLBACK_SESSION_SECRET } = await import("./lib/env");
  const isProd = process.env.NODE_ENV === "production";
  const secret = process.env.SESSION_SECRET;

  if (isProd) {
    const fail = (msg: string): never => {
      // eslint-disable-next-line no-console
      console.error(`\nFATAL: ${msg}\n`);
      process.exit(1);
    };

    if (!secret) {
      fail(
        "SESSION_SECRET is not set. Refusing to start in production without a real " +
          "session secret. Generate one with `openssl rand -base64 48` and set it in your " +
          "environment before starting the app. See DEPLOYMENT.md."
      );
    } else if (secret === DEV_FALLBACK_SESSION_SECRET) {
      fail(
        "SESSION_SECRET is set to the publicly-known development placeholder. This value " +
          "is visible in the source code and must never be used outside local development. " +
          "Generate a real secret with `openssl rand -base64 48`."
      );
    } else if (secret.length < 32) {
      fail(
        "SESSION_SECRET is shorter than 32 characters. Use `openssl rand -base64 48` to " +
          "generate a properly random secret."
      );
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    isProd
      ? "[boot] Production mode — SESSION_SECRET validated."
      : "[boot] Development mode — using dev fallbacks where unset. Do not deploy this way."
  );
}

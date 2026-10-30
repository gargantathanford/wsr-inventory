/**
 * Password policy — pure, and the single source of truth.
 *
 * Previously every entry point carried its own `z.string().min(6)`, which meant
 * six characters was acceptable in four different places and nobody had decided
 * that on purpose. This module is imported by admin user creation, admin edit,
 * the CLI reset script and self-service change, so the rule is stated once.
 *
 * Length is the policy. Composition rules — one uppercase, one symbol — push
 * people toward `Password1!` and are worse than a longer passphrase, so the
 * only other checks here reject the handful of passwords that are actually
 * guessed in practice.
 */

/** Twelve, not eight. This app sits on a public subdomain behind one factor. */
export const MIN_PASSWORD_LENGTH = 12;

/** bcrypt silently truncates beyond 72 bytes, so refuse rather than mislead. */
export const MAX_PASSWORD_LENGTH = 72;

/**
 * Passwords that show up in every credential-stuffing list. Not a serious
 * dictionary — the length minimum does the real work — but these are cheap to
 * catch and embarrassing to allow.
 */
const OBVIOUS = [
  "password",
  "passw0rd",
  "letmein",
  "welcome",
  "qwerty",
  "iloveyou",
  "admin",
  "changeme",
  "secret",
  "monkey",
  "dragon",
  "football",
  "baseball",
  "sunshine",
  "princess"
];

/** Team-specific guesses. The obvious choice for this particular app. */
const CONTEXTUAL = ["warpspeed", "warpspeedracing", "formulasae", "fsae", "okstate", "osutulsa", "wsrracing"];

export interface PasswordCheck {
  ok: boolean;
  /** Everything wrong with it, so the person fixes it in one go. */
  problems: string[];
}

export function checkPassword(password: string, context: { name?: string; email?: string } = {}): PasswordCheck {
  const problems: string[] = [];
  const pw = password ?? "";

  if (pw.length < MIN_PASSWORD_LENGTH) {
    problems.push(`Use at least ${MIN_PASSWORD_LENGTH} characters — a short phrase works well.`);
  }
  // Measured in bytes: bcrypt's limit is bytes, and one emoji is four of them.
  if (Buffer.byteLength(pw, "utf8") > MAX_PASSWORD_LENGTH) {
    problems.push(`Keep it under ${MAX_PASSWORD_LENGTH} bytes — anything longer is silently ignored.`);
  }
  if (pw.trim().length === 0 && pw.length > 0) {
    problems.push("A password of only spaces is not a password.");
  }

  const lower = pw.toLowerCase();
  const squashed = lower.replace(/[^a-z0-9]/g, "");

  if (OBVIOUS.some((w) => squashed.includes(w))) {
    problems.push("That contains a very common password. Pick something unrelated.");
  }
  if (CONTEXTUAL.some((w) => squashed.includes(w))) {
    problems.push("Avoid the team or school name — it is the first thing anyone would try.");
  }

  // Their own name or email local part is equally guessable.
  const localPart = (context.email ?? "").split("@")[0]?.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (localPart && localPart.length >= 4 && squashed.includes(localPart)) {
    problems.push("Avoid your own email address.");
  }
  for (const part of (context.name ?? "").toLowerCase().split(/\s+/)) {
    const p = part.replace(/[^a-z0-9]/g, "");
    if (p.length >= 4 && squashed.includes(p)) {
      problems.push("Avoid your own name.");
      break;
    }
  }

  // A single repeated character, or a straight run off the keyboard.
  if (pw.length >= MIN_PASSWORD_LENGTH && /^(.)\1+$/.test(pw)) {
    problems.push("That is one character repeated.");
  }
  if (/0123456789|abcdefghij|qwertyuiop/.test(lower)) {
    problems.push("That contains a long keyboard run.");
  }

  return { ok: problems.length === 0, problems };
}

/** First problem only, for places with room for one line. */
export function passwordProblem(password: string, context?: { name?: string; email?: string }): string | null {
  const r = checkPassword(password, context);
  return r.ok ? null : r.problems[0];
}

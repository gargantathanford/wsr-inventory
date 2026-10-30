/**
 * One-time account setup links.
 *
 * An admin creating accounts previously had to invent a password for each
 * person and then tell them what it was. That means the admin knows everyone's
 * password, and there is no moment at which a password is known only to its
 * owner. A setup link fixes that: the account is created with no password, the
 * person follows a single-use link and chooses their own.
 *
 * SECURITY SHAPE
 *
 *   - Only the SHA-256 of the token is stored. A leaked database backup must
 *     not hand somebody a working set of account-takeover links. bcrypt is for
 *     passwords, which are low-entropy and guessable; a 256-bit random token is
 *     not guessable, so a fast hash is the right tool and the slow one would
 *     just make lookup expensive.
 *   - 72 hours, then it is dead. Long enough to catch someone over a weekend,
 *     short enough that a forgotten link in a chat history stops working.
 *   - Single use. Consumed the moment a password is set.
 *   - Issuing a new link for a person invalidates their outstanding ones, so a
 *     link shared with the wrong person can be revoked by reissuing.
 *   - A user with an empty password_hash cannot log in: bcrypt.compare against
 *     "" fails for every input, so an account awaiting setup is not an account
 *     with a blank password.
 */
import crypto from "crypto";
import { getDb } from "./db";
import { newId } from "./id";

/** Long enough to catch a weekend; short enough that a stale link is dead. */
export const SETUP_TOKEN_TTL_HOURS = 72;

export type TokenPurpose = "SETUP" | "RESET";

/** 32 random bytes, base64url — 256 bits, unguessable, URL-safe. */
function generateToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export interface IssuedToken {
  /** The ONLY time the raw token exists. Not stored, not recoverable. */
  token: string;
  expiresAt: string;
  path: string;
}

/**
 * Issue a setup link for a user. Returns the raw token once; after this call it
 * exists nowhere but the caller's hands.
 */
export function issueSetupToken(
  userId: string,
  createdBy: string | null,
  purpose: TokenPurpose = "SETUP"
): IssuedToken {
  const db = getDb();
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SETUP_TOKEN_TTL_HOURS * 3600_000).toISOString();

  db.transaction(() => {
    // Reissuing revokes anything outstanding, so a link sent to the wrong
    // person can be killed by issuing a fresh one.
    db.prepare(
      `UPDATE account_setup_tokens SET used_at = datetime('now')
        WHERE user_id = ? AND used_at IS NULL`
    ).run(userId);

    db.prepare(
      `INSERT INTO account_setup_tokens (id, user_id, token_hash, purpose, expires_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(newId("sut"), userId, hashToken(token), purpose, expiresAt, createdBy);
  })();

  return { token, expiresAt, path: `/setup/${token}` };
}

export type TokenCheck =
  | { valid: true; userId: string; name: string; email: string; purpose: TokenPurpose; tokenId: string }
  | { valid: false; reason: "unknown" | "used" | "expired" };

/**
 * Look a token up without consuming it, for rendering the page.
 *
 * Every failure mode returns a reason rather than a bare false, so the page can
 * say "this link has already been used" instead of a generic error that leaves
 * somebody guessing whether they mistyped it.
 */
export function checkSetupToken(token: string): TokenCheck {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT t.id, t.user_id, t.purpose, t.expires_at, t.used_at, u.name, u.email
         FROM account_setup_tokens t JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = ?`
    )
    .get(hashToken(token)) as
    | {
        id: string;
        user_id: string;
        purpose: TokenPurpose;
        expires_at: string;
        used_at: string | null;
        name: string;
        email: string;
      }
    | undefined;

  if (!row) return { valid: false, reason: "unknown" };
  if (row.used_at) return { valid: false, reason: "used" };
  if (new Date(row.expires_at).getTime() < Date.now()) return { valid: false, reason: "expired" };

  return {
    valid: true,
    userId: row.user_id,
    name: row.name,
    email: row.email,
    purpose: row.purpose,
    tokenId: row.id
  };
}

/**
 * Consume a token and set the password, in one transaction.
 *
 * Marking used and writing the password together is what stops two concurrent
 * submissions of the same link both succeeding. The UPDATE is conditional on
 * used_at still being NULL, so the second one changes zero rows and loses.
 */
export function consumeSetupToken(token: string, passwordHash: string): boolean {
  const db = getDb();
  const check = checkSetupToken(token);
  if (!check.valid) return false;

  let ok = false;
  db.transaction(() => {
    const claimed = db
      .prepare(`UPDATE account_setup_tokens SET used_at = datetime('now') WHERE id = ? AND used_at IS NULL`)
      .run(check.tokenId).changes;
    if (claimed !== 1) return; // somebody else got there first

    db.prepare(`UPDATE users SET password_hash = ?, password_changed_at = datetime('now') WHERE id = ?`).run(
      passwordHash,
      check.userId
    );
    db.prepare(
      `INSERT INTO activity_log (id, user_id, action, entity_type, entity_id, details)
       VALUES (?, ?, 'PASSWORD_SET', 'USER', ?, 'Set their password from a setup link')`
    ).run(newId("log"), check.userId, check.userId);
    ok = true;
  })();

  return ok;
}

/** Accounts created but never set up — the admin's "who still needs a link" list. */
export function getPendingSetups() {
  const db = getDb();
  return db
    .prepare(
      `SELECT u.id, u.name, u.email, u.created_at,
              (SELECT MAX(t.expires_at) FROM account_setup_tokens t
                WHERE t.user_id = u.id AND t.used_at IS NULL) AS link_expires_at
         FROM users u
        WHERE u.password_hash = '' AND u.is_active = 1
        ORDER BY u.created_at DESC`
    )
    .all() as Array<{
    id: string;
    name: string;
    email: string;
    created_at: string;
    link_expires_at: string | null;
  }>;
}

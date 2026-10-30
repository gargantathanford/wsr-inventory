/**
 * Mail seam.
 *
 * There is no provider here, no API key and no dependency — on purpose. For
 * twenty people a setup link handed over in person or on Signal is better than
 * email: no deliverability risk, no secret to manage, and the link cannot sit
 * unread in an inbox for a year.
 *
 * What this file buys is that every future call site goes through ONE function.
 * When the dashboard needs email for real — and the only thing that genuinely
 * requires it is self-service password reset for people an admin cannot reach —
 * adding a provider is this file and a config value, not an archaeology
 * expedition through every place that should have sent something.
 *
 * Deliverability is the hard part, not sending. A real provider needs SPF,
 * DKIM and DMARC on the sending domain, a reputation that starts at zero, and
 * bounce handling. Get it wrong and password-reset mail lands in spam, which
 * is worse than having no reset at all because people conclude the account is
 * broken rather than checking junk.
 *
 * ---------------------------------------------------------------------------
 * ADDING A PROVIDER LATER
 *
 *   1. Implement a Driver below (one function, three fields).
 *   2. Select it in resolveDriver() on an env var.
 *   3. Nothing else changes.
 *
 * Until then `logDriver` prints what WOULD have been sent, so a flow that
 * depends on mail can be developed and tested end to end without one.
 * ---------------------------------------------------------------------------
 */

export interface Mail {
  to: string;
  subject: string;
  /** Plain text only. HTML mail is a deliverability and rendering problem nobody here needs. */
  text: string;
}

export type MailResult =
  | { ok: true; driver: string; id?: string }
  | { ok: false; driver: string; error: string };

export interface Driver {
  name: string;
  send(mail: Mail): Promise<MailResult>;
}

/**
 * Development driver: logs the message instead of sending it.
 *
 * Returns ok, because a flow under test should proceed to its next step rather
 * than take an error path that will not exist in production.
 */
const logDriver: Driver = {
  name: "log",
  async send(mail) {
    console.log(
      [
        "",
        "─── mail (not sent — no provider configured) ───",
        `to      : ${mail.to}`,
        `subject : ${mail.subject}`,
        "",
        mail.text,
        "───────────────────────────────────────────────",
        ""
      ].join("\n")
    );
    return { ok: true, driver: "log" };
  }
};

/**
 * Production driver when none is configured: refuses, loudly.
 *
 * Silently dropping mail in production is the worst of the options — the
 * person never receives it, nothing errors, and the admin assumes it was sent.
 * Refusing means the caller has to decide what to do, which for setup links
 * means falling back to handing over the link directly.
 */
const unconfiguredDriver: Driver = {
  name: "unconfigured",
  async send() {
    return {
      ok: false,
      driver: "unconfigured",
      error:
        "No mail provider is configured. Set MAIL_DRIVER and implement a driver in lib/mailer.ts, " +
        "or hand the link over directly."
    };
  }
};

function resolveDriver(): Driver {
  switch (process.env.MAIL_DRIVER) {
    case "log":
      return logDriver;
    // case "resend": return resendDriver;   <- add here
    default:
      return process.env.NODE_ENV === "production" ? unconfiguredDriver : logDriver;
  }
}

/**
 * Send one message.
 *
 * NEVER throws. A failure to send must not roll back whatever the caller was
 * doing — creating an account has to succeed even when the notification about
 * it does not, or an admin ends up with no account AND no link.
 */
export async function sendMail(mail: Mail): Promise<MailResult> {
  const driver = resolveDriver();
  try {
    return await driver.send(mail);
  } catch (err) {
    return { ok: false, driver: driver.name, error: err instanceof Error ? err.message : "unknown error" };
  }
}

/** Whether a real provider is wired up — lets the UI say "emailed" or "copy this link". */
export function mailIsConfigured(): boolean {
  return resolveDriver().name !== "unconfigured" && resolveDriver().name !== "log";
}

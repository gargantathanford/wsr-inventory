/**
 * Should the session cookie be marked Secure for this request?
 *
 * THE PROBLEM. In production the cookie is Secure, which is correct and must
 * stay that way. But the container runs NODE_ENV=production even when someone
 * is testing on the shop Wi-Fi, so opening http://192.168.1.x:3000 on a phone
 * gets a successful login whose cookie the browser then refuses to store —
 * and the only symptom is being bounced straight back to the sign-in page,
 * with no error anywhere to explain it.
 *
 * THE FIX, and why it is safe. Secure is relaxed ONLY when the request's Host
 * is a private address — a LAN IP, localhost, or a .local name. It is
 * self-limiting: a real deployment is reached by its domain name, so Host is
 * never a private address there and the cookie stays Secure no matter how the
 * environment is configured. There is deliberately no flag to turn this on,
 * because a flag that disables Secure cookies is exactly the kind of thing
 * that ends up set in production and forgotten.
 *
 * A request that arrives through a reverse proxy carries the public hostname
 * in Host, so Caddy and nginx in front of this app are unaffected.
 */

/** RFC1918 and friends: the addresses a phone on the same Wi-Fi would use. */
const PRIVATE_HOST =
  /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[a-z0-9-]+\.local)$/i;

export function isPrivateHost(host: string | null | undefined): boolean {
  if (!host) return false;
  // Strip the port, and the brackets around a literal IPv6 address.
  const name = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  return PRIVATE_HOST.test(name);
}

/**
 * Secure in production, except when the request came over a private network.
 *
 * `forwarded` is the X-Forwarded-Proto header: when a proxy says the original
 * request was https, keep the cookie Secure even if Host looks private, since
 * the browser's connection genuinely was encrypted.
 */
export function shouldUseSecureCookie(host: string | null, forwardedProto?: string | null): boolean {
  if (process.env.NODE_ENV !== "production") return false;
  if (forwardedProto === "https") return true;
  return !isPrivateHost(host);
}

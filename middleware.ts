import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { getSessionSecretString } from "./lib/env";

const SESSION_COOKIE = "wsr_session";
const secretKey = new TextEncoder().encode(getSessionSecretString());

const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/health"];

/**
 * Brand assets in public/. These must be reachable WITHOUT a session, because
 * the login page itself renders the logo — gated, they 307 to /login and the
 * mark silently fails to load on every screen.
 *
 * Listed explicitly rather than allowing any path that looks like a file.
 * Uploaded documents are served through /api/files and stay behind auth; a
 * blanket "has a file extension" rule would be one careless route away from
 * exposing them.
 */
const PUBLIC_ASSETS = new Set(["/wsr-logo.png", "/icon.png", "/apple-icon.png", "/favicon.ico"]);

function withSecurityHeaders(res: NextResponse) {
  // Baseline hardening: established header-level mitigations, not custom cryptography.
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "same-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return res;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    PUBLIC_PATHS.includes(pathname) ||
    PUBLIC_ASSETS.has(pathname) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon")
  ) {
    return withSecurityHeaders(NextResponse.next());
  }

  // Lightweight CSRF backstop: for any state-changing API call, require the request to
  // have originated from this same origin. Combined with the SameSite=lax session
  // cookie, this closes the classic "malicious site auto-submits a form to our API"
  // vector without needing a separate CSRF token scheme.
  if (pathname.startsWith("/api") && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.headers.get("origin");
    // Compare against the Host header (what the browser actually addressed),
    // not req.nextUrl.host — behind Docker port-forwarding and reverse proxies
    // nextUrl.host reflects the container's internal view, not the browser's,
    // which caused legitimate same-origin requests to be rejected. The Host
    // header is what a reverse proxy rewrites to the real public domain, so
    // this is also the correct comparison in production behind Caddy/nginx.
    const host = req.headers.get("host");
    if (origin && host && new URL(origin).host !== host) {
      return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
    }
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  let valid = false;
  if (token) {
    try {
      await jwtVerify(token, secretKey);
      valid = true;
    } catch {
      valid = false;
    }
  }

  if (!valid) {
    if (pathname.startsWith("/api")) {
      return withSecurityHeaders(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return withSecurityHeaders(NextResponse.redirect(loginUrl));
  }

  return withSecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};

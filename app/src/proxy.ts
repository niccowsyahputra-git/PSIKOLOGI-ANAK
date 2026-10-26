import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic routing guard (section 4, section 12.4). Proxy only checks that a
 * session cookie *exists* so an anonymous visitor never sees a staff shell; the
 * real authorization is the per-request session + membership lookup performed
 * by `requireStaffSession()` in every page and `requireStaffSessionForApi()` in
 * every route handler. API routes are intentionally not matched: they answer
 * with a 401 envelope instead of an HTML redirect.
 */
const PROTECTED_PREFIXES = ["/dashboard", "/admin", "/children", "/guardians", "/cycles", "/assessments", "/instruments"] as const;

const SESSION_COOKIE_NAMES = [
  "better-auth.session_token",
  "__Secure-better-auth.session_token",
] as const;

function hasSessionCookie(request: NextRequest): boolean {
  return SESSION_COOKIE_NAMES.some((name) => Boolean(request.cookies.get(name)?.value));
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const authenticated = hasSessionCookie(request);
  const participant = Boolean(request.cookies.get("panti.intake")?.value);

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (isProtected && participant) {
    return NextResponse.redirect(new URL("/intake", request.url));
  }

  if (isProtected && !authenticated) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (pathname === "/login" && authenticated && !participant) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*", "/children/:path*", "/guardians/:path*", "/cycles/:path*", "/assessments/:path*", "/instruments/:path*", "/login"],
};

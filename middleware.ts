import { NextRequest, NextResponse } from 'next/server';

/**
 * CSRF protection for cookie-authenticated mutations (issue #96).
 *
 * Cookie-authenticated state-changing requests must prove they originate from
 * our own site. We enforce this with two layers:
 *
 *  1. Origin/Referer check — the request's Origin (or Referer fallback) must
 *     match the request host. This rejects hostile cross-site requests before
 *     any write or external transaction happens.
 *  2. Double-submit token — a `csrf_token` cookie must be echoed in the
 *     `x-csrf-token` header. The token is issued by the app on session start.
 *
 * Safe methods (GET/HEAD/OPTIONS) are never blocked.
 *
 * Local development / same-origin proxying:
 *  - Requests with no Origin and no Referer (e.g. curl, server-to-server) are
 *    allowed only when NODE_ENV !== 'production', so local dev keeps working.
 *  - Same-origin API proxying (e.g. /api/* behind a reverse proxy) is fine as
 *    long as the proxy forwards the original Origin/Referer and Host headers.
 *    If the proxy rewrites Host, set CSRF_TRUSTED_ORIGINS to the public origin.
 *
 * Rollout: no data migration required. Existing sessions without a csrf_token
 * cookie will be rejected on their next mutation; the client should fetch a
 * token (GET /api/auth/csrf) and retry. Deploy the token issuer before or
 * together with this middleware.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CSRF_COOKIE = 'csrf_token';
const CSRF_HEADER = 'x-csrf-token';

function trustedOrigins(): string[] {
  const raw = process.env.CSRF_TRUSTED_ORIGINS ?? '';
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function originOf(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function requestOrigin(req: NextRequest): string {
  const proto = req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(':', '');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? req.nextUrl.host;
  return `${proto}://${host}`;
}

function isSameOrigin(req: NextRequest): boolean {
  const expected = requestOrigin(req);
  const allowed = new Set([expected, ...trustedOrigins()]);

  const origin = originOf(req.headers.get('origin'));
  if (origin) return allowed.has(origin);

  const referer = originOf(req.headers.get('referer'));
  if (referer) return allowed.has(referer);

  // No Origin/Referer: allow only outside production (local dev, curl, SSR).
  return process.env.NODE_ENV !== 'production';
}

function hasValidToken(req: NextRequest): boolean {
  const cookieToken = req.cookies.get(CSRF_COOKIE)?.value;
  const headerToken = req.headers.get(CSRF_HEADER);
  if (!cookieToken || !headerToken) return false;
  if (cookieToken.length !== headerToken.length) return false;

  // Constant-time-ish comparison to avoid trivial timing leaks.
  let mismatch = 0;
  for (let i = 0; i < cookieToken.length; i += 1) {
    mismatch |= cookieToken.charCodeAt(i) ^ headerToken.charCodeAt(i);
  }
  return mismatch === 0;
}

export function middleware(req: NextRequest) {
  if (SAFE_METHODS.has(req.method)) {
    return NextResponse.next();
  }

  if (!isSameOrigin(req)) {
    return NextResponse.json(
      { error: 'csrf_origin_rejected' },
      { status: 403 },
    );
  }

  if (!hasValidToken(req)) {
    return NextResponse.json(
      { error: 'csrf_token_invalid' },
      { status: 403 },
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};

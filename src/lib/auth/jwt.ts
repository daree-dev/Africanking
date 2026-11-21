import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

const ISSUER = process.env.JWT_ISSUER ?? 'coop-credits';
const AUDIENCE = process.env.JWT_AUDIENCE ?? 'coop-credits-web';
const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8h bounded session lifetime

export const SESSION_COOKIE_NAME = 'session';

/**
 * Cookie attributes for the session JWT.
 *
 * CSRF assumptions: the cookie is HttpOnly (no JS access), Secure in
 * production (never sent over plaintext), and SameSite=Lax. Lax allows
 * top-level navigations (GET) to carry the cookie while blocking it on
 * cross-site subrequests/POSTs, which is the primary CSRF defense here.
 * State-changing API routes must still be same-origin and are additionally
 * protected by the rate limiter; do not relax SameSite without adding an
 * explicit CSRF token check.
 */
export function sessionCookieOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  };
}

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not configured');
  }
  return new TextEncoder().encode(secret);
}

export interface SessionClaims extends JWTPayload {
  sub: string;
  /** Session version; bumping it revokes all prior tokens for the user. */
  ver?: number;
}

export async function signSession(
  userId: string,
  version = 0,
): Promise<string> {
  return new SignJWT({ ver: version })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecret());
}

/**
 * Verify a session token. Rejects expired, malformed, wrong-audience, and
 * wrong-issuer tokens consistently by returning null instead of throwing.
 */
export async function verifySession(
  token: string | undefined | null,
): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    });
    if (typeof payload.sub !== 'string' || !payload.sub) return null;
    return payload as SessionClaims;
  } catch {
    return null;
  }
}

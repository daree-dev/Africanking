import { cookies } from "next/headers";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";

/**
 * Session / JWT lifecycle helpers.
 *
 * CSRF assumptions:
 * - Session cookies are HttpOnly and SameSite=Lax. Lax blocks cross-site
 *   sub-requests (POST/PUT/DELETE) from carrying the cookie, which is the
 *   primary CSRF defense for state-changing routes. Same-site navigations
 *   (top-level GET) still send the cookie, so read-only routes must remain
 *   side-effect free.
 * - Secure is enabled in production so the cookie is never sent over plain
 *   HTTP. In non-production it is disabled to allow local http:// dev.
 * - Any state-changing API route should additionally validate Origin/Host
 *   for defense in depth; the cookie policy alone is not a substitute.
 */

export const SESSION_COOKIE_NAME = "session";

/** Bounded session lifetime (seconds). */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

const SESSION_ISSUER = "handsoff";
const SESSION_AUDIENCE = "handsoff:web";

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET ?? process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is not configured");
  }
  return new TextEncoder().encode(secret);
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export interface SessionClaims extends JWTPayload {
  sub: string;
  /** Session id used for rotation/revocation bookkeeping. */
  sid: string;
}

export interface SessionCookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
}

/**
 * Cookie attributes applied to every session cookie write.
 * Exported so tests can assert the security posture directly.
 */
export function getSessionCookieOptions(): SessionCookieOptions {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

/**
 * Issue a signed session token with bounded lifetime, issuer and audience.
 */
export async function createSessionToken(
  userId: string,
  sessionId: string = crypto.randomUUID(),
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(SESSION_ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + SESSION_MAX_AGE_SECONDS)
    .sign(getSecret());
}

/**
 * Verify a session token. Rejects expired, malformed, wrong-audience and
 * wrong-issuer tokens consistently by throwing a single error type.
 */
export async function verifySessionToken(token: string): Promise<SessionClaims> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: SESSION_ISSUER,
      audience: SESSION_AUDIENCE,
      algorithms: ["HS256"],
    });

    if (typeof payload.sub !== "string" || typeof payload.sid !== "string") {
      throw new Error("invalid session claims");
    }

    return payload as SessionClaims;
  } catch {
    throw new Error("Invalid or expired session token");
  }
}

/**
 * Persist a freshly issued session cookie. Used on login and on rotation
 * (credential change / account linking) so the previous token is replaced.
 */
export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, getSessionCookieOptions());
}

/**
 * Clear the session cookie. Used on logout and after credential changes so
 * the browser drops the token immediately.
 */
export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, "", {
    ...getSessionCookieOptions(),
    maxAge: 0,
  });
}

/**
 * Read and verify the current session from the request cookies.
 * Returns null for missing, expired, malformed, wrong-audience or
 * wrong-issuer tokens.
 */
export async function getSession(): Promise<SessionClaims | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    return await verifySessionToken(token);
  } catch {
    return null;
  }
}

/**
 * Rotate the session: issue a new token (new sid) and replace the cookie.
 * Call on credential changes and account linking to invalidate the prior
 * session id.
 */
export async function rotateSession(userId: string): Promise<string> {
  const token = await createSessionToken(userId);
  await setSessionCookie(token);
  return token;
}

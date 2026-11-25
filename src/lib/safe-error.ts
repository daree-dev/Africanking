/**
 * Audit-safe error and logging utilities.
 *
 * Guarantees that logs and error responses never expose JWTs, wallet
 * signatures, email tokens, service keys, or raw meter payloads containing
 * sensitive identifiers. Callers should route every logging boundary and
 * every error response through these helpers.
 */

/** Canonical set of field names that must never be logged or returned raw. */
export const SENSITIVE_FIELDS = [
  'authorization',
  'cookie',
  'set-cookie',
  'password',
  'passwordhash',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'jwt',
  'signature',
  'walletsignature',
  'signedmessage',
  'emailtoken',
  'verificationtoken',
  'resettoken',
  'apikey',
  'servicekey',
  'secret',
  'clientsecret',
  'privatekey',
  'meterpayload',
  'meterreading',
  'meterid',
  'serialnumber',
] as const;

const SENSITIVE_SET = new Set<string>(SENSITIVE_FIELDS);
const REDACTED = '[REDACTED]';

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_\s]/g, '');
  if (SENSITIVE_SET.has(normalized)) return true;
  // Catch suffixed variants like `userEmailToken` or `x-service-key`.
  for (const field of SENSITIVE_FIELDS) {
    if (normalized.endsWith(field)) return true;
  }
  return false;
}

/**
 * Recursively redact sensitive fields from an arbitrary value so it is safe to
 * log or serialize into a response. Handles nested objects and arrays and
 * guards against cycles.
 */
export function redact<T>(value: T, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value as object)) return '[Circular]';
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, seen));
  }

  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveKey(key) ? REDACTED : redact(val, seen);
  }
  return out;
}

/** Structured, redacted log entry. */
export interface SafeLogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  correlationId: string;
  code?: string;
  context?: unknown;
}

/**
 * Emit a structured log line with all context redacted. This is the single
 * logging boundary; do not call console.* directly with raw payloads.
 */
export function logSafe(entry: SafeLogEntry): void {
  const payload = {
    level: entry.level,
    message: entry.message,
    correlationId: entry.correlationId,
    ...(entry.code ? { code: entry.code } : {}),
    ...(entry.context !== undefined ? { context: redact(entry.context) } : {}),
  };
  const line = JSON.stringify(payload);
  if (entry.level === 'error') console.error(line);
  else if (entry.level === 'warn') console.warn(line);
  else console.log(line);
}

/** Safe error body returned to clients: correlation id + code, never raw detail. */
export interface SafeErrorResponse {
  error: {
    code: string;
    correlationId: string;
    message: string;
  };
}

const SAFE_MESSAGES: Record<string, string> = {
  AUTH_FAILED: 'Authentication failed.',
  FORBIDDEN: 'You do not have permission to perform this action.',
  VALIDATION_FAILED: 'The request could not be validated.',
  INGESTION_FAILED: 'The meter reading could not be processed.',
  DATABASE_ERROR: 'A storage error occurred.',
  STELLAR_ERROR: 'The Stellar operation could not be completed.',
  RATE_LIMITED: 'Too many requests. Please try again later.',
  INTERNAL_ERROR: 'An unexpected error occurred.',
};

/**
 * Build a safe error response. Raw provider/database exception content is
 * logged (redacted) but never returned to the caller.
 */
export function toSafeError(
  code: string,
  correlationId: string,
  cause?: unknown,
): SafeErrorResponse {
  const safeCode = SAFE_MESSAGES[code] ? code : 'INTERNAL_ERROR';
  if (cause !== undefined) {
    logSafe({
      level: 'error',
      message: 'request failed',
      correlationId,
      code: safeCode,
      context: cause,
    });
  }
  return {
    error: {
      code: safeCode,
      correlationId,
      message: SAFE_MESSAGES[safeCode],
    },
  };
}

/**
 * Test utility: scan captured logs/responses for any secret fixture value.
 * Returns the list of leaked secrets (empty when clean).
 */
export function findLeakedSecrets(
  captured: unknown,
  secretFixtures: readonly string[],
): string[] {
  const haystack = typeof captured === 'string' ? captured : JSON.stringify(captured);
  return secretFixtures.filter((secret) => secret.length > 0 && haystack.includes(secret));
}

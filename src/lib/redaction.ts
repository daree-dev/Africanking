/**
 * Audit-safe redaction utilities.
 *
 * Central place to define sensitive fields and scrub them from logs and
 * error responses. Logs and error paths must never expose JWTs, wallet
 * signatures, email tokens, service keys, or raw meter payloads that
 * contain sensitive identifiers.
 */

/** Canonical set of field names whose values must never be logged. */
export const SENSITIVE_FIELDS = [
  // Auth / session
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'idToken',
  'jwt',
  'authorization',
  'cookie',
  'set-cookie',
  'sessionId',
  'sessionToken',
  'csrfToken',
  // Wallet / Stellar
  'signature',
  'signedXdr',
  'xdr',
  'secretKey',
  'privateKey',
  'seed',
  'mnemonic',
  // Email / verification
  'emailToken',
  'verificationToken',
  'resetToken',
  'email',
  // Service keys / secrets
  'apiKey',
  'serviceKey',
  'secret',
  'clientSecret',
  'webhookSecret',
  // Raw meter payloads with sensitive identifiers
  'meterPayload',
  'rawPayload',
  'meterReading',
  'meterId',
  'deviceId',
] as const;

export type SensitiveField = (typeof SENSITIVE_FIELDS)[number];

const SENSITIVE_FIELD_SET: ReadonlySet<string> = new Set(
  SENSITIVE_FIELDS.map((f) => f.toLowerCase()),
);

const REDACTED = '[REDACTED]';

/**
 * Patterns that catch secrets embedded in free-form strings (e.g. error
 * messages or stack traces) even when they are not keyed by a known field.
 */
const SECRET_PATTERNS: ReadonlyArray<RegExp> = [
  // JWT (three base64url segments)
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  // Bearer tokens
  /\bBearer\s+[A-Za-z0-9._-]+/gi,
  // Stellar secret seeds (S...)
  /\bS[A-Z2-7]{55}\b/g,
  // Stellar public keys (G...) — sensitive identifier in meter payloads
  /\bG[A-Z2-7]{55}\b/g,
  // Generic long hex/base64 secrets
  /\b[A-Fa-f0-9]{64}\b/g,
];

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_FIELD_SET.has(key.toLowerCase());
}

function redactString(value: string): string {
  let result = value;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, REDACTED);
  }
  return result;
}

/**
 * Recursively redact sensitive fields and embedded secrets from an arbitrary
 * value. Safe to call on objects, arrays, strings, and primitives. Handles
 * circular references.
 */
export function redact<T>(value: T, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return redactString(value);
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (seen.has(value as object)) {
    return '[Circular]';
  }
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, seen));
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      // Stack traces can leak provider/database internals; omit them.
    };
  }

  const output: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    output[key] = isSensitiveKey(key) ? REDACTED : redact(val, seen);
  }
  return output;
}

/**
 * Build a structured, audit-safe log entry. Always includes a correlation ID
 * so operators can trace a request without exposing raw payloads.
 */
export function safeLog(
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  context: Record<string, unknown> = {},
  correlationId?: string,
): Record<string, unknown> {
  return {
    level,
    message: redactString(message),
    correlationId: correlationId ?? null,
    context: redact(context),
    timestamp: new Date().toISOString(),
  };
}

/** Safe error codes returned to clients instead of raw exception content. */
export const SAFE_ERROR_CODES = {
  AUTH_FAILED: 'AUTH_FAILED',
  INVALID_REQUEST: 'INVALID_REQUEST',
  INGESTION_FAILED: 'INGESTION_FAILED',
  DATABASE_ERROR: 'DATABASE_ERROR',
  STELLAR_ERROR: 'STELLAR_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type SafeErrorCode = (typeof SAFE_ERROR_CODES)[keyof typeof SAFE_ERROR_CODES];

/**
 * Produce a client-safe error response. Never includes raw provider or
 * database exception content — only a safe code, a generic message, and a
 * correlation ID for support.
 */
export function safeErrorResponse(
  code: SafeErrorCode,
  correlationId: string,
  message = 'An unexpected error occurred.',
): { error: { code: SafeErrorCode; message: string; correlationId: string } } {
  return {
    error: {
      code,
      message: redactString(message),
      correlationId,
    },
  };
}

/**
 * Test utility: scan captured logs and responses for any of the provided
 * secret fixture values. Returns the list of leaked secrets (empty when
 * clean). Intended for use in redaction tests across auth, ingestion,
 * database, and Stellar failure paths.
 */
export function findLeakedSecrets(
  captured: unknown,
  secretFixtures: ReadonlyArray<string>,
): string[] {
  const haystack = JSON.stringify(captured ?? '');
  return secretFixtures.filter(
    (secret) => secret.length > 0 && haystack.includes(secret),
  );
}

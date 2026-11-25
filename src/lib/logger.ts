/**
 * Audit-safe logging and error utilities.
 *
 * Every logging boundary and error path must pass through this module so that
 * JWTs, wallet signatures, email tokens, service keys, and raw meter payloads
 * containing sensitive identifiers never reach logs or API responses.
 */

/** Canonical set of field names whose values must never be logged. */
export const SENSITIVE_FIELDS = [
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'idToken',
  'jwt',
  'authorization',
  'cookie',
  'setCookie',
  'signature',
  'walletSignature',
  'signedPayload',
  'emailToken',
  'verificationToken',
  'resetToken',
  'apiKey',
  'serviceKey',
  'secret',
  'privateKey',
  'clientSecret',
  'meterPayload',
  'rawMeterPayload',
  'meterReading',
  'meterId',
  'serialNumber',
] as const;

const SENSITIVE_FIELD_SET = new Set<string>(
  SENSITIVE_FIELDS.map((f) => f.toLowerCase()),
);

const REDACTED = '[REDACTED]';
const MAX_DEPTH = 6;

/** Safe error codes returned to clients instead of raw exception content. */
export type SafeErrorCode =
  | 'AUTH_FAILED'
  | 'FORBIDDEN'
  | 'VALIDATION_FAILED'
  | 'INGESTION_FAILED'
  | 'DATABASE_ERROR'
  | 'STELLAR_ERROR'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export interface SafeError {
  code: SafeErrorCode;
  correlationId: string;
  message: string;
}

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (SENSITIVE_FIELD_SET.has(lower)) return true;
  // Catch variants like `userToken`, `x-api-key`, `wallet_signature`.
  return SENSITIVE_FIELDS.some((field) =>
    lower.includes(field.toLowerCase()),
  );
}

/**
 * Recursively redact sensitive fields from an arbitrary value.
 * Returns a structurally similar value safe for logging.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > MAX_DEPTH) return '[TRUNCATED]';

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1));
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      // Stack traces can embed secrets; never log them raw.
      stack: REDACTED,
    };
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key) ? REDACTED : redact(val, depth + 1);
    }
    return out;
  }

  return value;
}

/** Generate a correlation ID for tracing without exposing internals. */
export function newCorrelationId(): string {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  return `cid_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Build a safe error payload for API responses. Raw provider/database
 * exception content is discarded; only a code and correlation ID are returned.
 */
export function toSafeError(
  code: SafeErrorCode,
  correlationId: string = newCorrelationId(),
  message = 'Request could not be completed',
): SafeError {
  return { code, correlationId, message };
}

/**
 * Map an unknown thrown value to a safe error code without leaking details.
 */
export function classifyError(error: unknown): SafeErrorCode {
  const name = error instanceof Error ? error.name : '';
  const msg = error instanceof Error ? error.message.toLowerCase() : '';
  if (name === 'JsonWebTokenError' || name === 'TokenExpiredError') {
    return 'AUTH_FAILED';
  }
  if (msg.includes('stellar') || msg.includes('horizon')) return 'STELLAR_ERROR';
  if (msg.includes('prisma') || msg.includes('database') || msg.includes('sql')) {
    return 'DATABASE_ERROR';
  }
  if (msg.includes('meter') || msg.includes('ingest')) return 'INGESTION_FAILED';
  return 'INTERNAL_ERROR';
}

export interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  correlationId?: string;
  [key: string]: unknown;
}

/** Structured, redacted log emission. */
export function log(entry: LogEntry): void {
  const safe = redact(entry) as Record<string, unknown>;
  const line = JSON.stringify(safe);
  if (entry.level === 'error') {
    console.error(line);
  } else if (entry.level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

/** Log an error path safely and return the client-facing safe error. */
export function logError(
  error: unknown,
  context: Record<string, unknown> = {},
  correlationId: string = newCorrelationId(),
): SafeError {
  const code = classifyError(error);
  log({
    level: 'error',
    message: 'request_failed',
    correlationId,
    code,
    ...context,
  });
  return toSafeError(code, correlationId);
}

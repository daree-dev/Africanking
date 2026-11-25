/**
 * Shared resilience primitives for external API dependencies
 * (Supabase, Stellar RPC, mail, providers).
 *
 * - Classifies retryable vs non-retryable errors.
 * - Applies bounded timeouts + exponential backoff with jitter, but only to
 *   idempotent operations (non-idempotent writes are never retried to avoid
 *   duplicate writes).
 * - Provides a per-dependency circuit breaker and concurrency limiter so a
 *   saturated dependency cannot cascade into request pileups.
 * - Surfaces degraded dependency state via a typed error instead of turning
 *   failures into success-shaped responses.
 */

export type DependencyName = 'supabase' | 'stellar' | 'mail' | 'provider';

export type DependencyState = 'closed' | 'open' | 'half-open';

export interface DependencyStatus {
  name: DependencyName;
  state: DependencyState;
  consecutiveFailures: number;
  openedAt: number | null;
  nextRetryAt: number | null;
}

export interface ResilienceOptions {
  /** Per-attempt timeout in ms. */
  timeoutMs?: number;
  /** Max retry attempts (excluding the initial attempt). */
  maxRetries?: number;
  /** Base backoff in ms (exponential, with jitter). */
  baseBackoffMs?: number;
  /** Max backoff cap in ms. */
  maxBackoffMs?: number;
  /** Max concurrent in-flight calls per dependency. */
  maxConcurrency?: number;
  /** Consecutive failures before the breaker opens. */
  failureThreshold?: number;
  /** How long the breaker stays open before probing (ms). */
  resetTimeoutMs?: number;
  /** Whether the operation is safe to retry (idempotent). Defaults to false. */
  idempotent?: boolean;
}

const DEFAULTS: Required<Omit<ResilienceOptions, 'idempotent'>> = {
  timeoutMs: 5_000,
  maxRetries: 2,
  baseBackoffMs: 200,
  maxBackoffMs: 2_000,
  maxConcurrency: 8,
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
};

/** Error raised when a dependency is degraded (breaker open / saturated). */
export class DependencyDegradedError extends Error {
  readonly dependency: DependencyName;
  readonly state: DependencyState;
  readonly retryAfterMs: number | null;

  constructor(dependency: DependencyName, state: DependencyState, retryAfterMs: number | null) {
    super(`Dependency "${dependency}" is degraded (${state})`);
    this.name = 'DependencyDegradedError';
    this.dependency = dependency;
    this.state = state;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Error raised when a dependency call exceeds its bounded timeout. */
export class DependencyTimeoutError extends Error {
  readonly dependency: DependencyName;

  constructor(dependency: DependencyName, timeoutMs: number) {
    super(`Dependency "${dependency}" timed out after ${timeoutMs}ms`);
    this.name = 'DependencyTimeoutError';
    this.dependency = dependency;
  }
}

interface BreakerState {
  state: DependencyState;
  consecutiveFailures: number;
  openedAt: number | null;
  inFlight: number;
}

const breakers = new Map<DependencyName, BreakerState>();

function getBreaker(name: DependencyName): BreakerState {
  let b = breakers.get(name);
  if (!b) {
    b = { state: 'closed', consecutiveFailures: 0, openedAt: null, inFlight: 0 };
    breakers.set(name, b);
  }
  return b;
}

/** Read-only snapshot of a dependency's current health. */
export function getDependencyStatus(name: DependencyName): DependencyStatus {
  const b = getBreaker(name);
  const nextRetryAt =
    b.state === 'open' && b.openedAt !== null ? b.openedAt + DEFAULTS.resetTimeoutMs : null;
  return {
    name,
    state: b.state,
    consecutiveFailures: b.consecutiveFailures,
    openedAt: b.openedAt,
    nextRetryAt,
  };
}

/** Snapshot of all known dependencies (for health/degraded reporting). */
export function getAllDependencyStatuses(): DependencyStatus[] {
  return Array.from(breakers.keys()).map(getDependencyStatus);
}

/**
 * Classify an error as retryable. Timeouts, 429 and 5xx are retryable;
 * other 4xx client errors are not.
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof DependencyTimeoutError) return true;
  if (error instanceof DependencyDegradedError) return false;

  const status = extractStatus(error);
  if (status !== null) {
    if (status === 429) return true;
    if (status >= 500 && status <= 599) return true;
    if (status >= 400 && status <= 499) return false;
  }

  const code = extractCode(error);
  if (code) {
    const retryableCodes = new Set([
      'ETIMEDOUT',
      'ECONNRESET',
      'ECONNREFUSED',
      'EAI_AGAIN',
      'ENOTFOUND',
      'UND_ERR_CONNECT_TIMEOUT',
      'UND_ERR_HEADERS_TIMEOUT',
      'UND_ERR_SOCKET',
    ]);
    if (retryableCodes.has(code)) return true;
  }

  return false;
}

function extractStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const e = error as Record<string, unknown>;
  const candidates = [e.status, e.statusCode, (e.response as Record<string, unknown> | undefined)?.status];
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c)) return c;
  }
  return null;
}

function extractCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const e = error as Record<string, unknown>;
  if (typeof e.code === 'string') return e.code;
  const cause = e.cause as Record<string, unknown> | undefined;
  if (cause && typeof cause.code === 'string') return cause.code;
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(attempt: number, base: number, cap: number): number {
  const exp = Math.min(cap, base * 2 ** attempt);
  // Full jitter to avoid synchronized retry storms.
  return Math.floor(Math.random() * exp);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, name: DependencyName): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new DependencyTimeoutError(name, timeoutMs)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function acquireSlot(b: BreakerState, maxConcurrency: number, name: DependencyName): void {
  if (b.inFlight >= maxConcurrency) {
    throw new DependencyDegradedError(name, b.state, null);
  }
  b.inFlight += 1;
}

function releaseSlot(b: BreakerState): void {
  if (b.inFlight > 0) b.inFlight -= 1;
}

function assertBreakerAllows(b: BreakerState, name: DependencyName, resetTimeoutMs: number): void {
  if (b.state === 'open') {
    const elapsed = b.openedAt !== null ? Date.now() - b.openedAt : 0;
    if (elapsed < resetTimeoutMs) {
      throw new DependencyDegradedError(name, 'open', resetTimeoutMs - elapsed);
    }
    // Probe: allow a single trial call through.
    b.state = 'half-open';
  }
}

function recordSuccess(b: BreakerState): void {
  b.consecutiveFailures = 0;
  b.state = 'closed';
  b.openedAt = null;
}

function recordFailure(b: BreakerState, failureThreshold: number): void {
  b.consecutiveFailures += 1;
  if (b.state === 'half-open' || b.consecutiveFailures >= failureThreshold) {
    b.state = 'open';
    b.openedAt = Date.now();
  }
}

/**
 * Execute a dependency call with bounded timeout, concurrency limit, circuit
 * breaker, and (for idempotent operations only) bounded retries with backoff.
 *
 * Non-idempotent operations are attempted exactly once so retries cannot
 * produce duplicate writes.
 */
export async function callDependency<T>(
  name: DependencyName,
  operation: () => Promise<T>,
  options: ResilienceOptions = {},
): Promise<T> {
  const opts = { ...DEFAULTS, ...options };
  const idempotent = options.idempotent === true;
  const b = getBreaker(name);

  assertBreakerAllows(b, name, opts.resetTimeoutMs);
  acquireSlot(b, opts.maxConcurrency, name);

  const maxAttempts = idempotent ? opts.maxRetries + 1 : 1;
  let lastError: unknown;

  try {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const result = await withTimeout(operation(), opts.timeoutMs, name);
        recordSuccess(b);
        return result;
      } catch (error) {
        lastError = error;
        const canRetry = idempotent && attempt < maxAttempts - 1 && isRetryableError(error);
        if (!canRetry) break;
        await sleep(backoffDelay(attempt, opts.baseBackoffMs, opts.maxBackoffMs));
      }
    }

    recordFailure(b, opts.failureThreshold);
    throw lastError;
  } finally {
    releaseSlot(b);
  }
}

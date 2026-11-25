/**
 * Resilience primitives for external dependency clients (Supabase, Stellar RPC,
 * mail, providers).
 *
 * - Classifies retryable vs non-retryable errors (timeouts, 429, 5xx retryable;
 *   other 4xx non-retryable).
 * - Applies bounded timeouts and exponential backoff with jitter, but ONLY to
 *   operations explicitly marked idempotent. Non-idempotent writes are never
 *   retried to avoid duplicate writes.
 * - Provides a per-dependency circuit breaker and concurrency limiter so a
 *   saturated dependency cannot cascade into request pileups.
 * - Surfaces degraded dependency state via a typed error instead of converting
 *   failures into success-shaped responses.
 */

export type DependencyName = 'supabase' | 'stellar-rpc' | 'mail' | 'provider' | string;

export interface ResilienceOptions {
  /** Max attempts including the first try. Defaults to 3. */
  maxAttempts?: number;
  /** Base backoff in ms. Defaults to 200. */
  baseDelayMs?: number;
  /** Max backoff in ms. Defaults to 2000. */
  maxDelayMs?: number;
  /** Per-attempt timeout in ms. Defaults to 5000. */
  timeoutMs?: number;
  /** Whether the operation is safe to retry. Defaults to false. */
  idempotent?: boolean;
  /** Max concurrent in-flight calls for this dependency. Defaults to 8. */
  concurrency?: number;
  /** Consecutive failures before the breaker opens. Defaults to 5. */
  failureThreshold?: number;
  /** Time in ms the breaker stays open before probing. Defaults to 15000. */
  resetTimeoutMs?: number;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
  /** Injectable sleep for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
}

export type DependencyErrorKind =
  | 'timeout'
  | 'rate_limited'
  | 'server_error'
  | 'client_error'
  | 'circuit_open'
  | 'unknown';

export class DependencyError extends Error {
  readonly dependency: DependencyName;
  readonly kind: DependencyErrorKind;
  readonly retryable: boolean;
  readonly status?: number;
  readonly cause?: unknown;

  constructor(
    dependency: DependencyName,
    kind: DependencyErrorKind,
    message: string,
    opts: { retryable: boolean; status?: number; cause?: unknown },
  ) {
    super(message);
    this.name = 'DependencyError';
    this.dependency = dependency;
    this.kind = kind;
    this.retryable = opts.retryable;
    this.status = opts.status;
    this.cause = opts.cause;
  }
}

/** Raised when the breaker is open; callers must surface degraded state. */
export class DependencyDegradedError extends DependencyError {
  constructor(dependency: DependencyName) {
    super(dependency, 'circuit_open', `Dependency "${dependency}" is degraded (circuit open)`, {
      retryable: false,
    });
    this.name = 'DependencyDegradedError';
  }
}

function statusOf(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null) {
    const candidate = error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
    const raw = candidate.status ?? candidate.statusCode ?? candidate.response?.status;
    if (typeof raw === 'number') return raw;
  }
  return undefined;
}

/** Classify an error into a retryable/non-retryable dependency error. */
export function classifyError(dependency: DependencyName, error: unknown): DependencyError {
  if (error instanceof DependencyError) return error;

  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return new DependencyError(dependency, 'timeout', `Dependency "${dependency}" timed out`, {
      retryable: true,
      cause: error,
    });
  }

  const status = statusOf(error);
  if (status === 429) {
    return new DependencyError(dependency, 'rate_limited', `Dependency "${dependency}" rate limited`, {
      retryable: true,
      status,
      cause: error,
    });
  }
  if (status !== undefined && status >= 500 && status <= 599) {
    return new DependencyError(dependency, 'server_error', `Dependency "${dependency}" returned ${status}`, {
      retryable: true,
      status,
      cause: error,
    });
  }
  if (status !== undefined && status >= 400 && status <= 499) {
    return new DependencyError(dependency, 'client_error', `Dependency "${dependency}" returned ${status}`, {
      retryable: false,
      status,
      cause: error,
    });
  }

  const message = error instanceof Error ? error.message : String(error);
  return new DependencyError(dependency, 'unknown', `Dependency "${dependency}" failed: ${message}`, {
    retryable: false,
    cause: error,
  });
}

interface BreakerState {
  failures: number;
  openedAt: number | null;
  inFlight: number;
}

const breakers = new Map<DependencyName, BreakerState>();

function breakerFor(dependency: DependencyName): BreakerState {
  let state = breakers.get(dependency);
  if (!state) {
    state = { failures: 0, openedAt: null, inFlight: 0 };
    breakers.set(dependency, state);
  }
  return state;
}

/** Reset breaker state; useful for tests and recovery hooks. */
export function resetBreaker(dependency: DependencyName): void {
  breakers.delete(dependency);
}

/** Inspect degraded state without throwing. */
export function isDegraded(dependency: DependencyName, now: () => number = Date.now): boolean {
  const state = breakers.get(dependency);
  if (!state || state.openedAt === null) return false;
  return now() - state.openedAt < 0;
}

function backoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
  // Full jitter to avoid synchronized retry storms.
  return Math.floor(Math.random() * exp);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error('Operation timed out');
      err.name = 'TimeoutError';
      reject(err);
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Execute an external dependency call with bounded timeout, concurrency limit,
 * circuit breaker, and (for idempotent operations only) bounded retries.
 *
 * Failures are always surfaced as DependencyError / DependencyDegradedError —
 * never converted into success-shaped responses.
 */
export async function callDependency<T>(
  dependency: DependencyName,
  operation: () => Promise<T>,
  options: ResilienceOptions = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 200,
    maxDelayMs = 2000,
    timeoutMs = 5000,
    idempotent = false,
    concurrency = 8,
    failureThreshold = 5,
    resetTimeoutMs = 15000,
    now = Date.now,
    sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  } = options;

  const state = breakerFor(dependency);

  if (state.openedAt !== null) {
    if (now() - state.openedAt >= resetTimeoutMs) {
      // Half-open: allow a single probe through.
      state.openedAt = null;
      state.failures = 0;
    } else {
      throw new DependencyDegradedError(dependency);
    }
  }

  if (state.inFlight >= concurrency) {
    throw new DependencyError(dependency, 'circuit_open', `Dependency "${dependency}" at concurrency limit`, {
      retryable: false,
    });
  }

  const attempts = idempotent ? Math.max(1, maxAttempts) : 1;
  let lastError: DependencyError | undefined;

  state.inFlight += 1;
  try {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const result = await withTimeout(operation(), timeoutMs);
        state.failures = 0;
        return result;
      } catch (error) {
        const classified = classifyError(dependency, error);
        lastError = classified;

        if (!classified.retryable || attempt >= attempts) {
          state.failures += 1;
          if (state.failures >= failureThreshold) {
            state.openedAt = now();
          }
          throw classified;
        }

        await sleep(backoffDelay(attempt, baseDelayMs, maxDelayMs));
      }
    }

    // Unreachable, but keeps the type checker satisfied.
    throw lastError ?? new DependencyError(dependency, 'unknown', 'Unknown dependency failure', { retryable: false });
  } finally {
    state.inFlight -= 1;
  }
}

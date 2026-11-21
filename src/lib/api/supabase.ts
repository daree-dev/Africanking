import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Reliability helpers for external dependencies (Supabase, Stellar RPC, mail, providers).
 *
 * - Retryable errors (timeouts, 429, 5xx) get bounded exponential backoff with jitter.
 * - Non-retryable errors (4xx client errors) fail fast.
 * - Retries are only applied to idempotent operations to avoid duplicate writes.
 * - A per-dependency circuit breaker prevents cascading saturation.
 * - Degraded dependency state is surfaced via `DependencyDegradedError` rather than
 *   being converted into success-shaped responses.
 */

export type DependencyName = 'supabase' | 'stellar' | 'mail' | 'provider';

export interface RetryOptions {
  /** Maximum number of attempts (including the first). Defaults to 3. */
  maxAttempts?: number;
  /** Base backoff in ms. Defaults to 200. */
  baseDelayMs?: number;
  /** Maximum backoff in ms. Defaults to 5000. */
  maxDelayMs?: number;
  /** Per-attempt timeout in ms. Defaults to 10000. */
  timeoutMs?: number;
  /** Whether the operation is idempotent (safe to retry). Defaults to false. */
  idempotent?: boolean;
}

export class DependencyDegradedError extends Error {
  readonly dependency: DependencyName;
  readonly cause?: unknown;

  constructor(dependency: DependencyName, message: string, cause?: unknown) {
    super(message);
    this.name = 'DependencyDegradedError';
    this.dependency = dependency;
    this.cause = cause;
  }
}

interface CircuitState {
  failures: number;
  openedAt: number | null;
}

const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_RESET_MS = 30_000;

const circuits: Record<string, CircuitState> = {};

function getCircuit(dependency: DependencyName): CircuitState {
  if (!circuits[dependency]) {
    circuits[dependency] = { failures: 0, openedAt: null };
  }
  return circuits[dependency];
}

function isCircuitOpen(dependency: DependencyName): boolean {
  const circuit = getCircuit(dependency);
  if (circuit.openedAt === null) return false;
  if (Date.now() - circuit.openedAt >= CIRCUIT_RESET_MS) {
    // Half-open: allow a probe request through.
    circuit.openedAt = null;
    circuit.failures = 0;
    return false;
  }
  return true;
}

function recordSuccess(dependency: DependencyName): void {
  const circuit = getCircuit(dependency);
  circuit.failures = 0;
  circuit.openedAt = null;
}

function recordFailure(dependency: DependencyName): void {
  const circuit = getCircuit(dependency);
  circuit.failures += 1;
  if (circuit.failures >= CIRCUIT_FAILURE_THRESHOLD) {
    circuit.openedAt = Date.now();
  }
}

function statusOf(error: unknown): number | undefined {
  if (error && typeof error === 'object') {
    const anyErr = error as { status?: number; statusCode?: number; code?: string };
    if (typeof anyErr.status === 'number') return anyErr.status;
    if (typeof anyErr.statusCode === 'number') return anyErr.statusCode;
  }
  return undefined;
}

function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const anyErr = error as { name?: string; code?: string; message?: string };
  if (anyErr.name === 'AbortError' || anyErr.name === 'TimeoutError') return true;
  if (anyErr.code === 'ETIMEDOUT' || anyErr.code === 'ECONNRESET') return true;
  return typeof anyErr.message === 'string' && /timeout|timed out/i.test(anyErr.message);
}

/** Classify whether an error is safe to retry. */
export function isRetryableError(error: unknown): boolean {
  if (isTimeoutError(error)) return true;
  const status = statusOf(error);
  if (status === undefined) return false;
  if (status === 429) return true;
  if (status >= 500 && status <= 599) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
  // Full jitter to avoid synchronized retry storms.
  return Math.floor(Math.random() * exp);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`Operation timed out after ${timeoutMs}ms`);
      err.name = 'TimeoutError';
      reject(err);
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Execute an operation against an external dependency with bounded retries,
 * timeouts, and circuit breaking.
 *
 * Non-idempotent operations are never retried; they still respect the circuit
 * breaker and timeout so saturation cannot cascade.
 */
export async function withDependencyResilience<T>(
  dependency: DependencyName,
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 200,
    maxDelayMs = 5000,
    timeoutMs = 10000,
    idempotent = false,
  } = options;

  if (isCircuitOpen(dependency)) {
    throw new DependencyDegradedError(
      dependency,
      `Dependency "${dependency}" is degraded (circuit open); request rejected.`,
    );
  }

  const attempts = idempotent ? Math.max(1, maxAttempts) : 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await withTimeout(operation(), timeoutMs);
      recordSuccess(dependency);
      return result;
    } catch (error) {
      lastError = error;
      const retryable = idempotent && isRetryableError(error);
      if (!retryable || attempt === attempts) {
        recordFailure(dependency);
        throw error;
      }
      await sleep(backoffDelay(attempt, baseDelayMs, maxDelayMs));
    }
  }

  recordFailure(dependency);
  throw lastError;
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase: SupabaseClient = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '');

export default supabase;

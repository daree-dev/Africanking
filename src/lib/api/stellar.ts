import { Horizon, SorobanRpc, Networks, Keypair, TransactionBuilder, Operation, Asset, BASE_FEE } from '@stellar/stellar-sdk';

const HORIZON_URL = process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org';
const SOROBAN_URL = process.env.STELLAR_SOROBAN_URL || 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;

const horizon = new Horizon.Server(HORIZON_URL);
const soroban = new SorobanRpc.Server(SOROBAN_URL);

// --- Reliability primitives -------------------------------------------------
// Bounded retries + circuit breaker for idempotent reads against Stellar RPC.
// Non-idempotent writes (submitTransaction) are never retried to avoid
// duplicate writes; they only get a bounded timeout.

export type DependencyState = 'closed' | 'open' | 'half-open';

export interface DependencyHealth {
  name: string;
  state: DependencyState;
  consecutiveFailures: number;
  openedAt: number | null;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 200;
const MAX_BACKOFF_MS = 2000;
const REQUEST_TIMEOUT_MS = 8000;
const FAILURE_THRESHOLD = 5;
const OPEN_COOLDOWN_MS = 15000;

class CircuitBreaker {
  private state: DependencyState = 'closed';
  private failures = 0;
  private openedAt: number | null = null;

  constructor(public readonly name: string) {}

  canAttempt(): boolean {
    if (this.state === 'open' && this.openedAt !== null) {
      if (Date.now() - this.openedAt >= OPEN_COOLDOWN_MS) {
        this.state = 'half-open';
        return true;
      }
      return false;
    }
    return true;
  }

  recordSuccess(): void {
    this.state = 'closed';
    this.failures = 0;
    this.openedAt = null;
  }

  recordFailure(): void {
    this.failures += 1;
    if (this.state === 'half-open' || this.failures >= FAILURE_THRESHOLD) {
      this.state = 'open';
      this.openedAt = Date.now();
    }
  }

  health(): DependencyHealth {
    return {
      name: this.name,
      state: this.state,
      consecutiveFailures: this.failures,
      openedAt: this.openedAt,
    };
  }
}

const breakers = {
  horizon: new CircuitBreaker('stellar-horizon'),
  soroban: new CircuitBreaker('stellar-soroban'),
};

export function getStellarDependencyHealth(): DependencyHealth[] {
  return [breakers.horizon.health(), breakers.soroban.health()];
}

export class DependencyUnavailableError extends Error {
  constructor(public readonly dependency: string, public readonly cause?: unknown) {
    super(`Dependency ${dependency} is unavailable (circuit open)`);
    this.name = 'DependencyUnavailableError';
  }
}

function isRetryableError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const status = (err as { response?: { status?: number } }).response?.status;
  if (typeof status === 'number') return RETRYABLE_STATUS.has(status);
  const code = (err as { code?: string }).code;
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED') return true;
  const name = (err as { name?: string }).name;
  return name === 'TimeoutError' || name === 'AbortError';
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(`Request timed out after ${ms}ms`);
      err.name = 'TimeoutError';
      reject(err);
    }, ms);
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

function backoffDelay(attempt: number): number {
  const exp = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
  return Math.floor(exp / 2 + Math.random() * (exp / 2));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
  breaker: CircuitBreaker,
  operation: () => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (!breaker.canAttempt()) {
      throw new DependencyUnavailableError(breaker.name, lastError);
    }
    try {
      const result = await withTimeout(operation(), REQUEST_TIMEOUT_MS);
      breaker.recordSuccess();
      return result;
    } catch (err) {
      lastError = err;
      breaker.recordFailure();
      if (!isRetryableError(err) || attempt === MAX_ATTEMPTS - 1) {
        throw err;
      }
      await sleep(backoffDelay(attempt));
    }
  }
  throw lastError;
}

// --- Public API -------------------------------------------------------------

export async function getAccount(publicKey: string) {
  return withRetry(breakers.horizon, () => horizon.loadAccount(publicKey));
}

export async function getAccountBalances(publicKey: string) {
  const account = await getAccount(publicKey);
  return account.balances;
}

export async function submitTransaction(signedXdr: string) {
  // Non-idempotent: bounded timeout only, never retried.
  if (!breakers.horizon.canAttempt()) {
    throw new DependencyUnavailableError(breakers.horizon.name);
  }
  try {
    const result = await withTimeout(
      horizon.submitTransaction(signedXdr),
      REQUEST_TIMEOUT_MS,
    );
    breakers.horizon.recordSuccess();
    return result;
  } catch (err) {
    breakers.horizon.recordFailure();
    throw err;
  }
}

export async function getSorobanHealth() {
  return withRetry(breakers.soroban, () => soroban.getHealth());
}

export async function getLatestLedger() {
  return withRetry(breakers.soroban, () => soroban.getLatestLedger());
}

export async function simulateTransaction(tx: TransactionBuilder) {
  return withRetry(breakers.soroban, () => soroban.simulateTransaction(tx as never));
}

export { horizon, soroban, Keypair, TransactionBuilder, Operation, Asset, BASE_FEE, NETWORK_PASSPHRASE };

/**
 * Resilience primitives for Soroban RPC and Horizon calls.
 *
 * The rule this module enforces: an RPC/Horizon outage must never make the
 * dashboard claim that a credit operation failed or succeeded without on-chain
 * evidence. Reads may fall back to cached values (clearly marked stale);
 * writes either fail closed before anything is submitted, or remain pending
 * until `getTransaction` returns a definitive SUCCESS / FAILED.
 *
 * Shared by the web client hooks and the API routes (apps/api aliases
 * `@/lib` to this directory), so it must stay framework-free.
 */

// ── Operation policy ──────────────────────────────────────────────────────

export type ChainOperation =
  | "token.balance"
  | "token.is_minter"
  | "distribution.total_generated"
  | "distribution.member_list"
  | "distribution.member_percent"
  | "horizon.payments"
  | "token.transfer"
  | "token.mint_energy"
  | "token.burn_energy"
  | "distribution.record_generation"

export interface ChainOperationPolicy {
  kind: "read" | "write"
  /** Whether a previously fetched value may be shown during an outage. */
  cacheable: boolean
  /** Oldest cached value that may still be displayed (reads only). */
  maxStaleMs: number
  /**
   * What the UI does when the network cannot be reached:
   * - `serve-cache`: show the last good value, marked stale, and retry.
   * - `fail-closed`: show "unavailable"; never substitute a default value.
   * - `remain-pending`: writes. Before submission → fail closed (nothing was
   *   sent). After submission → stay pending until the chain gives a verdict.
   */
  onOutage: "serve-cache" | "fail-closed" | "remain-pending"
}

const MINUTE = 60_000

export const CHAIN_OPERATION_POLICIES: Record<ChainOperation, ChainOperationPolicy> = {
  // Display-only reads: safe to show a stale value with a freshness label.
  "token.balance": { kind: "read", cacheable: true, maxStaleMs: 30 * MINUTE, onOutage: "serve-cache" },
  "distribution.total_generated": { kind: "read", cacheable: true, maxStaleMs: 60 * MINUTE, onOutage: "serve-cache" },
  "distribution.member_list": { kind: "read", cacheable: true, maxStaleMs: 60 * MINUTE, onOutage: "serve-cache" },
  "distribution.member_percent": { kind: "read", cacheable: true, maxStaleMs: 60 * MINUTE, onOutage: "serve-cache" },
  "horizon.payments": { kind: "read", cacheable: true, maxStaleMs: 30 * MINUTE, onOutage: "serve-cache" },
  // Authorization decisions must never be made on cached data.
  "token.is_minter": { kind: "read", cacheable: false, maxStaleMs: 0, onOutage: "fail-closed" },
  // Writes are never cached and never blindly re-built / re-signed.
  "token.transfer": { kind: "write", cacheable: false, maxStaleMs: 0, onOutage: "remain-pending" },
  "token.mint_energy": { kind: "write", cacheable: false, maxStaleMs: 0, onOutage: "remain-pending" },
  "token.burn_energy": { kind: "write", cacheable: false, maxStaleMs: 0, onOutage: "remain-pending" },
  "distribution.record_generation": { kind: "write", cacheable: false, maxStaleMs: 0, onOutage: "remain-pending" },
}

// ── Errors ────────────────────────────────────────────────────────────────

/** The network could not be reached before anything was submitted. */
export class ChainUnavailableError extends Error {
  readonly submitted = false
  constructor(message = "Stellar network unavailable — no transaction was submitted", readonly cause?: unknown) {
    super(message)
    this.name = "ChainUnavailableError"
  }
}

/** A transaction was (or may have been) submitted but has no verdict yet. */
export class ChainWritePendingError extends Error {
  readonly submitted = true
  constructor(readonly hash: string, readonly reason: string) {
    super(`Transaction ${hash} submitted; awaiting on-chain confirmation (${reason})`)
    this.name = "ChainWritePendingError"
  }
}

/** The chain returned a definitive rejection for a submitted transaction. */
export class ChainWriteFailedError extends Error {
  constructor(readonly hash: string | null, readonly reason: string) {
    super(reason)
    this.name = "ChainWriteFailedError"
  }
}

const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])
const TRANSIENT_PATTERNS = [
  /network ?error/i,
  /fetch failed/i,
  /failed to fetch/i,
  /econnreset/i,
  /econnrefused/i,
  /etimedout/i,
  /enotfound/i,
  /eai_again/i,
  /socket hang up/i,
  /timed? ?out/i,
  /too many requests/i,
  /service unavailable/i,
  /bad gateway/i,
  /gateway timeout/i,
  /try_again_later/i,
]

function extractStatus(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined
  const e = err as { status?: unknown; response?: { status?: unknown } }
  if (typeof e.status === "number") return e.status
  if (e.response && typeof e.response.status === "number") return e.response.status
  return undefined
}

/**
 * True when the error looks like an outage / overload rather than a
 * definitive answer from the network. Only transient errors are retried or
 * allowed to fall back to cached data.
 */
export function isTransientChainError(err: unknown): boolean {
  if (err instanceof ChainUnavailableError) return true
  if (err instanceof ChainWritePendingError || err instanceof ChainWriteFailedError) return false
  const status = extractStatus(err)
  if (status !== undefined) return TRANSIENT_STATUS.has(status)
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : ""
  return TRANSIENT_PATTERNS.some((re) => re.test(message))
}

// ── Bounded exponential backoff ───────────────────────────────────────────

export interface BackoffOptions {
  /** Total attempts including the first one. */
  maxAttempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
  /** Add up to 50 % random jitter to each delay. */
  jitter?: boolean
  shouldRetry?: (err: unknown, attempt: number) => boolean
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void
  sleep?: (ms: number) => Promise<void>
  random?: () => number
}

export const DEFAULT_BACKOFF = {
  maxAttempts: 4,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
  jitter: true,
} as const

export const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Delay before retry number `attempt` (1 = first retry):
 * base·2^(attempt-1), capped at maxDelay, with optional "equal jitter"
 * (half fixed, half random) so the delay never exceeds the cap.
 */
export function computeBackoffDelay(
  attempt: number,
  opts: Pick<BackoffOptions, "baseDelayMs" | "maxDelayMs" | "jitter" | "random"> = {},
): number {
  const base = opts.baseDelayMs ?? DEFAULT_BACKOFF.baseDelayMs
  const cap = opts.maxDelayMs ?? DEFAULT_BACKOFF.maxDelayMs
  const raw = Math.min(cap, base * 2 ** Math.max(0, attempt - 1))
  if (!(opts.jitter ?? DEFAULT_BACKOFF.jitter)) return raw
  const random = opts.random ?? Math.random
  return Math.round(raw / 2 + random() * (raw / 2))
}

/**
 * Run `fn` with bounded exponential backoff. Only errors accepted by
 * `shouldRetry` (default: transient network errors) are retried — callers
 * must never wrap a non-idempotent operation (e.g. building + signing a new
 * transaction) in this helper.
 */
export async function withBackoff<T>(fn: (attempt: number) => Promise<T>, opts: BackoffOptions = {}): Promise<T> {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? DEFAULT_BACKOFF.maxAttempts)
  const shouldRetry = opts.shouldRetry ?? ((err: unknown) => isTransientChainError(err))
  const sleep = opts.sleep ?? defaultSleep

  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt)
    } catch (err) {
      lastError = err
      if (attempt >= maxAttempts || !shouldRetry(err, attempt)) throw err
      const delayMs = computeBackoffDelay(attempt, opts)
      opts.onRetry?.({ attempt, delayMs, error: err })
      await sleep(delayMs)
    }
  }
  throw lastError
}

// ── Cached reads ──────────────────────────────────────────────────────────

export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function createMemoryStorage(): KeyValueStorage {
  const map = new Map<string, string>()
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  }
}

/** localStorage when available (browser), otherwise an in-memory map. */
export function getBrowserStorage(): KeyValueStorage {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage
  } catch {
    // Access to localStorage can throw (privacy mode); fall through.
  }
  return createMemoryStorage()
}

export interface CachedValue<T> {
  value: T
  fetchedAt: number
}

const CACHE_PREFIX = "chainCache:"

export class ChainReadCache {
  constructor(private readonly storage: KeyValueStorage = getBrowserStorage()) {}

  get<T>(key: string): CachedValue<T> | null {
    const raw = this.storage.getItem(CACHE_PREFIX + key)
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as CachedValue<T>
      return typeof parsed?.fetchedAt === "number" ? parsed : null
    } catch {
      return null
    }
  }

  set<T>(key: string, value: T, fetchedAt: number): void {
    try {
      this.storage.setItem(CACHE_PREFIX + key, JSON.stringify({ value, fetchedAt }))
    } catch {
      // Quota exceeded or serialization failure — caching is best effort.
    }
  }
}

export type ChainReadSource = "live" | "cache" | "none"

export interface ChainReadResult<T> {
  value: T | null
  /** When `value` was fetched from the network (null when there is no value). */
  fetchedAt: number | null
  source: ChainReadSource
  /** True when the value shown is not from this fetch. */
  stale: boolean
  error: string | null
  /** Whether a retry later might succeed (transient failure). */
  retryable: boolean
}

export interface ReadThroughOptions {
  operation: ChainOperation
  cache?: ChainReadCache
  backoff?: BackoffOptions
  now?: () => number
}

/**
 * Fetch a chain-derived value, retrying transient failures with backoff.
 * On outage, falls back to the cache only when the operation's policy allows
 * it and the cached value is younger than `maxStaleMs`. Never substitutes a
 * default (e.g. a "0.00" balance) for an unknown value.
 */
export async function readThroughCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  opts: ReadThroughOptions,
): Promise<ChainReadResult<T>> {
  const policy = CHAIN_OPERATION_POLICIES[opts.operation]
  if (policy.kind !== "read") throw new Error(`readThroughCache cannot be used for write operation ${opts.operation}`)
  const now = opts.now ?? Date.now
  const cache = opts.cache

  try {
    const value = await withBackoff(() => fetcher(), opts.backoff)
    const fetchedAt = now()
    if (policy.cacheable) cache?.set(key, value, fetchedAt)
    return { value, fetchedAt, source: "live", stale: false, error: null, retryable: false }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const retryable = isTransientChainError(err)
    if (retryable && policy.cacheable && policy.onOutage === "serve-cache" && cache) {
      const cached = cache.get<T>(key)
      if (cached && now() - cached.fetchedAt <= policy.maxStaleMs) {
        return { value: cached.value, fetchedAt: cached.fetchedAt, source: "cache", stale: true, error: message, retryable }
      }
    }
    return { value: null, fetchedAt: null, source: "none", stale: false, error: message, retryable }
  }
}

export type FreshnessStatus = "loading" | "live" | "stale" | "unavailable"

export function freshnessOf(result: Pick<ChainReadResult<unknown>, "source"> | null): FreshnessStatus {
  if (!result) return "loading"
  if (result.source === "live") return "live"
  if (result.source === "cache") return "stale"
  return "unavailable"
}

// ── Writes ────────────────────────────────────────────────────────────────

export type ChainWriteOutcome =
  | { status: "confirmed"; hash: string }
  | { status: "pending"; hash: string; reason: "confirmation_timeout" | "submission_unconfirmed" | "rpc_unavailable" }
  | { status: "failed"; hash: string | null; reason: string }

export interface SendResponseLike {
  status: string
  hash: string
  errorResult?: unknown
}

export interface GetTransactionLike {
  status: string
}

export interface RpcWriteClient {
  sendTransaction(tx: never): Promise<SendResponseLike>
  getTransaction(hash: string): Promise<GetTransactionLike>
}

export interface SubmitOptions {
  /** Backoff for re-sending the *same signed envelope* on transport errors. */
  send?: BackoffOptions
  /** How long to poll for a verdict before reporting `pending`. */
  confirmTimeoutMs?: number
  pollBaseDelayMs?: number
  pollMaxDelayMs?: number
  /** Called as soon as a hash is known to have been accepted for submission. */
  onSubmitted?: (hash: string) => Promise<void> | void
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

class TryAgainLaterError extends Error {
  constructor() {
    super("TRY_AGAIN_LATER")
  }
}

function localHash(tx: unknown): string | null {
  const maybe = tx as { hash?: () => { toString(enc: string): string } }
  try {
    return typeof maybe?.hash === "function" ? maybe.hash().toString("hex") : null
  } catch {
    return null
  }
}

/**
 * Submit an already-signed transaction and wait for a verdict.
 *
 * Idempotency: only the identical signed envelope is ever re-sent. Stellar
 * de-duplicates by hash and the envelope's sequence number can only be
 * consumed once, so a resend can never apply the operation twice. This
 * function never rebuilds or re-signs a transaction.
 *
 * Outcomes:
 * - `confirmed` — getTransaction returned SUCCESS.
 * - `failed`    — sendTransaction returned ERROR or getTransaction FAILED.
 * - `pending`   — no verdict yet (RPC down, timeout); callers must keep the
 *                 hash and reconcile later, never report success or failure.
 */
export async function submitSignedTransaction(
  server: RpcWriteClient,
  signedTx: unknown,
  opts: SubmitOptions = {},
): Promise<ChainWriteOutcome> {
  const sleep = opts.sleep ?? defaultSleep
  const now = opts.now ?? Date.now
  const precomputedHash = localHash(signedTx)

  let sendResult: SendResponseLike
  try {
    sendResult = await withBackoff(
      async () => {
        const res = await server.sendTransaction(signedTx as never)
        if (res.status === "TRY_AGAIN_LATER") throw new TryAgainLaterError()
        return res
      },
      {
        ...DEFAULT_BACKOFF,
        ...opts.send,
        sleep,
        shouldRetry: (err) => err instanceof TryAgainLaterError || isTransientChainError(err),
      },
    )
  } catch (err) {
    if (err instanceof TryAgainLaterError) {
      // The RPC explicitly refused the envelope; nothing entered the ledger queue.
      return { status: "failed", hash: precomputedHash, reason: "RPC refused submission (TRY_AGAIN_LATER)" }
    }
    if (isTransientChainError(err) && precomputedHash) {
      // We cannot know whether the envelope reached the network.
      await opts.onSubmitted?.(precomputedHash)
      return { status: "pending", hash: precomputedHash, reason: "submission_unconfirmed" }
    }
    throw err
  }

  if (sendResult.status === "ERROR") {
    return { status: "failed", hash: sendResult.hash ?? precomputedHash, reason: "Transaction rejected by the network" }
  }

  const hash = sendResult.hash
  await opts.onSubmitted?.(hash)

  const deadline = now() + (opts.confirmTimeoutMs ?? 90_000)
  let attempt = 0
  let rpcReachable = true
  while (true) {
    try {
      const res = await server.getTransaction(hash)
      rpcReachable = true
      if (res.status === "SUCCESS") return { status: "confirmed", hash }
      if (res.status === "FAILED") return { status: "failed", hash, reason: "Transaction failed on-chain" }
    } catch (err) {
      if (!isTransientChainError(err)) throw err
      rpcReachable = false
    }
    attempt++
    if (now() >= deadline) {
      return { status: "pending", hash, reason: rpcReachable ? "confirmation_timeout" : "rpc_unavailable" }
    }
    const delay = computeBackoffDelay(attempt, {
      baseDelayMs: opts.pollBaseDelayMs ?? 1_000,
      maxDelayMs: opts.pollMaxDelayMs ?? 8_000,
      jitter: false,
    })
    await sleep(Math.min(delay, Math.max(0, deadline - now())))
  }
}

/** Grace period after a transaction's maxTime before NOT_FOUND counts as "expired". */
export const EXPIRY_GRACE_MS = 2 * MINUTE

/**
 * Check a previously pending write. A NOT_FOUND result is only treated as a
 * failure once the transaction's time bounds have provably elapsed — before
 * that, it stays pending.
 */
export async function reconcileChainWrite(
  server: Pick<RpcWriteClient, "getTransaction">,
  record: { hash: string; expiresAt?: number | null },
  now: () => number = Date.now,
): Promise<ChainWriteOutcome> {
  try {
    const res = await server.getTransaction(record.hash)
    if (res.status === "SUCCESS") return { status: "confirmed", hash: record.hash }
    if (res.status === "FAILED") return { status: "failed", hash: record.hash, reason: "Transaction failed on-chain" }
    if (record.expiresAt && now() > record.expiresAt + EXPIRY_GRACE_MS) {
      return { status: "failed", hash: record.hash, reason: "Transaction expired without being included in a ledger" }
    }
    return { status: "pending", hash: record.hash, reason: "confirmation_timeout" }
  } catch (err) {
    if (!isTransientChainError(err)) throw err
    return { status: "pending", hash: record.hash, reason: "rpc_unavailable" }
  }
}

// ── Pending write ledger (client side) ────────────────────────────────────

export interface PendingChainWrite {
  hash: string
  operation: ChainOperation
  submittedAt: number
  /** Transaction maxTime (ms). After this + grace, NOT_FOUND means expired. */
  expiresAt: number | null
  description?: string
}

const PENDING_KEY = "chainPendingWrites"

export class PendingWriteStore {
  constructor(private readonly storage: KeyValueStorage = getBrowserStorage()) {}

  list(): PendingChainWrite[] {
    try {
      const raw = this.storage.getItem(PENDING_KEY)
      const parsed = raw ? (JSON.parse(raw) as PendingChainWrite[]) : []
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  add(write: PendingChainWrite): void {
    const others = this.list().filter((w) => w.hash !== write.hash)
    this.storage.setItem(PENDING_KEY, JSON.stringify([...others, write]))
  }

  remove(hash: string): void {
    this.storage.setItem(PENDING_KEY, JSON.stringify(this.list().filter((w) => w.hash !== hash)))
  }
}

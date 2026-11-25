import { describe, it, expect, vi } from "vitest"
import {
  CHAIN_OPERATION_POLICIES,
  ChainReadCache,
  PendingWriteStore,
  computeBackoffDelay,
  createMemoryStorage,
  freshnessOf,
  isTransientChainError,
  readThroughCache,
  reconcileChainWrite,
  submitSignedTransaction,
  withBackoff,
  EXPIRY_GRACE_MS,
} from "@/lib/stellar/resilience"

const noSleep = () => Promise.resolve()
const outage = () => Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:443"), {})
const http = (status: number) => Object.assign(new Error(`Request failed with status ${status}`), { response: { status } })

describe("operation policy", () => {
  it("only allows cached fallbacks for display reads", () => {
    for (const [op, policy] of Object.entries(CHAIN_OPERATION_POLICIES)) {
      if (policy.kind === "write") {
        expect(policy.cacheable, op).toBe(false)
        expect(policy.onOutage, op).toBe("remain-pending")
      }
    }
    expect(CHAIN_OPERATION_POLICIES["token.balance"].onOutage).toBe("serve-cache")
    // Authorization must never be decided from cached data.
    expect(CHAIN_OPERATION_POLICIES["token.is_minter"]).toMatchObject({ cacheable: false, onOutage: "fail-closed" })
  })
})

describe("isTransientChainError", () => {
  it("classifies outages and throttling as transient", () => {
    expect(isTransientChainError(outage())).toBe(true)
    expect(isTransientChainError(new TypeError("fetch failed"))).toBe(true)
    expect(isTransientChainError(http(503))).toBe(true)
    expect(isTransientChainError(http(429))).toBe(true)
  })

  it("treats definitive answers as non-transient", () => {
    expect(isTransientChainError(http(400))).toBe(false)
    expect(isTransientChainError(new Error("Account not found"))).toBe(false)
    expect(isTransientChainError(new Error("Simulation of balance failed"))).toBe(false)
  })
})

describe("bounded exponential backoff", () => {
  it("doubles the delay and never exceeds the cap", () => {
    const opts = { baseDelayMs: 100, maxDelayMs: 1_000, jitter: false }
    expect([1, 2, 3, 4, 5, 6].map((a) => computeBackoffDelay(a, opts))).toEqual([100, 200, 400, 800, 1000, 1000])
  })

  it("keeps jittered delays within [cap/2, cap]", () => {
    for (const r of [0, 0.5, 0.999]) {
      const d = computeBackoffDelay(10, { baseDelayMs: 100, maxDelayMs: 1_000, jitter: true, random: () => r })
      expect(d).toBeGreaterThanOrEqual(500)
      expect(d).toBeLessThanOrEqual(1_000)
    }
  })

  it("retries transient failures until recovery", async () => {
    const fn = vi.fn().mockRejectedValueOnce(outage()).mockRejectedValueOnce(http(502)).mockResolvedValue("ok")
    await expect(withBackoff(fn, { sleep: noSleep })).resolves.toBe("ok")
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it("stops after maxAttempts", async () => {
    const fn = vi.fn().mockRejectedValue(outage())
    await expect(withBackoff(fn, { maxAttempts: 3, sleep: noSleep })).rejects.toThrow(/ECONNREFUSED/)
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it("does not retry non-transient errors", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("Simulation of balance failed"))
    await expect(withBackoff(fn, { sleep: noSleep })).rejects.toThrow()
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe("readThroughCache (simulated RPC outage)", () => {
  const backoff = { maxAttempts: 2, sleep: noSleep }

  it("returns live data and caches it", async () => {
    const cache = new ChainReadCache(createMemoryStorage())
    const res = await readThroughCache("k", async () => "12.50", { operation: "token.balance", cache, backoff, now: () => 1_000 })
    expect(res).toMatchObject({ value: "12.50", source: "live", stale: false, fetchedAt: 1_000 })
    expect(freshnessOf(res)).toBe("live")
    expect(cache.get("k")).toEqual({ value: "12.50", fetchedAt: 1_000 })
  })

  it("serves the cached value marked stale during an outage", async () => {
    const cache = new ChainReadCache(createMemoryStorage())
    cache.set("k", "12.50", 1_000)
    const res = await readThroughCache("k", () => Promise.reject(outage()), {
      operation: "token.balance",
      cache,
      backoff,
      now: () => 1_000 + 60_000,
    })
    expect(res).toMatchObject({ value: "12.50", source: "cache", stale: true, fetchedAt: 1_000, retryable: true })
    expect(freshnessOf(res)).toBe("stale")
  })

  it("reports unavailable — never a default value — when nothing is cached", async () => {
    const res = await readThroughCache("k", () => Promise.reject(outage()), {
      operation: "token.balance",
      cache: new ChainReadCache(createMemoryStorage()),
      backoff,
    })
    expect(res.value).toBeNull()
    expect(res.source).toBe("none")
    expect(freshnessOf(res)).toBe("unavailable")
  })

  it("refuses to serve cache older than maxStaleMs", async () => {
    const cache = new ChainReadCache(createMemoryStorage())
    cache.set("k", "12.50", 0)
    const tooOld = CHAIN_OPERATION_POLICIES["token.balance"].maxStaleMs + 1
    const res = await readThroughCache("k", () => Promise.reject(outage()), { operation: "token.balance", cache, backoff, now: () => tooOld })
    expect(res.source).toBe("none")
  })

  it("never serves cache for non-cacheable reads", async () => {
    const cache = new ChainReadCache(createMemoryStorage())
    cache.set("minter", true, Date.now())
    const res = await readThroughCache("minter", () => Promise.reject(outage()), { operation: "token.is_minter", cache, backoff })
    expect(res.value).toBeNull()
  })

  it("does not mask definitive errors with cached data", async () => {
    const cache = new ChainReadCache(createMemoryStorage())
    cache.set("k", "12.50", Date.now())
    const res = await readThroughCache("k", () => Promise.reject(new Error("Energy token contract not configured")), {
      operation: "token.balance",
      cache,
      backoff,
    })
    expect(res).toMatchObject({ source: "none", retryable: false })
  })

  it("recovers to live after the outage ends", async () => {
    const cache = new ChainReadCache(createMemoryStorage())
    let down = true
    const fetcher = () => (down ? Promise.reject(outage()) : Promise.resolve("15.00"))
    cache.set("k", "12.50", Date.now())
    expect((await readThroughCache("k", fetcher, { operation: "token.balance", cache, backoff })).source).toBe("cache")
    down = false
    const res = await readThroughCache("k", fetcher, { operation: "token.balance", cache, backoff })
    expect(res).toMatchObject({ value: "15.00", source: "live", stale: false })
  })

  it("rejects write operations", async () => {
    await expect(readThroughCache("k", async () => 1, { operation: "token.mint_energy" })).rejects.toThrow(/write operation/)
  })
})

function fakeServer(sendResults: Array<unknown>, getResults: Array<unknown>) {
  const sendTransaction = vi.fn(async () => {
    const next = sendResults.length > 1 ? sendResults.shift() : sendResults[0]
    if (next instanceof Error) throw next
    return next as { status: string; hash: string }
  })
  const getTransaction = vi.fn(async () => {
    const next = getResults.length > 1 ? getResults.shift() : getResults[0]
    if (next instanceof Error) throw next
    return next as { status: string }
  })
  return { sendTransaction, getTransaction }
}

const signedTx = { hash: () => ({ toString: () => "localhash" }) }

describe("submitSignedTransaction (pending writes)", () => {
  it("confirms on SUCCESS", async () => {
    const server = fakeServer([{ status: "PENDING", hash: "h1" }], [{ status: "NOT_FOUND" }, { status: "SUCCESS" }])
    const onSubmitted = vi.fn()
    const outcome = await submitSignedTransaction(server, signedTx, { sleep: noSleep, onSubmitted })
    expect(outcome).toEqual({ status: "confirmed", hash: "h1" })
    expect(onSubmitted).toHaveBeenCalledWith("h1")
  })

  it("re-sends only the same signed envelope after a transport error", async () => {
    const server = fakeServer([outage(), { status: "PENDING", hash: "h1" }], [{ status: "SUCCESS" }])
    const outcome = await submitSignedTransaction(server, signedTx, { sleep: noSleep })
    expect(outcome.status).toBe("confirmed")
    expect(server.sendTransaction).toHaveBeenCalledTimes(2)
    for (const call of server.sendTransaction.mock.calls as unknown[][]) expect(call[0]).toBe(signedTx)
  })

  it("stays pending (not failed) when submission outcome is unknown", async () => {
    const server = fakeServer([outage()], [{ status: "SUCCESS" }])
    const onSubmitted = vi.fn()
    const outcome = await submitSignedTransaction(server, signedTx, { sleep: noSleep, send: { maxAttempts: 2 }, onSubmitted })
    expect(outcome).toEqual({ status: "pending", hash: "localhash", reason: "submission_unconfirmed" })
    expect(onSubmitted).toHaveBeenCalledWith("localhash")
  })

  it("fails on a definitive ERROR from sendTransaction", async () => {
    const server = fakeServer([{ status: "ERROR", hash: "h1" }], [{ status: "SUCCESS" }])
    const outcome = await submitSignedTransaction(server, signedTx, { sleep: noSleep })
    expect(outcome.status).toBe("failed")
    expect(server.getTransaction).not.toHaveBeenCalled()
  })

  it("fails when the chain reports FAILED", async () => {
    const server = fakeServer([{ status: "PENDING", hash: "h1" }], [{ status: "FAILED" }])
    expect(await submitSignedTransaction(server, signedTx, { sleep: noSleep })).toMatchObject({ status: "failed", hash: "h1" })
  })

  it("remains pending when confirmation times out", async () => {
    let clock = 0
    const server = fakeServer([{ status: "PENDING", hash: "h1" }], [{ status: "NOT_FOUND" }])
    const outcome = await submitSignedTransaction(server, signedTx, {
      sleep: async (ms) => void (clock += ms),
      now: () => clock,
      confirmTimeoutMs: 10_000,
    })
    expect(outcome).toEqual({ status: "pending", hash: "h1", reason: "confirmation_timeout" })
    expect(clock).toBeLessThanOrEqual(10_000)
  })

  it("remains pending when the RPC goes down while polling", async () => {
    let clock = 0
    const server = fakeServer([{ status: "PENDING", hash: "h1" }], [outage()])
    const outcome = await submitSignedTransaction(server, signedTx, {
      sleep: async (ms) => void (clock += ms),
      now: () => clock,
      confirmTimeoutMs: 5_000,
    })
    expect(outcome).toEqual({ status: "pending", hash: "h1", reason: "rpc_unavailable" })
  })

  it("treats exhausted TRY_AGAIN_LATER as not submitted", async () => {
    const server = fakeServer([{ status: "TRY_AGAIN_LATER", hash: "h1" }], [{ status: "SUCCESS" }])
    const outcome = await submitSignedTransaction(server, signedTx, { sleep: noSleep, send: { maxAttempts: 3 } })
    expect(outcome.status).toBe("failed")
    expect(server.sendTransaction).toHaveBeenCalledTimes(3)
  })
})

describe("reconcileChainWrite (recovery)", () => {
  it("confirms once the RPC is back and reports SUCCESS", async () => {
    const server = fakeServer([], [{ status: "SUCCESS" }])
    expect(await reconcileChainWrite(server, { hash: "h1" })).toEqual({ status: "confirmed", hash: "h1" })
  })

  it("keeps NOT_FOUND pending until the time bounds have provably expired", async () => {
    const server = fakeServer([], [{ status: "NOT_FOUND" }])
    expect((await reconcileChainWrite(server, { hash: "h1", expiresAt: 1_000 }, () => 1_000)).status).toBe("pending")
    expect((await reconcileChainWrite(server, { hash: "h1" }, () => 10 ** 12)).status).toBe("pending")
    const expired = await reconcileChainWrite(server, { hash: "h1", expiresAt: 1_000 }, () => 1_000 + EXPIRY_GRACE_MS + 1)
    expect(expired.status).toBe("failed")
  })

  it("keeps pending while the RPC is unreachable", async () => {
    const server = fakeServer([], [outage()])
    expect(await reconcileChainWrite(server, { hash: "h1", expiresAt: 0 }, () => 10 ** 12)).toMatchObject({
      status: "pending",
      reason: "rpc_unavailable",
    })
  })
})

describe("PendingWriteStore", () => {
  it("persists, de-duplicates and removes pending writes", () => {
    const store = new PendingWriteStore(createMemoryStorage())
    const w = { hash: "h1", operation: "token.mint_energy" as const, submittedAt: 1, expiresAt: null }
    store.add(w)
    store.add({ ...w, description: "again" })
    expect(store.list()).toHaveLength(1)
    expect(store.list()[0].description).toBe("again")
    store.remove("h1")
    expect(store.list()).toEqual([])
  })
})

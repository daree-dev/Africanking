import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"

const ADDR = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
const COOP_ID = "00000000-0000-0000-0000-000000000001"
const CERT_ID = "00000000-0000-0000-0000-000000000002"
const READING_ID = "00000000-0000-0000-0000-000000000003"

const h = vi.hoisted(() => {
  const mockSingle = vi.fn()
  const updates: Array<{ table: string; values: Record<string, unknown> }> = []
  const inserts: Array<{ table: string; values: Record<string, unknown> }> = []
  const mockEq: ReturnType<typeof vi.fn> = vi.fn(() => ({ single: mockSingle, eq: mockEq }))
  const mockFrom = vi.fn((table: string) => ({
    select: vi.fn(() => ({ eq: mockEq })),
    update: vi.fn((values: Record<string, unknown>) => {
      updates.push({ table, values })
      return { eq: mockEq }
    }),
    insert: vi.fn((values: Record<string, unknown>) => {
      inserts.push({ table, values })
      return { error: null }
    }),
  }))
  return {
    mockSingle,
    mockFrom,
    updates,
    inserts,
    getAccount: vi.fn(),
    prepareTransaction: vi.fn(),
    sendTransaction: vi.fn(),
    getTransaction: vi.fn(),
  }
})

vi.mock("@/lib/supabase", () => ({ supabase: { from: h.mockFrom } }))

vi.mock("@/lib/auth/middleware", () => ({
  requireAuth: vi.fn(async () => ({ sub: ADDR, cooperative_ids: [COOP_ID], admin_cooperative_ids: [COOP_ID] })),
  isSession: vi.fn(() => true),
}))

vi.mock("@stellar/stellar-sdk", () => ({
  rpc: {
    Server: vi.fn(function MockServer() {
      return {
        getAccount: h.getAccount,
        prepareTransaction: h.prepareTransaction,
        sendTransaction: h.sendTransaction,
        getTransaction: h.getTransaction,
      }
    }),
  },
  Keypair: { fromSecret: vi.fn(() => ({ publicKey: () => ADDR })) },
  Contract: vi.fn(function MockContract() {
    return { call: vi.fn(() => ({ op: "mint_energy" })) }
  }),
  TransactionBuilder: vi.fn(function MockTransactionBuilder() {
    return { addOperation: vi.fn().mockReturnThis(), build: vi.fn(() => ({})) }
  }),
  nativeToScVal: vi.fn((v) => v),
  BASE_FEE: "100",
}))

vi.mock("@/lib/contracts-config", () => ({
  CONTRACTS: { ENERGY_TOKEN: "CFAKECONTRACT" },
  STELLAR_CONFIG: { RPC_URL: "https://fake-rpc.stellar.org" },
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
}))

import { POST as mint } from "@/app/api/mint/route"
import { POST as reconcile } from "@/app/api/mint/reconcile/route"

const req = (path: string, body: Record<string, unknown>) =>
  new NextRequest(`http://localhost${path}`, { method: "POST", body: JSON.stringify(body) })

const pendingCert = (overrides: Record<string, unknown> = {}) => ({
  data: {
    id: CERT_ID,
    cooperative_id: COOP_ID,
    status: "pending",
    total_kwh: 100,
    mint_tx_hash: null,
    cooperatives: { admin_stellar_address: ADDR, token_contract_address: null },
    ...overrides,
  },
  error: null,
})

const outage = () => new Error("connect ECONNREFUSED fake-rpc.stellar.org")

describe("POST /api/mint — RPC outage handling", () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.clearAllMocks()
    h.updates.length = 0
    h.inserts.length = 0
    process.env = { ...originalEnv, MINTER_SECRET_KEY: "SFAKE", MINT_CONFIRM_TIMEOUT_MS: "0" }
    h.getAccount.mockResolvedValue({ id: "account" })
    h.prepareTransaction.mockResolvedValue({ sign: vi.fn() })
    h.sendTransaction.mockResolvedValue({ status: "PENDING", hash: "tx-pending" })
    h.getTransaction.mockResolvedValue({ status: "SUCCESS" })
  })

  afterEach(() => {
    vi.useRealTimers()
    process.env = originalEnv
  })

  it("fails closed with 503 when the RPC is down before submission, without touching state", async () => {
    vi.useFakeTimers()
    h.mockSingle.mockResolvedValueOnce(pendingCert())
    h.getAccount.mockRejectedValue(outage())

    const pending = mint(req("/api/mint", { certificate_id: CERT_ID }))
    await vi.runAllTimersAsync()
    const res = await pending

    expect(res.status).toBe(503)
    expect((await res.json()).submitted).toBe(false)
    expect(h.getAccount.mock.calls.length).toBeGreaterThan(1) // retried with backoff
    expect(h.getAccount.mock.calls.length).toBeLessThanOrEqual(4) // …but bounded
    expect(h.sendTransaction).not.toHaveBeenCalled()
    expect(h.updates).toEqual([])
  })

  it("returns 202 pending and records the hash when confirmation does not arrive", async () => {
    h.mockSingle.mockResolvedValueOnce(pendingCert())
    h.getTransaction.mockResolvedValue({ status: "NOT_FOUND" })

    const res = await mint(req("/api/mint", { certificate_id: CERT_ID }))
    expect(res.status).toBe(202)
    const json = await res.json()
    expect(json).toMatchObject({ status: "pending_confirmation", tx_hash: "tx-pending" })
    expect(h.updates).toContainEqual({ table: "certificates", values: { mint_tx_hash: "tx-pending" } })
    // Not marked available, no mint_log written.
    expect(h.updates.some((u) => u.values.status === "available")).toBe(false)
    expect(h.inserts).toEqual([])
    expect(h.sendTransaction).toHaveBeenCalledTimes(1)
  })

  it("returns 202 when the RPC goes down after submission", async () => {
    h.mockSingle.mockResolvedValueOnce(pendingCert())
    h.getTransaction.mockRejectedValue(outage())

    const res = await mint(req("/api/mint", { certificate_id: CERT_ID }))
    expect(res.status).toBe(202)
    expect((await res.json()).tx_hash).toBe("tx-pending")
  })

  it("clears the guard hash only on a definitive on-chain failure", async () => {
    h.mockSingle.mockResolvedValueOnce(pendingCert())
    h.getTransaction.mockResolvedValue({ status: "FAILED" })

    const res = await mint(req("/api/mint", { certificate_id: CERT_ID }))
    expect(res.status).toBe(502)
    expect(h.updates.at(-1)).toEqual({ table: "certificates", values: { mint_tx_hash: null } })
  })

  it("refuses to mint again while a submitted hash is unconfirmed", async () => {
    h.mockSingle.mockResolvedValueOnce(pendingCert({ mint_tx_hash: "tx-old" }))
    const res = await mint(req("/api/mint", { certificate_id: CERT_ID }))
    expect(res.status).toBe(409)
    expect(h.sendTransaction).not.toHaveBeenCalled()
  })

  it("does not mark a legacy reading failed when the RPC is unreachable", async () => {
    vi.useFakeTimers()
    h.mockSingle.mockResolvedValueOnce({
      data: { id: READING_ID, cooperative_id: COOP_ID, status: "pending", kwh_injected: 3, tx_hash: null, prosumers: { stellar_address: ADDR } },
      error: null,
    })
    h.getAccount.mockRejectedValue(outage())

    const pending = mint(req("/api/mint", { reading_id: READING_ID }))
    await vi.runAllTimersAsync()
    const res = await pending

    expect(res.status).toBe(503)
    expect(h.updates.some((u) => u.values.status === "failed")).toBe(false)
  })

  it("refuses to re-mint a reading with an unconfirmed tx", async () => {
    h.mockSingle.mockResolvedValueOnce({
      data: { id: READING_ID, cooperative_id: COOP_ID, status: "pending", kwh_injected: 3, tx_hash: "tx-old", prosumers: { stellar_address: ADDR } },
      error: null,
    })
    const res = await mint(req("/api/mint", { reading_id: READING_ID }))
    expect(res.status).toBe(409)
  })
})

describe("POST /api/mint/reconcile — recovery", () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.clearAllMocks()
    h.updates.length = 0
    h.inserts.length = 0
    process.env = { ...originalEnv, MINTER_SECRET_KEY: "SFAKE" }
  })

  afterEach(() => {
    vi.useRealTimers()
    process.env = originalEnv
  })

  it("finalizes a certificate once the chain confirms the pending mint", async () => {
    h.mockSingle.mockResolvedValueOnce(pendingCert({ mint_tx_hash: "tx-pending" }))
    h.getTransaction.mockResolvedValue({ status: "SUCCESS" })

    const res = await reconcile(req("/api/mint/reconcile", { certificate_id: CERT_ID }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: "confirmed", tx_hash: "tx-pending" })
    expect(h.updates).toContainEqual({
      table: "certificates",
      values: { status: "available", mint_tx_hash: "tx-pending", token_amount: 100 },
    })
    expect(h.inserts.map((i) => i.table)).toEqual(["mint_log", "events"])
  })

  it("keeps the certificate pending while the tx is not found", async () => {
    h.mockSingle.mockResolvedValueOnce(pendingCert({ mint_tx_hash: "tx-pending" }))
    h.getTransaction.mockResolvedValue({ status: "NOT_FOUND" })

    const res = await reconcile(req("/api/mint/reconcile", { certificate_id: CERT_ID }))
    expect(res.status).toBe(202)
    expect(h.updates).toEqual([])
  })

  it("keeps the certificate pending while the RPC is still down", async () => {
    vi.useFakeTimers()
    h.mockSingle.mockResolvedValueOnce(pendingCert({ mint_tx_hash: "tx-pending" }))
    h.getTransaction.mockRejectedValue(outage())

    const pending = reconcile(req("/api/mint/reconcile", { certificate_id: CERT_ID }))
    await vi.runAllTimersAsync()
    const res = await pending
    expect(res.status).toBe(202)
    expect((await res.json()).reason).toBe("rpc_unavailable")
    expect(h.updates).toEqual([])
  })

  it("clears the hash when the chain reports FAILED so the admin can retry", async () => {
    h.mockSingle.mockResolvedValueOnce(pendingCert({ mint_tx_hash: "tx-pending" }))
    h.getTransaction.mockResolvedValue({ status: "FAILED" })

    const res = await reconcile(req("/api/mint/reconcile", { certificate_id: CERT_ID }))
    expect((await res.json()).status).toBe("failed")
    expect(h.updates).toEqual([{ table: "certificates", values: { mint_tx_hash: null } }])
  })

  it("rejects non-admins", async () => {
    h.mockSingle.mockResolvedValueOnce(pendingCert({ cooperative_id: "other-coop", mint_tx_hash: "tx-pending" }))
    const res = await reconcile(req("/api/mint/reconcile", { certificate_id: CERT_ID }))
    expect(res.status).toBe(403)
    expect(h.getTransaction).not.toHaveBeenCalled()
  })
})

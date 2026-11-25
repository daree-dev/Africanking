import { describe, it, expect, vi } from "vitest"
import * as StellarSdk from "@stellar/stellar-sdk"
import {
  resolveNetworkConfig,
  explorerTxUrl,
  walletNetworkMismatch,
  NETWORK_PASSPHRASES,
} from "@/lib/stellar-network"
import { fetchPaymentsPage, type HorizonPaymentRecord } from "@/lib/activity/horizon"
import { fetchContractEventsPage, buildTopicFilters } from "@/lib/activity/contract-events"
import {
  contractEventToDisplay,
  mergeActivity,
  paymentToDisplay,
  recordedEventToActivity,
} from "@/lib/activity/display"

const ME = "GCHCYTHV4JSIJNCN56EIEXZNTB6JUHYX25FTSYFOM4DDVGV7UXWOHLCW"
const OTHER = "GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57"
const CONTRACT = "CAUH3NUZGCNRHHVJK5S3FLXIS244GCNPC2LDZDU2SVOK66G3IGAGBBL2"

const TESTNET = resolveNetworkConfig({ network: "TESTNET" })
const MAINNET = resolveNetworkConfig({ network: "PUBLIC" })

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

function payment(i: number, overrides: Partial<HorizonPaymentRecord> = {}): HorizonPaymentRecord {
  return {
    id: `op-${i}`,
    paging_token: `pt-${i}`,
    type: "payment",
    created_at: `2026-11-${String(20 - i).padStart(2, "0")}T10:00:00Z`,
    transaction_hash: `tx-${i}`,
    asset_type: "native",
    from: OTHER,
    to: ME,
    amount: `${i}.0000000`,
    ...overrides,
  }
}

describe("network configuration", () => {
  it("defaults to a valid testnet config", () => {
    const cfg = resolveNetworkConfig({})
    expect(cfg).toMatchObject({
      network: "TESTNET",
      passphrase: NETWORK_PASSPHRASES.TESTNET,
      horizonUrl: "https://horizon-testnet.stellar.org",
      rpcUrl: "https://soroban-testnet.stellar.org",
      valid: true,
    })
  })

  it("rejects a Horizon endpoint that belongs to another network", () => {
    const cfg = resolveNetworkConfig({ network: "PUBLIC", horizonUrl: "https://horizon-testnet.stellar.org" })
    expect(cfg.valid).toBe(false)
    expect(cfg.issues[0]).toMatch(/looks like TESTNET.*configured for PUBLIC/)
  })

  it("rejects unknown networks, mismatched passphrases and plain http", () => {
    expect(resolveNetworkConfig({ network: "MOONNET" }).valid).toBe(false)
    expect(resolveNetworkConfig({ network: "TESTNET", passphrase: NETWORK_PASSPHRASES.PUBLIC }).valid).toBe(false)
    expect(resolveNetworkConfig({ network: "TESTNET", horizonUrl: "http://my-horizon.example" }).valid).toBe(false)
    expect(resolveNetworkConfig({ network: "LOCAL" }).valid).toBe(true)
  })

  it("accepts custom hosts it cannot classify", () => {
    expect(resolveNetworkConfig({ network: "PUBLIC", rpcUrl: "https://rpc.example.org" }).valid).toBe(true)
  })

  it("builds explorer links for the configured network", () => {
    expect(explorerTxUrl(TESTNET, "abc")).toBe("https://stellar.expert/explorer/testnet/tx/abc")
    expect(explorerTxUrl(MAINNET, "abc")).toBe("https://stellar.expert/explorer/public/tx/abc")
    expect(explorerTxUrl(resolveNetworkConfig({ network: "LOCAL" }), "abc")).toBeNull()
  })

  it("detects a wallet on a different network", () => {
    expect(walletNetworkMismatch(TESTNET, { network: "TESTNET" })).toBeNull()
    expect(walletNetworkMismatch(TESTNET, { network: "PUBLIC" })).toMatch(/PUBLIC.*TESTNET/)
    expect(walletNetworkMismatch(TESTNET, { passphrase: NETWORK_PASSPHRASES.PUBLIC })).toMatch(/PUBLIC/)
    expect(walletNetworkMismatch(TESTNET, { network: "PUBLIC", passphrase: NETWORK_PASSPHRASES.TESTNET })).toBeNull()
    expect(walletNetworkMismatch(TESTNET, { network: null })).toMatch(/did not report/)
  })
})

describe("fetchPaymentsPage", () => {
  it("queries the Horizon of the selected network (network switching)", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { _embedded: { records: [] } }))
    await fetchPaymentsPage({ horizonUrl: TESTNET.horizonUrl, address: ME, fetchImpl })
    await fetchPaymentsPage({ horizonUrl: MAINNET.horizonUrl, address: ME, fetchImpl })
    const urls = fetchImpl.mock.calls.map((c) => String((c as unknown[])[0]))
    expect(urls[0]).toMatch(/^https:\/\/horizon-testnet\.stellar\.org\/accounts\/G.*\/payments\?order=desc&limit=50$/)
    expect(urls[1]).toMatch(/^https:\/\/horizon\.stellar\.org\/accounts\//)
  })

  it("returns an empty ready page for a funded account with no payments", async () => {
    const fetchImpl = async () => jsonResponse(200, { _embedded: { records: [] } })
    const page = await fetchPaymentsPage({ horizonUrl: TESTNET.horizonUrl, address: ME, fetchImpl })
    expect(page).toEqual({ status: "ok", records: [], nextCursor: null, hasMore: false })
  })

  it("reports an unfunded account as account_not_found, not an error", async () => {
    const fetchImpl = async () => jsonResponse(404, { status: 404 })
    const page = await fetchPaymentsPage({ horizonUrl: TESTNET.horizonUrl, address: ME, fetchImpl })
    expect(page).toEqual({ status: "account_not_found" })
  })

  it("paginates with the last paging token as cursor", async () => {
    const pages = [[payment(1), payment(2)], [payment(3)]]
    const fetchImpl = vi.fn(async () => jsonResponse(200, { _embedded: { records: pages.shift() } }))

    const first = await fetchPaymentsPage({ horizonUrl: TESTNET.horizonUrl, address: ME, limit: 2, fetchImpl })
    expect(first).toMatchObject({ status: "ok", nextCursor: "pt-2", hasMore: true })

    const second = await fetchPaymentsPage({
      horizonUrl: TESTNET.horizonUrl,
      address: ME,
      limit: 2,
      cursor: first.status === "ok" ? first.nextCursor : null,
      fetchImpl,
    })
    expect(String((fetchImpl.mock.calls[1] as unknown[])[0])).toContain("cursor=pt-2")
    expect(second).toMatchObject({ status: "ok", hasMore: false })
    if (second.status === "ok") expect(second.records.map((r) => r.id)).toEqual(["op-3"])
  })

  it("excludes Soroban invocations but still pages past them", async () => {
    const records = [payment(1), payment(2, { type: "invoke_host_function", amount: undefined })]
    const fetchImpl = async () => jsonResponse(200, { _embedded: { records } })
    const page = await fetchPaymentsPage({ horizonUrl: TESTNET.horizonUrl, address: ME, limit: 2, fetchImpl })
    expect(page).toMatchObject({ status: "ok", nextCursor: "pt-2", hasMore: true })
    if (page.status === "ok") expect(page.records.map((r) => r.operationType)).toEqual(["payment"])
  })

  it("maps create_account funding into the shared fields", async () => {
    const rec = payment(1, { type: "create_account", funder: OTHER, account: ME, starting_balance: "10000.0000000" })
    const fetchImpl = async () => jsonResponse(200, { _embedded: { records: [rec] } })
    const page = await fetchPaymentsPage({ horizonUrl: TESTNET.horizonUrl, address: ME, fetchImpl })
    if (page.status !== "ok") throw new Error("expected ok")
    expect(page.records[0]).toMatchObject({ from: OTHER, to: ME, amount: "10000.0000000", asset: "XLM" })
  })

  it.each([
    [503, "outage"],
    [500, "outage"],
    [429, "rate_limited"],
    [400, "bad_response"],
  ])("classifies HTTP %i as %s", async (status, kind) => {
    const fetchImpl = async () => jsonResponse(status, {})
    const page = await fetchPaymentsPage({ horizonUrl: TESTNET.horizonUrl, address: ME, fetchImpl })
    expect(page).toMatchObject({ status: "error", kind })
  })

  it("classifies a thrown fetch as a network error", async () => {
    const fetchImpl = async () => {
      throw new TypeError("Failed to fetch")
    }
    const page = await fetchPaymentsPage({ horizonUrl: TESTNET.horizonUrl, address: ME, fetchImpl })
    expect(page).toMatchObject({ status: "error", kind: "network" })
  })
})

describe("fetchContractEventsPage", () => {
  function rpcEvent(id: string, topics: StellarSdk.xdr.ScVal[], amount: bigint): StellarSdk.rpc.Api.EventResponse {
    return {
      id,
      type: "contract",
      ledger: 500,
      ledgerClosedAt: "2026-11-20T12:00:00Z",
      transactionIndex: 1,
      operationIndex: 0,
      inSuccessfulContractCall: true,
      txHash: `hash-${id}`,
      contractId: new StellarSdk.Contract(CONTRACT),
      topic: topics,
      value: StellarSdk.nativeToScVal(amount, { type: "i128" }),
    }
  }
  const sym = (s: string) => StellarSdk.nativeToScVal(s, { type: "symbol" })
  const address = (a: string) => StellarSdk.nativeToScVal(a, { type: "address" })

  it("is unsupported when no token contract is configured", async () => {
    const server = { getHealth: vi.fn(), getEvents: vi.fn() } as never
    const page = await fetchContractEventsPage({ server, contractId: "", address: ME })
    expect(page).toMatchObject({ status: "unsupported" })
  })

  it("decodes mint/burn/transfer events within the retention window", async () => {
    const getEvents = vi.fn(async () => ({
      events: [
        rpcEvent("1", [sym("mint"), address(ME)], BigInt(125000000)),
        rpcEvent("2", [sym("burn"), address(ME)], BigInt(5000000)),
        rpcEvent("3", [sym("transfer"), address(OTHER), address(ME)], BigInt(10000000)),
      ],
      cursor: "c-1",
      latestLedger: 900,
      oldestLedger: 400,
    }))
    const server = { getHealth: async () => ({ oldestLedger: 400, latestLedger: 900 }), getEvents } as never

    const page = await fetchContractEventsPage({ server, contractId: CONTRACT, address: ME, limit: 3 })
    expect(getEvents).toHaveBeenCalledWith(expect.objectContaining({ startLedger: 400, limit: 3 }))
    expect(page).toMatchObject({ status: "ok", hasMore: true, nextCursor: "c-1", oldestLedger: 400 })
    if (page.status !== "ok") throw new Error("expected ok")
    expect(page.records.map((r) => [r.eventType, r.amount, r.from, r.to, r.contractId])).toEqual([
      ["mint", "12.5", null, ME, CONTRACT],
      ["burn", "0.5", ME, null, CONTRACT],
      ["transfer", "1", OTHER, ME, CONTRACT],
    ])
  })

  it("uses the cursor (and no start ledger) for subsequent pages", async () => {
    const getEvents = vi.fn(async () => ({ events: [], cursor: "", latestLedger: 900, oldestLedger: 400 }))
    const getHealth = vi.fn()
    const page = await fetchContractEventsPage({
      server: { getHealth, getEvents } as never,
      contractId: CONTRACT,
      address: ME,
      cursor: "c-1",
    })
    expect(getHealth).not.toHaveBeenCalled()
    expect(getEvents).toHaveBeenCalledWith(expect.not.objectContaining({ startLedger: expect.anything() }))
    expect(page).toMatchObject({ status: "ok", records: [], hasMore: false, nextCursor: null })
  })

  it("reports unsupported event history and RPC outages distinctly", async () => {
    const methodMissing = { getHealth: async () => ({ oldestLedger: 1 }), getEvents: async () => { throw Object.assign(new Error("method not found"), { code: -32601 }) } }
    expect(await fetchContractEventsPage({ server: methodMissing as never, contractId: CONTRACT, address: ME }))
      .toMatchObject({ status: "unsupported" })

    const outage = { getHealth: async () => { throw Object.assign(new Error("Service Unavailable"), { response: { status: 503 } }) }, getEvents: vi.fn() }
    expect(await fetchContractEventsPage({ server: outage as never, contractId: CONTRACT, address: ME }))
      .toMatchObject({ status: "error", kind: "outage" })
  })

  it("filters events touching the account in every SEP-41 position", () => {
    const filters = buildTopicFilters(ME)
    expect(filters).toHaveLength(5)
    expect(filters.every((f) => f.length <= 4)).toBe(true)
  })
})

describe("shared display model", () => {
  it("derives direction for payments and keeps the source", () => {
    const [incoming] = [payment(1)].map((r) => ({
      kind: "payment" as const,
      id: r.id,
      pagingToken: r.paging_token,
      operationType: r.type,
      createdAt: r.created_at,
      txHash: r.transaction_hash,
      from: OTHER,
      to: ME,
      amount: "1",
      asset: "XLM",
    }))
    const item = paymentToDisplay(incoming, ME, TESTNET)
    expect(item).toMatchObject({ direction: "in", source: "horizon", kind: "payment" })
    expect(item.explorerUrl).toContain("/testnet/")
    expect(paymentToDisplay({ ...incoming, from: ME, to: ME }, ME, TESTNET).direction).toBe("neutral")
    expect(paymentToDisplay({ ...incoming, from: ME, to: OTHER }, ME, TESTNET).direction).toBe("out")
  })

  it("prefers on-chain events over cooperative records for the same transaction", () => {
    const recorded = recordedEventToActivity({
      id: "db-1",
      type: "mint",
      amount: 12.5,
      tx_hash: "hash-1",
      stellar_address: ME,
      created_at: "2026-11-20T12:00:00Z",
    })
    const onChain = { ...recorded, id: "rpc-1", contractId: CONTRACT, ledger: 500 }
    const merged = mergeActivity([
      [contractEventToDisplay(recorded, ME, TESTNET, "cooperative-records")],
      [contractEventToDisplay(onChain, ME, TESTNET, "soroban-rpc")],
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0].source).toBe("soroban-rpc")
  })

  it("sorts merged activity newest first", () => {
    const base = { kind: "payment" as const, pagingToken: "", operationType: "payment", txHash: "t", from: OTHER, to: ME, amount: "1", asset: "XLM" }
    const merged = mergeActivity([
      [paymentToDisplay({ ...base, id: "old", createdAt: "2026-01-01T00:00:00Z" }, ME, TESTNET)],
      [paymentToDisplay({ ...base, id: "new", createdAt: "2026-06-01T00:00:00Z" }, ME, TESTNET)],
    ])
    expect(merged.map((m) => m.id)).toEqual(["horizon:new", "horizon:old"])
  })
})

describe("contract event robustness", () => {
  it("skips undecodable events instead of failing the page", async () => {
    const bad = {
      id: "bad",
      type: "contract",
      ledger: 1,
      ledgerClosedAt: "2026-11-20T12:00:00Z",
      transactionIndex: 0,
      operationIndex: 0,
      inSuccessfulContractCall: true,
      txHash: "h",
      topic: [StellarSdk.nativeToScVal("mint", { type: "symbol" })],
      value: StellarSdk.xdr.ScVal.scvVoid(),
    }
    const server = {
      getHealth: async () => ({ oldestLedger: 1 }),
      getEvents: async () => ({ events: [bad], cursor: "", latestLedger: 2, oldestLedger: 1 }),
    }
    const page = await fetchContractEventsPage({ server: server as never, contractId: CONTRACT, address: ME })
    expect(page).toMatchObject({ status: "ok", records: [] })
  })
})

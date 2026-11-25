import { describe, it, expect } from "vitest"
import { nativeToScVal, xdr } from "@stellar/stellar-sdk"
import {
  runIngestion,
  backfillRange,
  toIndexedRow,
  type EventSource,
  type EventStore,
  type EventPageRequest,
  type IndexedEventRow,
  type RawContractEvent,
  type StoredCursor,
  type EventGap,
} from "@/server/stellar/event-indexer"

const TOKEN = "CCYOVOFDJ5BVBSI6HADLWETTUF3BU423MEAWBSBWV2X5UVNKSJMRPBA6"
const DIST = "CBTDPLFNFGWVOD4HXDKW4EH5L3D2YGOY5CWTFCJM5TEWFL4VQTNX2UDZ"
const COOP = "00000000-0000-0000-0000-000000000001"
const MEMBER = "GCHCYTHV4JSIJNCN56EIEXZNTB6JUHYX25FTSYFOM4DDVGV7UXWOHLCW"

const sym = (s: string) => xdr.ScVal.scvSymbol(s).toXDR("base64")
const addr = (a: string) => nativeToScVal(a, { type: "address" }).toXDR("base64")
const i128 = (n: number) => nativeToScVal(BigInt(n), { type: "i128" }).toXDR("base64")

function eventId(ledger: number, n: number) {
  return `${String(ledger * 4096).padStart(19, "0")}-${String(n).padStart(10, "0")}`
}

/** Fixture: mint events from the token, one per ledger in [1000, 1000 + count). */
function fixtureEvents(count: number, firstLedger = 1000): RawContractEvent[] {
  return Array.from({ length: count }, (_, i) => {
    const ledger = firstLedger + i
    return {
      id: eventId(ledger, 1),
      ledger,
      ledgerClosedAt: new Date(Date.UTC(2026, 10, 1, 0, 0, i * 5)).toISOString(),
      txHash: `${ledger.toString(16).padStart(64, "0")}`,
      contractId: i % 3 === 2 ? DIST : TOKEN,
      transactionIndex: 1,
      operationIndex: 0,
      inSuccessfulContractCall: true,
      topicXdr: [sym("mint"), addr(MEMBER)],
      valueXdr: i128((i + 1) * 10_000_000),
    }
  })
}

/** Fake RPC honouring startLedger/endLedger/cursor/limit and a retention window. */
function fixtureSource(events: RawContractEvent[], retention: { oldestLedger: number; latestLedger: number }) {
  const calls: EventPageRequest[] = []
  const source: EventSource & { calls: EventPageRequest[]; retention: typeof retention; rejectCursor?: boolean } = {
    calls,
    retention,
    async getRetention() {
      return { ...this.retention }
    },
    async getEvents(req) {
      calls.push(req)
      if (req.cursor && this.rejectCursor) throw new Error("cursor is before the oldest ledger")
      const visible = events.filter((e) => e.ledger >= this.retention.oldestLedger && e.ledger <= this.retention.latestLedger)
      let candidates: RawContractEvent[]
      if (req.cursor) {
        candidates = visible.filter((e) => e.id > req.cursor!)
      } else {
        if (req.startLedger! < this.retention.oldestLedger) throw new Error("startLedger must be within retention")
        candidates = visible.filter((e) => e.ledger >= req.startLedger! && (req.endLedger === undefined || e.ledger < req.endLedger))
      }
      candidates = candidates.filter((e) => req.contractIds.includes(e.contractId))
      const page = candidates.slice(0, req.limit)
      const cursor = page.length ? page[page.length - 1].id : eventId(this.retention.latestLedger, 9999)
      return { events: page, cursor, latestLedger: this.retention.latestLedger, oldestLedger: this.retention.oldestLedger }
    },
  }
  return source
}

function memoryStore() {
  const rows = new Map<string, IndexedEventRow>()
  const cursors = new Map<string, StoredCursor>()
  const gaps: (Required<EventGap> & { resolved: boolean })[] = []
  let failNextCursorSave = false
  const store: EventStore & {
    rows: typeof rows
    cursors: typeof cursors
    gaps: typeof gaps
    failNextCursorSave: () => void
  } = {
    rows,
    cursors,
    gaps,
    failNextCursorSave: () => {
      failNextCursorSave = true
    },
    async getCursor(stream) {
      return cursors.get(stream) ?? null
    },
    async saveCursor(stream, _network, cursor) {
      if (failNextCursorSave) {
        failNextCursorSave = false
        throw new Error("simulated crash before cursor commit")
      }
      cursors.set(stream, cursor)
    },
    async upsertEvents(batch) {
      let inserted = 0
      for (const r of batch) {
        const key = `${r.network}|${r.event_id}`
        if (!rows.has(key)) {
          rows.set(key, r)
          inserted++
        }
      }
      return inserted
    },
    async recordGap(g) {
      if (!gaps.some((x) => x.stream === g.stream && x.fromLedger === g.fromLedger && x.toLedger === g.toLedger)) {
        gaps.push({ ...g, id: `gap-${gaps.length + 1}`, resolved: false })
      }
    },
    async listOpenGaps(stream) {
      return gaps.filter((g) => g.stream === stream && !g.resolved)
    },
    async resolveGap(id) {
      const g = gaps.find((x) => x.id === id)
      if (g) g.resolved = true
    },
  }
  return store
}

const base = (source: EventSource, store: EventStore) => ({
  source,
  store,
  network: "TESTNET",
  contractIds: [TOKEN, DIST],
  cooperativeByContract: new Map([
    [TOKEN, COOP],
    [DIST, COOP],
  ]),
  stream: "TESTNET:test",
  pageSize: 10,
  maxPages: 50,
  maxBackfillLedgers: 1000,
})

describe("event indexer — replay & idempotency", () => {
  it("replaying the same fixture range twice produces no duplicates", async () => {
    const events = fixtureEvents(35)
    const source = fixtureSource(events, { oldestLedger: 900, latestLedger: 1100 })
    const store = memoryStore()

    const first = await runIngestion({ ...base(source, store), startLedger: 1000 })
    expect(first.inserted).toBe(35)
    expect(first.caughtUp).toBe(true)
    expect(store.rows.size).toBe(35)

    // Full replay from scratch (cursor wiped) over the same range
    store.cursors.clear()
    const replay = await runIngestion({ ...base(source, store), startLedger: 1000 })
    expect(replay.fetched).toBe(35)
    expect(replay.inserted).toBe(0)
    expect(store.rows.size).toBe(35)

    // Incremental run from the stored cursor finds nothing new
    const again = await runIngestion(base(source, store))
    expect(again.inserted).toBe(0)
    expect(store.rows.size).toBe(35)
  })

  it("persists network, contract, ledger, transaction and event identity with decoded data", async () => {
    const [event] = fixtureEvents(1)
    const row = toIndexedRow(event, "TESTNET", new Map([[TOKEN, COOP]]))
    expect(row).toMatchObject({
      network: "TESTNET",
      contract_id: TOKEN,
      event_id: event.id,
      ledger: 1000,
      tx_hash: event.txHash,
      event_type: "mint",
      cooperative_id: COOP,
      topics: ["mint", MEMBER],
      value: "10000000",
    })
    expect(row.topics_xdr).toEqual(event.topicXdr)
  })

  it("is restartable: a crash between persisting events and the cursor replays safely", async () => {
    const source = fixtureSource(fixtureEvents(25), { oldestLedger: 900, latestLedger: 1100 })
    const store = memoryStore()

    store.failNextCursorSave()
    await expect(runIngestion({ ...base(source, store), startLedger: 1000 })).rejects.toThrow(/simulated crash/)
    expect(store.rows.size).toBe(10) // first page persisted, cursor not advanced
    expect(store.cursors.size).toBe(0)

    const resumed = await runIngestion({ ...base(source, store), startLedger: 1000 })
    expect(resumed.inserted).toBe(15)
    expect(store.rows.size).toBe(25)
  })

  it("bounds work per run and continues from the durable cursor", async () => {
    const source = fixtureSource(fixtureEvents(40), { oldestLedger: 900, latestLedger: 1100 })
    const store = memoryStore()

    const r1 = await runIngestion({ ...base(source, store), startLedger: 1000, maxPages: 2 })
    expect(r1.inserted).toBe(20)
    expect(r1.caughtUp).toBe(false)

    const r2 = await runIngestion({ ...base(source, store), maxPages: 2 })
    expect(r2.inserted).toBe(20)
    expect(store.rows.size).toBe(40)
    expect(source.calls.at(-2)).toHaveProperty("cursor")
  })

  it("bounds the initial backfill on a fresh stream", async () => {
    const source = fixtureSource(fixtureEvents(50), { oldestLedger: 900, latestLedger: 1049 })
    const store = memoryStore()

    const r = await runIngestion({ ...base(source, store), maxBackfillLedgers: 20 })
    expect(r.fromLedger).toBe(1029)
    expect(store.rows.size).toBe(21)
  })
})

describe("event indexer — gap detection & recovery", () => {
  it("detects a cursor that fell outside retention, records the gap and resumes", async () => {
    const events = fixtureEvents(60)
    const source = fixtureSource(events, { oldestLedger: 900, latestLedger: 1100 })
    const store = memoryStore()

    await runIngestion({ ...base(source, store), startLedger: 1000, maxPages: 1 })
    expect(store.rows.size).toBe(10)
    const stalled = store.cursors.get("TESTNET:test")!
    expect(stalled.lastLedger).toBe(1009)

    // Indexer offline long enough for RPC to prune ledgers 1010..1029
    source.retention.oldestLedger = 1030
    const r = await runIngestion(base(source, store))

    expect(r.gapsDetected).toEqual([
      expect.objectContaining({ fromLedger: 1010, toLedger: 1029, reason: expect.stringMatching(/retention/) }),
    ])
    expect(store.gaps).toHaveLength(1)
    expect(r.inserted).toBe(30) // ledgers 1030..1059
    expect([...store.rows.values()].some((row) => row.ledger === 1015)).toBe(false)

    // Recovery: archive RPC with longer retention backfills the gap, idempotently
    const archive = fixtureSource(events, { oldestLedger: 900, latestLedger: 1100 })
    const gap = (await store.listOpenGaps("TESTNET:test"))[0]
    const fill = await backfillRange({ ...base(archive, store), fromLedger: gap.fromLedger, toLedger: gap.toLedger, gapId: gap.id })

    expect(fill).toEqual({ fetched: 20, inserted: 20, complete: true })
    expect(store.rows.size).toBe(60)
    expect(await store.listOpenGaps("TESTNET:test")).toHaveLength(0)

    // Re-running the backfill is a no-op
    const again = await backfillRange({ ...base(archive, store), fromLedger: gap.fromLedger, toLedger: gap.toLedger })
    expect(again.inserted).toBe(0)
    expect(store.rows.size).toBe(60)
  })

  it("recovers when the RPC rejects the stored cursor", async () => {
    const source = fixtureSource(fixtureEvents(30), { oldestLedger: 900, latestLedger: 1100 })
    const store = memoryStore()
    await runIngestion({ ...base(source, store), startLedger: 1000, maxPages: 1 })

    source.rejectCursor = true
    source.retention.oldestLedger = 1015
    store.cursors.set("TESTNET:test", { cursor: "stale", lastLedger: 1020 }) // within retention but unknown cursor
    const r = await runIngestion(base(source, store))

    expect(r.gapsDetected).toHaveLength(0) // 1021 >= oldest: nothing missing, just restarted by ledger
    expect(source.calls.some((c) => c.startLedger === 1021)).toBe(true)
    expect(store.rows.size).toBe(10 + 9) // ledgers 1021..1029 newly indexed
  })

  it("refuses backfills beyond the bound or outside retention", async () => {
    const source = fixtureSource(fixtureEvents(10), { oldestLedger: 1000, latestLedger: 1100 })
    const store = memoryStore()
    await expect(
      backfillRange({ ...base(source, store), maxBackfillLedgers: 5, fromLedger: 1000, toLedger: 1009 })
    ).rejects.toThrow(/bound/)
    await expect(backfillRange({ ...base(source, store), fromLedger: 950, toLedger: 960 })).rejects.toThrow(/retention/)
  })

  it("records an initial start ledger that is already pruned as a gap", async () => {
    const source = fixtureSource(fixtureEvents(20), { oldestLedger: 1010, latestLedger: 1100 })
    const store = memoryStore()
    const r = await runIngestion({ ...base(source, store), startLedger: 1000 })
    expect(r.gapsDetected).toEqual([expect.objectContaining({ fromLedger: 1000, toLedger: 1009 })])
    expect(store.rows.size).toBe(10)
  })
})

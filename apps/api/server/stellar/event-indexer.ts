/**
 * Soroban contract event indexer.
 *
 * Guarantees:
 * - Durable cursor: events are persisted *before* the cursor advances, so a crash
 *   between the two simply replays the last page.
 * - Idempotent: rows are keyed by (network, event_id); replays never duplicate.
 * - Gap detection: if the stored position has fallen out of the RPC retention
 *   window (or the RPC rejects the cursor), the missing range is recorded in
 *   chain_event_gaps and ingestion resumes from the oldest available ledger.
 * - Bounded work: each run processes at most `maxPages` pages, and initial / gap
 *   backfills are capped at `maxBackfillLedgers`.
 *
 * Indexed history is a read model for cooperative generation/allocation activity.
 * The source of truth remains the chain.
 */
import { scValToNative, xdr, type rpc } from "@stellar/stellar-sdk"

export interface RawContractEvent {
  id: string
  ledger: number
  ledgerClosedAt: string | null
  txHash: string
  contractId: string
  transactionIndex: number | null
  operationIndex: number | null
  inSuccessfulContractCall: boolean
  topicXdr: string[]
  valueXdr: string
}

export interface EventPage {
  events: RawContractEvent[]
  cursor: string
  latestLedger: number
  oldestLedger: number
}

export type EventPageRequest =
  | { contractIds: string[]; limit: number; startLedger: number; endLedger?: number; cursor?: never }
  | { contractIds: string[]; limit: number; cursor: string; startLedger?: never; endLedger?: never }

export interface EventSource {
  getRetention(): Promise<{ oldestLedger: number; latestLedger: number }>
  getEvents(req: EventPageRequest): Promise<EventPage>
}

export interface IndexedEventRow {
  network: string
  contract_id: string
  event_id: string
  ledger: number
  ledger_closed_at: string | null
  tx_hash: string
  transaction_index: number | null
  operation_index: number | null
  event_type: string
  topics: unknown[]
  value: unknown
  topics_xdr: string[]
  value_xdr: string
  in_successful_contract_call: boolean
  cooperative_id: string | null
}

export interface StoredCursor {
  cursor: string | null
  lastLedger: number
}

export interface EventGap {
  id?: string
  stream: string
  network: string
  fromLedger: number
  toLedger: number
  reason: string
}

export interface EventStore {
  getCursor(stream: string): Promise<StoredCursor | null>
  saveCursor(stream: string, network: string, cursor: StoredCursor): Promise<void>
  /** Must ignore rows whose (network, event_id) already exists. Returns rows newly inserted. */
  upsertEvents(rows: IndexedEventRow[]): Promise<number>
  recordGap(gap: EventGap): Promise<void>
  listOpenGaps(stream: string): Promise<Required<EventGap>[]>
  resolveGap(id: string): Promise<void>
}

export interface IndexerOptions {
  source: EventSource
  store: EventStore
  network: string
  contractIds: string[]
  /** contract ID → cooperative UUID, for cooperative-scoped history. */
  cooperativeByContract: Map<string, string>
  stream?: string
  pageSize?: number
  maxPages?: number
  maxBackfillLedgers?: number
  /** Optional first ledger to index on a fresh stream. */
  startLedger?: number
}

export interface IngestionResult {
  stream: string
  pages: number
  fetched: number
  inserted: number
  fromLedger: number | null
  lastLedger: number | null
  gapsDetected: EventGap[]
  caughtUp: boolean
}

/** RPC getEvents accepts at most 5 filters × 5 contract IDs. */
export const MAX_CONTRACTS_PER_STREAM = 25

const DEFAULTS = { pageSize: 100, maxPages: 20, maxBackfillLedgers: 17_280 /* ~24h of ledgers */ }

export function streamKey(network: string, contractIds: string[]): string {
  return `${network}:${[...contractIds].sort().join(",")}`
}

function jsonSafe(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => {
      if (typeof v === "bigint") return v.toString()
      if (v instanceof Uint8Array) return Buffer.from(v).toString("hex")
      return v
    })
  )
}

function decodeScVal(b64: string): unknown {
  try {
    return jsonSafe(scValToNative(xdr.ScVal.fromXDR(b64, "base64")))
  } catch {
    return null
  }
}

export function toIndexedRow(
  event: RawContractEvent,
  network: string,
  cooperativeByContract: Map<string, string>
): IndexedEventRow {
  const topics = event.topicXdr.map(decodeScVal)
  const first = topics[0]
  return {
    network,
    contract_id: event.contractId,
    event_id: event.id,
    ledger: event.ledger,
    ledger_closed_at: event.ledgerClosedAt,
    tx_hash: event.txHash,
    transaction_index: event.transactionIndex,
    operation_index: event.operationIndex,
    event_type: typeof first === "string" ? first : "unknown",
    topics,
    value: decodeScVal(event.valueXdr),
    topics_xdr: event.topicXdr,
    value_xdr: event.valueXdr,
    in_successful_contract_call: event.inSuccessfulContractCall,
    cooperative_id: cooperativeByContract.get(event.contractId) ?? null,
  }
}

function isCursorRejected(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /cursor|start(Ledger)? must be|out of range|before the oldest|ledger range/i.test(msg)
}

export async function runIngestion(opts: IndexerOptions): Promise<IngestionResult> {
  const { source, store, network, contractIds, cooperativeByContract } = opts
  const pageSize = opts.pageSize ?? DEFAULTS.pageSize
  const maxPages = opts.maxPages ?? DEFAULTS.maxPages
  const maxBackfill = opts.maxBackfillLedgers ?? DEFAULTS.maxBackfillLedgers

  if (contractIds.length === 0) throw new Error("No contracts configured for indexing")
  if (contractIds.length > MAX_CONTRACTS_PER_STREAM) {
    throw new Error(`At most ${MAX_CONTRACTS_PER_STREAM} contracts per stream`)
  }

  const stream = opts.stream ?? streamKey(network, contractIds)
  const result: IngestionResult = {
    stream,
    pages: 0,
    fetched: 0,
    inserted: 0,
    fromLedger: null,
    lastLedger: null,
    gapsDetected: [],
    caughtUp: false,
  }

  const retention = await source.getRetention()
  const stored = await store.getCursor(stream)

  const addGap = async (fromLedger: number, toLedger: number, reason: string) => {
    if (toLedger < fromLedger) return
    const gap: EventGap = { stream, network, fromLedger, toLedger, reason }
    await store.recordGap(gap)
    result.gapsDetected.push(gap)
  }

  // Decide where to start.
  let position: { cursor: string } | { startLedger: number }
  if (!stored) {
    const boundedStart = Math.max(retention.oldestLedger, retention.latestLedger - maxBackfill)
    const requested = opts.startLedger ?? boundedStart
    const start = Math.max(requested, boundedStart)
    if (opts.startLedger !== undefined && opts.startLedger < start) {
      await addGap(opts.startLedger, start - 1, "initial backfill exceeds retention or bound")
    }
    position = { startLedger: start }
    result.fromLedger = start
  } else if (stored.lastLedger + 1 < retention.oldestLedger) {
    await addGap(stored.lastLedger + 1, retention.oldestLedger - 1, "cursor fell outside RPC retention window")
    position = { startLedger: retention.oldestLedger }
    result.fromLedger = retention.oldestLedger
  } else if (stored.cursor) {
    position = { cursor: stored.cursor }
    result.fromLedger = stored.lastLedger
  } else {
    position = { startLedger: stored.lastLedger + 1 }
    result.fromLedger = stored.lastLedger + 1
  }

  let lastLedger = stored?.lastLedger ?? null

  for (let page = 0; page < maxPages; page++) {
    let response: EventPage
    try {
      response = await source.getEvents({ contractIds, limit: pageSize, ...position } as EventPageRequest)
    } catch (err) {
      if ("cursor" in position && isCursorRejected(err)) {
        // The RPC no longer recognises the cursor: record what may be missing and restart.
        const fresh = await source.getRetention()
        const from = (lastLedger ?? fresh.oldestLedger - 1) + 1
        await addGap(from, fresh.oldestLedger - 1, "RPC rejected stored cursor")
        position = { startLedger: Math.max(fresh.oldestLedger, from) }
        continue
      }
      throw err
    }

    result.pages++
    result.fetched += response.events.length

    // 1) Persist events (idempotent), 2) then advance the cursor.
    if (response.events.length > 0) {
      const rows = response.events.map((e) => toIndexedRow(e, network, cooperativeByContract))
      result.inserted += await store.upsertEvents(rows)
    }

    const caughtUp = response.events.length < pageSize
    const pageLedger = caughtUp
      ? response.latestLedger
      : response.events[response.events.length - 1].ledger
    lastLedger = Math.max(lastLedger ?? 0, pageLedger)

    await store.saveCursor(stream, network, { cursor: response.cursor, lastLedger })
    position = { cursor: response.cursor }

    if (caughtUp) {
      result.caughtUp = true
      break
    }
  }

  result.lastLedger = lastLedger
  return result
}

export interface BackfillOptions extends Omit<IndexerOptions, "startLedger"> {
  fromLedger: number
  toLedger: number
  gapId?: string
}

/**
 * Re-ingest a closed ledger range (e.g. an open gap) without moving the live cursor.
 * Bounded by `maxBackfillLedgers`; idempotent, so it can be re-run safely.
 */
export async function backfillRange(opts: BackfillOptions): Promise<{ fetched: number; inserted: number; complete: boolean }> {
  const { source, store, network, contractIds, cooperativeByContract, fromLedger, toLedger } = opts
  const pageSize = opts.pageSize ?? DEFAULTS.pageSize
  const maxPages = opts.maxPages ?? DEFAULTS.maxPages
  const maxBackfill = opts.maxBackfillLedgers ?? DEFAULTS.maxBackfillLedgers

  if (toLedger < fromLedger) throw new Error("toLedger must be >= fromLedger")
  if (toLedger - fromLedger + 1 > maxBackfill) {
    throw new Error(`Backfill range exceeds the ${maxBackfill}-ledger bound; split it into smaller ranges`)
  }

  const retention = await source.getRetention()
  if (fromLedger < retention.oldestLedger) {
    throw new Error(
      `Ledger ${fromLedger} is older than the RPC retention window (oldest ${retention.oldestLedger}); ` +
        `use an archive RPC with longer retention`
    )
  }

  let fetched = 0
  let inserted = 0
  let position: { cursor: string } | { startLedger: number; endLedger: number } = {
    startLedger: fromLedger,
    endLedger: toLedger + 1, // endLedger is exclusive
  }

  for (let page = 0; page < maxPages; page++) {
    const response = await source.getEvents({ contractIds, limit: pageSize, ...position } as EventPageRequest)
    const inRange = response.events.filter((e) => e.ledger >= fromLedger && e.ledger <= toLedger)
    fetched += inRange.length
    if (inRange.length > 0) {
      inserted += await store.upsertEvents(inRange.map((e) => toIndexedRow(e, network, cooperativeByContract)))
    }
    const passedEnd = response.events.some((e) => e.ledger > toLedger)
    if (response.events.length < pageSize || passedEnd) {
      if (opts.gapId) await store.resolveGap(opts.gapId)
      return { fetched, inserted, complete: true }
    }
    position = { cursor: response.cursor }
  }

  return { fetched, inserted, complete: false }
}

/** Adapter from the Stellar RPC client to the indexer's EventSource. */
export function rpcEventSource(server: rpc.Server): EventSource {
  return {
    async getRetention() {
      const health = await server.getHealth()
      return { oldestLedger: health.oldestLedger, latestLedger: health.latestLedger }
    },
    async getEvents(req) {
      const filters = []
      for (let i = 0; i < req.contractIds.length; i += 5) {
        filters.push({ type: "contract" as const, contractIds: req.contractIds.slice(i, i + 5) })
      }
      const request: rpc.Api.GetEventsRequest = req.cursor
        ? { filters, cursor: req.cursor, limit: req.limit }
        : { filters, startLedger: req.startLedger!, endLedger: req.endLedger, limit: req.limit }
      const res = await server.getEvents(request)
      return {
        cursor: res.cursor,
        latestLedger: res.latestLedger,
        oldestLedger: res.oldestLedger,
        events: res.events.map((e) => ({
          id: e.id,
          ledger: e.ledger,
          ledgerClosedAt: e.ledgerClosedAt ?? null,
          txHash: e.txHash,
          contractId: e.contractId ? e.contractId.contractId() : "",
          transactionIndex: e.transactionIndex ?? null,
          operationIndex: e.operationIndex ?? null,
          inSuccessfulContractCall: e.inSuccessfulContractCall,
          topicXdr: e.topic.map((t) => t.toXDR("base64")),
          valueXdr: e.value.toXDR("base64"),
        })),
      }
    },
  }
}

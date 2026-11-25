import * as StellarSdk from "@stellar/stellar-sdk"
import { supabase } from "@/lib/supabase"
import { getStellarConfigReport } from "./network-config"
import { backfillRange, rpcEventSource, runIngestion, type EventSource, type IngestionResult } from "./event-indexer"
import { resolveIndexedContracts, supabaseEventStore } from "./event-store-supabase"

export interface IndexerRunSummary extends IngestionResult {
  network: string
  contracts: number
  gapsBackfilled: { fromLedger: number; toLedger: number; inserted: number; complete: boolean; error?: string }[]
}

function intEnv(name: string): number | undefined {
  const raw = process.env[name]
  if (!raw) return undefined
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : undefined
}

/** One bounded ingestion pass for the configured network, optionally retrying open gaps. */
export async function runConfiguredIndexer(opts: { backfillGaps?: boolean; source?: EventSource } = {}) {
  const config = getStellarConfigReport()
  if (config.errors.length > 0 || !config.network) {
    throw new Error(`Stellar configuration invalid: ${config.errors.map((e) => e.code).join(", ")}`)
  }
  const network = config.network

  const rpcUrl = process.env.INDEXER_RPC_URL || config.rpcUrl
  if (!rpcUrl && !opts.source) throw new Error("No RPC URL configured for the indexer")
  const source =
    opts.source ?? rpcEventSource(new StellarSdk.rpc.Server(rpcUrl!, { allowHttp: network === "LOCAL" }))

  const store = supabaseEventStore(supabase)
  const { contractIds, cooperativeByContract } = await resolveIndexedContracts(
    supabase,
    Object.values(config.contracts).filter((c): c is string => Boolean(c)),
    process.env.INDEXER_DEFAULT_COOPERATIVE_ID || undefined
  )

  const common = {
    source,
    store,
    network,
    contractIds,
    cooperativeByContract,
    stream: `${network}:cooperative-contracts`,
    pageSize: intEnv("INDEXER_PAGE_SIZE"),
    maxPages: intEnv("INDEXER_MAX_PAGES"),
    maxBackfillLedgers: intEnv("INDEXER_MAX_BACKFILL_LEDGERS"),
  }

  const result = await runIngestion({ ...common, startLedger: intEnv("INDEXER_START_LEDGER") })

  const gapsBackfilled: IndexerRunSummary["gapsBackfilled"] = []
  if (opts.backfillGaps) {
    for (const gap of await store.listOpenGaps(common.stream)) {
      try {
        const r = await backfillRange({ ...common, fromLedger: gap.fromLedger, toLedger: gap.toLedger, gapId: gap.id })
        gapsBackfilled.push({ fromLedger: gap.fromLedger, toLedger: gap.toLedger, inserted: r.inserted, complete: r.complete })
      } catch (err) {
        gapsBackfilled.push({
          fromLedger: gap.fromLedger,
          toLedger: gap.toLedger,
          inserted: 0,
          complete: false,
          error: err instanceof Error ? err.message : "backfill failed",
        })
      }
    }
  }

  const summary: IndexerRunSummary = { ...result, network, contracts: contractIds.length, gapsBackfilled }
  return summary
}

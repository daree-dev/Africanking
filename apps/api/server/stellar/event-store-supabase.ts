import type { SupabaseClient } from "@supabase/supabase-js"
import type { EventGap, EventStore, IndexedEventRow, StoredCursor } from "./event-indexer"

export function supabaseEventStore(db: SupabaseClient): EventStore {
  return {
    async getCursor(stream) {
      const { data, error } = await db
        .from("chain_event_cursors")
        .select("cursor, last_ledger")
        .eq("stream", stream)
        .maybeSingle()
      if (error) throw new Error(`load cursor: ${error.message}`)
      return data ? { cursor: data.cursor, lastLedger: Number(data.last_ledger) } : null
    },

    async saveCursor(stream, network, cursor: StoredCursor) {
      const { error } = await db.from("chain_event_cursors").upsert(
        {
          stream,
          network,
          cursor: cursor.cursor,
          last_ledger: cursor.lastLedger,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "stream" }
      )
      if (error) throw new Error(`save cursor: ${error.message}`)
    },

    async upsertEvents(rows: IndexedEventRow[]) {
      if (rows.length === 0) return 0
      const { data, error } = await db
        .from("chain_events")
        .upsert(rows, { onConflict: "network,event_id", ignoreDuplicates: true })
        .select("id")
      if (error) throw new Error(`upsert events: ${error.message}`)
      return data?.length ?? 0
    },

    async recordGap(gap: EventGap) {
      const { error } = await db.from("chain_event_gaps").upsert(
        {
          stream: gap.stream,
          network: gap.network,
          from_ledger: gap.fromLedger,
          to_ledger: gap.toLedger,
          reason: gap.reason,
        },
        { onConflict: "stream,from_ledger,to_ledger", ignoreDuplicates: true }
      )
      if (error) throw new Error(`record gap: ${error.message}`)
    },

    async listOpenGaps(stream) {
      const { data, error } = await db
        .from("chain_event_gaps")
        .select("id, stream, network, from_ledger, to_ledger, reason")
        .eq("stream", stream)
        .is("resolved_at", null)
        .order("from_ledger", { ascending: true })
      if (error) throw new Error(`list gaps: ${error.message}`)
      return (data ?? []).map((g) => ({
        id: g.id as string,
        stream: g.stream as string,
        network: g.network as string,
        fromLedger: Number(g.from_ledger),
        toLedger: Number(g.to_ledger),
        reason: g.reason as string,
      }))
    },

    async resolveGap(id) {
      const { error } = await db
        .from("chain_event_gaps")
        .update({ resolved_at: new Date().toISOString() })
        .eq("id", id)
      if (error) throw new Error(`resolve gap: ${error.message}`)
    },
  }
}

/**
 * Contracts to index and their owning cooperative: every cooperative's token and
 * distribution contract, plus the globally configured contracts (mapped to
 * INDEXER_DEFAULT_COOPERATIVE_ID when set).
 */
export async function resolveIndexedContracts(
  db: SupabaseClient,
  configured: string[],
  defaultCooperativeId?: string
): Promise<{ contractIds: string[]; cooperativeByContract: Map<string, string> }> {
  const { data, error } = await db
    .from("cooperatives")
    .select("id, token_contract_address, distribution_contract_address")
  if (error) throw new Error(`load cooperatives: ${error.message}`)

  const cooperativeByContract = new Map<string, string>()
  for (const coop of data ?? []) {
    for (const addr of [coop.token_contract_address, coop.distribution_contract_address]) {
      if (addr) cooperativeByContract.set(addr, coop.id)
    }
  }
  for (const id of configured) {
    if (defaultCooperativeId && !cooperativeByContract.has(id)) cooperativeByContract.set(id, defaultCooperativeId)
  }

  const contractIds = [...new Set([...configured, ...cooperativeByContract.keys()])].sort()
  return { contractIds, cooperativeByContract }
}

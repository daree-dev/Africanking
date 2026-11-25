/**
 * Map source-specific activity into the shared display model.
 */

import { explorerTxUrl, type StellarNetworkConfig } from "@/lib/stellar-network"
import type {
  ActivityDisplayItem,
  ActivitySource,
  ActivitySourceKind,
  ContractEventActivity,
  PaymentActivity,
} from "./types"

export function paymentToDisplay(
  p: PaymentActivity,
  address: string,
  network: StellarNetworkConfig
): ActivityDisplayItem {
  const direction: ActivityDisplayItem["direction"] =
    p.to === address && p.from !== address ? "in" : p.from === address && p.to !== address ? "out" : "neutral"
  return {
    id: `horizon:${p.id}`,
    kind: "payment",
    label: p.operationType.replace(/_/g, " "),
    createdAt: p.createdAt,
    txHash: p.txHash,
    amount: p.amount,
    asset: p.asset,
    direction,
    icon: "payment",
    source: "horizon",
    explorerUrl: explorerTxUrl(network, p.txHash),
  }
}

const EVENT_LABELS: Record<ContractEventActivity["eventType"], string> = {
  mint: "Token Mint",
  burn: "Token Burn",
  transfer: "Token Transfer",
}

export function contractEventToDisplay(
  e: ContractEventActivity,
  address: string,
  network: StellarNetworkConfig,
  source: Extract<ActivitySourceKind, "soroban-rpc" | "cooperative-records">
): ActivityDisplayItem {
  let direction: ActivityDisplayItem["direction"] = "neutral"
  if (e.eventType === "mint") direction = "in"
  else if (e.eventType === "burn") direction = "out"
  else if (e.to === address && e.from !== address) direction = "in"
  else if (e.from === address) direction = "out"

  return {
    id: `${source}:${e.id}`,
    kind: "contract_event",
    label: EVENT_LABELS[e.eventType],
    createdAt: e.createdAt,
    txHash: e.txHash || null,
    amount: e.amount,
    asset: e.asset,
    direction,
    icon: e.eventType === "transfer" ? "payment" : e.eventType,
    source,
    explorerUrl: e.txHash ? explorerTxUrl(network, e.txHash) : null,
  }
}

/** Recorded mint/burn rows from the cooperative `events` table. */
export interface RecordedEvent {
  id: string
  type: "mint" | "burn"
  amount: number
  tx_hash: string
  stellar_address: string
  created_at: string
}

export function recordedEventToActivity(e: RecordedEvent): ContractEventActivity {
  return {
    kind: "contract_event",
    id: e.id,
    eventType: e.type,
    contractId: null,
    createdAt: e.created_at,
    txHash: e.tx_hash,
    from: e.type === "burn" ? e.stellar_address : null,
    to: e.type === "mint" ? e.stellar_address : null,
    amount: String(e.amount),
    asset: "HDROP",
    ledger: null,
  }
}

const SOURCE_PRIORITY: Record<ActivitySourceKind, number> = {
  "soroban-rpc": 0,
  horizon: 1,
  "cooperative-records": 2,
}

/**
 * Merge display items from all sources, newest first. When the same
 * transaction appears as an on-chain contract event and as a cooperative
 * record, the on-chain row wins.
 */
export function mergeActivity(groups: ActivityDisplayItem[][]): ActivityDisplayItem[] {
  const byKey = new Map<string, ActivityDisplayItem>()
  for (const item of groups.flat()) {
    const key = item.kind === "contract_event" && item.txHash ? `event:${item.txHash}:${item.label}` : item.id
    const existing = byKey.get(key)
    if (!existing || SOURCE_PRIORITY[item.source] < SOURCE_PRIORITY[existing.source]) {
      byKey.set(key, item)
    }
  }
  return [...byKey.values()].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

export function describeSource(source: ActivitySource): string {
  const names: Record<ActivitySourceKind, string> = {
    horizon: "Horizon",
    "soroban-rpc": "Soroban RPC",
    "cooperative-records": "Cooperative records",
  }
  return `${names[source.kind]} · ${source.network} · ${source.endpoint}`
}

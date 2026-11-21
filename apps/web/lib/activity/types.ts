/**
 * Activity model.
 *
 * Horizon's payments endpoint describes classic operations (payments,
 * account creation, path payments). It does not describe Soroban token
 * movements: those are contract events, served by Soroban RPC. The two
 * are kept as separate source types and only merged at the display layer.
 */

import type { StellarNetworkName } from "@/lib/stellar-network"

export type ActivitySourceKind = "horizon" | "soroban-rpc" | "cooperative-records"

export interface ActivitySource {
  kind: ActivitySourceKind
  network: StellarNetworkName
  /** Endpoint host the data came from, shown to users */
  endpoint: string
}

/** A classic payment-like operation from Horizon `/accounts/:id/payments`. */
export interface PaymentActivity {
  kind: "payment"
  id: string
  pagingToken: string
  operationType: string
  createdAt: string
  txHash: string
  from: string | null
  to: string | null
  amount: string | null
  asset: string
}

export type ContractEventType = "mint" | "burn" | "transfer"

/** A token contract event (from Soroban RPC, or recorded by the cooperative API). */
export interface ContractEventActivity {
  kind: "contract_event"
  id: string
  eventType: ContractEventType
  contractId: string | null
  createdAt: string
  txHash: string
  from: string | null
  to: string | null
  /** Display units (already divided by 10^7) */
  amount: string
  asset: string
  ledger: number | null
}

export type ActivityDirection = "in" | "out" | "neutral"

/** Shared display model for every activity row regardless of source. */
export interface ActivityDisplayItem {
  id: string
  kind: PaymentActivity["kind"] | ContractEventActivity["kind"]
  label: string
  createdAt: string
  txHash: string | null
  amount: string | null
  asset: string
  direction: ActivityDirection
  /** Icon hint for the UI */
  icon: "payment" | "mint" | "burn"
  source: ActivitySourceKind
  explorerUrl: string | null
}

export type FetchErrorKind = "outage" | "rate_limited" | "network" | "bad_response"

/** Outcome of fetching one page from a source. */
export type PageResult<T> =
  | { status: "ok"; records: T[]; nextCursor: string | null; hasMore: boolean }
  | { status: "account_not_found" }
  | { status: "unsupported"; reason: string }
  | { status: "error"; kind: FetchErrorKind; message: string }

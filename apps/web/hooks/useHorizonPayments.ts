"use client"

import { useCallback } from "react"
import { STELLAR_CONFIG } from "@/lib/contracts-config"
import { useChainRead } from "@/hooks/useChainRead"
import type { FreshnessStatus } from "@/lib/stellar/resilience"

export interface HorizonPayment {
  id: string
  type: string
  created_at: string
  transaction_hash: string
  asset_type: string
  asset_code?: string
  asset_issuer?: string
  from?: string
  to?: string
  amount?: string
  // For create_account operations (e.g. Friendbot funding)
  funder?: string
  account?: string
  starting_balance?: string
  // For path_payment, etc.
  source_amount?: string
  source_asset_code?: string
}

interface UseHorizonPaymentsResult {
  payments: HorizonPayment[]
  isLoading: boolean
  error: string | null
  refetch: () => void
  freshness: FreshnessStatus
  fetchedAt: number | null
  retry: { attempt: number; maxAttempts: number; nextRetryAt: number } | null
}

class HorizonHttpError extends Error {
  constructor(readonly status: number) {
    super(`Horizon API error: ${status}`)
  }
}

export async function fetchHorizonPayments(address: string, fetchImpl: typeof fetch = fetch): Promise<HorizonPayment[]> {
  const url = `${STELLAR_CONFIG.HORIZON_URL}/accounts/${address}/payments?order=desc&limit=50`
  const response = await fetchImpl(url)
  if (!response.ok) {
    // Account not yet funded on testnet — the network positively says "no payments".
    if (response.status === 404) return []
    throw new HorizonHttpError(response.status)
  }
  const data = await response.json()
  return data._embedded?.records ?? []
}

/**
 * Payments from Horizon. During an outage the last good page is served from
 * cache (flagged via `freshness`) instead of an empty list that would imply
 * the account has no activity.
 */
export function useHorizonPayments(address: string | null): UseHorizonPaymentsResult {
  const fetcher = useCallback(() => fetchHorizonPayments(address!), [address])
  const state = useChainRead(address ? `horizon.payments:${address}` : null, fetcher, "horizon.payments")

  return {
    payments: state.value ?? [],
    isLoading: !!address && (state.status === "loading" || (state.isRefreshing && state.value === null)),
    // Stale data is surfaced through `freshness`, not as an error that hides it.
    error: state.status === "unavailable" ? state.error : null,
    refetch: state.refetch,
    freshness: state.status,
    fetchedAt: state.fetchedAt,
    retry: state.retry,
  }
}

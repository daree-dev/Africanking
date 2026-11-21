"use client"

import { useCallback, useMemo } from "react"
import { APP_NETWORK, type StellarNetworkConfig } from "@/lib/stellar-network"
import { fetchPaymentsPage } from "@/lib/activity/horizon"
import type { ActivitySource, PaymentActivity } from "@/lib/activity/types"
import { usePagedActivity, type PagedActivityState } from "./usePagedActivity"

export type { PaymentActivity } from "@/lib/activity/types"

export interface UseHorizonPaymentsResult extends PagedActivityState<PaymentActivity> {
  /** Alias of `records` kept for existing callers */
  payments: PaymentActivity[]
  source: ActivitySource
}

/**
 * Classic payment history from Horizon for `address`, on the app's single
 * validated network. Soroban token activity is NOT included — use
 * `useContractEvents` for that.
 */
export function useHorizonPayments(
  address: string | null,
  network: StellarNetworkConfig = APP_NETWORK,
  pageSize = 50
): UseHorizonPaymentsResult {
  const key = address ? `${network.network}|${network.horizonUrl}|${address}` : null

  const fetchPage = useCallback(
    (cursor: string | null) =>
      fetchPaymentsPage({ horizonUrl: network.horizonUrl, address: address!, cursor, limit: pageSize }),
    [network.horizonUrl, address, pageSize]
  )

  const state = usePagedActivity(key, fetchPage)
  const source = useMemo<ActivitySource>(
    () => ({ kind: "horizon", network: network.network, endpoint: new URL(network.horizonUrl).host }),
    [network.network, network.horizonUrl]
  )

  return { ...state, payments: state.records, source }
}

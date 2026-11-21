"use client"

import { useCallback, useMemo } from "react"
import * as StellarSdk from "@stellar/stellar-sdk"
import { APP_NETWORK, type StellarNetworkConfig } from "@/lib/stellar-network"
import { CONTRACTS } from "@/lib/contracts-config"
import { fetchContractEventsPage } from "@/lib/activity/contract-events"
import type { ActivitySource, ContractEventActivity } from "@/lib/activity/types"
import { usePagedActivity, type PagedActivityState } from "./usePagedActivity"

export interface UseContractEventsResult extends PagedActivityState<ContractEventActivity> {
  source: ActivitySource
}

/**
 * HDROP token contract events (mint/burn/transfer) for `address`, from Soroban
 * RPC on the app's validated network. RPC only retains recent ledgers; older
 * history surfaces as `status === "unsupported"` or simply isn't returned.
 */
export function useContractEvents(
  address: string | null,
  network: StellarNetworkConfig = APP_NETWORK,
  contractId: string = CONTRACTS.ENERGY_TOKEN
): UseContractEventsResult {
  const key = address ? `${network.network}|${network.rpcUrl}|${contractId}|${address}` : null

  const fetchPage = useCallback(
    (cursor: string | null) => {
      const server = new StellarSdk.rpc.Server(network.rpcUrl, { allowHttp: network.network === "LOCAL" })
      return fetchContractEventsPage({ server, contractId, address: address!, cursor })
    },
    [network.rpcUrl, network.network, contractId, address]
  )

  const state = usePagedActivity(key, fetchPage)
  const source = useMemo<ActivitySource>(
    () => ({ kind: "soroban-rpc", network: network.network, endpoint: new URL(network.rpcUrl).host }),
    [network.network, network.rpcUrl]
  )

  return { ...state, source }
}

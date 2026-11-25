"use client"

import { useCallback } from "react"
import * as StellarSdk from "@stellar/stellar-sdk"
import { useWallet } from "@/lib/wallet-context"
import { APP_NETWORK } from "@/lib/stellar-network"
import { useTransactionIntent } from "@/components/transaction-intent-provider"
import {
  executeContractWrite,
  WalletWriteError,
  type ContractWriteRequest,
  type ContractWriteResult,
} from "@/lib/wallet/contract-write"

/**
 * Returns a `write` function that runs every contract write through the
 * guarded pipeline: network check → intent review → signature →
 * revalidation → submission → confirmation.
 */
export function useContractWrite() {
  const { kit, getLiveWalletState } = useWallet()
  const confirmIntent = useTransactionIntent()

  return useCallback(
    async (req: ContractWriteRequest): Promise<ContractWriteResult> => {
      if (!kit) throw new WalletWriteError("no_wallet", "No wallet connected")
      const server = new StellarSdk.rpc.Server(APP_NETWORK.rpcUrl, { allowHttp: APP_NETWORK.network === "LOCAL" })
      return executeContractWrite(req, {
        config: APP_NETWORK,
        server,
        getWalletState: getLiveWalletState,
        confirmIntent,
        signTransaction: (xdr, opts) => kit.signTransaction(xdr, opts),
      })
    },
    [kit, getLiveWalletState, confirmIntent]
  )
}

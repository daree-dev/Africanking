"use client"

import { useState, useCallback } from "react"
import { useWallet } from "@/lib/wallet-context"
import { CONTRACTS, STELLAR_CONFIG, NETWORK_PASSPHRASE } from "@/lib/contracts-config"
import * as StellarSdk from "@stellar/stellar-sdk"
import { useContractWrite } from "@/hooks/useContractWrite"
import { WalletWriteError, type CooperativeRef } from "@/lib/wallet/contract-write"

function translateStellarError(err: unknown): string {
  // Guarded-write errors already carry a precise, user-facing message.
  if (err instanceof WalletWriteError) return err.message
  const msg = err instanceof Error ? err.message : String(err)
  const lower = msg.toLowerCase()
  if (lower.includes("account not found") || lower.includes("not found")) {
    return "La cuenta destino no existe en Stellar. Necesita ser fondeada primero."
  }
  if (lower.includes("insufficient") || lower.includes("balance")) {
    return "Balance HDROP insuficiente."
  }
  if (lower.includes("auth") || lower.includes("unauthorized") || lower.includes("permission")) {
    return "No tenés permisos para esta operación."
  }
  return msg
}

// BigInt avoids floating-point precision loss before i128 encoding.
// e.g. 1.3 kWh → Math.round(1.3 * 1e7) = 13000000 → BigInt(13000000)
function toStroops(amount: number): bigint {
  return BigInt(Math.round(amount * 1e7))
}

export function useEnergyToken() {
  const { address } = useWallet()
  const write = useContractWrite()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * Get balance of $ENERGY tokens for the current user
   */
  const getBalance = useCallback(async (userAddress?: string): Promise<string> => {
    try {
      setIsLoading(true)
      setError(null)

      const targetAddress = userAddress || address
      if (!targetAddress) {
        throw new Error("No wallet connected")
      }

      if (!CONTRACTS.ENERGY_TOKEN) {
        throw new Error("Energy token contract not configured")
      }

      const server = new StellarSdk.rpc.Server(STELLAR_CONFIG.RPC_URL)

      // Build the contract call to get balance
      const contract = new StellarSdk.Contract(CONTRACTS.ENERGY_TOKEN)
      let account
      try {
        account = await server.getAccount(targetAddress)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)


        if (msg.toLowerCase().includes("account not found")) {
          return "0.00"
        }

        throw err
      }

      const transaction = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(
          contract.call("balance", StellarSdk.nativeToScVal(targetAddress, { type: "address" }))
        )
        .setTimeout(30)
        .build()

      const simulatedResult = await server.simulateTransaction(transaction)

      if (StellarSdk.rpc.Api.isSimulationSuccess(simulatedResult)) {
        const balance = StellarSdk.scValToNative(simulatedResult.result!.retval)
        // Convert from 7 decimals to readable format
        return (Number(balance) / 10000000).toFixed(2)
      }

      throw new Error("Failed to get balance")
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error"
      setError(errorMessage)
      console.error("Error getting balance:", err)
      throw err
    } finally {
      setIsLoading(false)
    }
  }, [address])

  /**
   * Transfer $ENERGY tokens to another address.
   * Goes through the guarded write pipeline (network check, intent review,
   * post-signature revalidation).
   */
  const transfer = async (to: string, amount: number, cooperative: CooperativeRef): Promise<string> => {
    try {
      setIsLoading(true)
      setError(null)
      if (!address) throw new Error("No wallet connected")

      const { hash } = await write({
        operation: "transfer",
        cooperative,
        amountKwh: amount,
        contractId: CONTRACTS.ENERGY_TOKEN,
        method: "transfer",
        recipient: to,
        args: [
          StellarSdk.nativeToScVal(address, { type: "address" }),
          StellarSdk.nativeToScVal(to, { type: "address" }),
          StellarSdk.nativeToScVal(toStroops(amount), { type: "i128" }),
        ],
      })
      return hash
    } catch (err) {
      const errorMessage = translateStellarError(err)
      setError(errorMessage)
      console.error("Error transferring tokens:", err)
      throw err instanceof WalletWriteError ? err : new Error(errorMessage)
    } finally {
      setIsLoading(false)
    }
  }

  /**
   * Check if an address holds the on-chain `minter` role.
   * Read-only simulation — no signature or fee required.
   */
  const checkIsMinter = async (accountAddress: string): Promise<boolean> => {
    try {
      if (!CONTRACTS.ENERGY_TOKEN) {
        throw new Error("Energy token contract not configured")
      }

      const sourceAddress = accountAddress || address
      if (!sourceAddress) {
        throw new Error("No address provided to check")
      }

      const server = new StellarSdk.rpc.Server(STELLAR_CONFIG.RPC_URL)
      const contract = new StellarSdk.Contract(CONTRACTS.ENERGY_TOKEN)
      const account = await server.getAccount(sourceAddress)

      const transaction = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(
          contract.call(
            "is_minter",
            StellarSdk.nativeToScVal(accountAddress, { type: "address" })
          )
        )
        .setTimeout(30)
        .build()

      const simulatedResult = await server.simulateTransaction(transaction)

      if (StellarSdk.rpc.Api.isSimulationSuccess(simulatedResult)) {
        return StellarSdk.scValToNative(simulatedResult.result!.retval) as boolean
      }

      return false
    } catch (err) {
      console.error("Error checking minter role:", err)
      return false
    }
  }

  /**
   * Mint HDROP tokens to a cooperative member (minter role required).
   * Calls `mint_energy(to, amount, minter)`; the connected wallet is the
   * `minter` argument and must sign after reviewing the intent.
   */
  const mintEnergy = async (to: string, amount: number, cooperative: CooperativeRef): Promise<string> => {
    try {
      setIsLoading(true)
      setError(null)
      if (!address) throw new Error("No wallet connected")

      const { hash } = await write({
        operation: "mint",
        cooperative,
        amountKwh: amount,
        contractId: CONTRACTS.ENERGY_TOKEN,
        method: "mint_energy",
        recipient: to,
        args: [
          StellarSdk.nativeToScVal(to, { type: "address" }),
          StellarSdk.nativeToScVal(toStroops(amount), { type: "i128" }),
          StellarSdk.nativeToScVal(address, { type: "address" }), // minter = connected wallet
        ],
      })
      return hash
    } catch (err) {
      const errorMessage = translateStellarError(err)
      setError(errorMessage)
      console.error("Error minting tokens:", err)
      throw err instanceof WalletWriteError ? err : new Error(errorMessage)
    } finally {
      setIsLoading(false)
    }
  }

  /**
   * Burn $ENERGY tokens (when consuming energy)
   */
  const burnEnergy = async (amount: number, cooperative: CooperativeRef): Promise<string> => {
    try {
      setIsLoading(true)
      setError(null)
      if (!address) throw new Error("No wallet connected")

      const { hash } = await write({
        operation: "burn",
        cooperative,
        amountKwh: amount,
        contractId: CONTRACTS.ENERGY_TOKEN,
        method: "burn_energy",
        args: [
          StellarSdk.nativeToScVal(address, { type: "address" }),
          StellarSdk.nativeToScVal(toStroops(amount), { type: "i128" }),
        ],
      })
      return hash
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error"
      setError(errorMessage)
      console.error("Error burning tokens:", err)
      throw err
    } finally {
      setIsLoading(false)
    }
  }

  return {
    getBalance,
    transfer,
    burnEnergy,
    checkIsMinter,
    mintEnergy,
    isLoading,
    error,
  }
}
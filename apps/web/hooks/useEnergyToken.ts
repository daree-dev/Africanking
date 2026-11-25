"use client"

import { useState, useCallback } from "react"
import { useWallet } from "@/lib/wallet-context"
import { CONTRACTS } from "@/lib/contracts-config"
import * as StellarSdk from "@stellar/stellar-sdk"
import { invokeContractWrite, simulateContractRead } from "@/lib/stellar/contract-client"
import {
  ChainUnavailableError,
  ChainWriteFailedError,
  ChainWritePendingError,
} from "@/lib/stellar/resilience"

export function translateStellarError(err: unknown): string {
  if (err instanceof ChainWritePendingError) {
    return `Transacción enviada (${err.hash.slice(0, 8)}…), esperando confirmación de la red. No la reintentes: el estado se actualizará cuando la red responda.`
  }
  if (err instanceof ChainUnavailableError) {
    return "La red Stellar no está disponible. No se envió ninguna transacción; podés reintentar más tarde."
  }
  if (err instanceof ChainWriteFailedError) {
    return `La red rechazó la transacción: ${err.reason}`
  }
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

/** Re-throw pending/unavailable errors as-is so callers can branch on their type. */
function rethrowTyped(err: unknown, message: string): never {
  if (err instanceof ChainWritePendingError || err instanceof ChainUnavailableError || err instanceof ChainWriteFailedError) {
    throw err
  }
  throw new Error(message)
}

const toStroops = (amount: number) => BigInt(Math.round(amount * 1e7))

export function useEnergyToken() {
  const { address } = useWallet()
  const write = useContractWrite()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * Balance of HDROP credits. Throws on outage — callers decide whether a
   * cached value may be shown; never substitute "0.00" for an unknown balance.
   * Returns "0.00" only when the network positively reports the account as
   * unfunded.
   */
  const getBalance = useCallback(async (userAddress?: string): Promise<string> => {
    try {
      setIsLoading(true)
      setError(null)

      const targetAddress = userAddress || address
      if (!targetAddress) throw new Error("No wallet connected")
      if (!CONTRACTS.ENERGY_TOKEN) throw new Error("Energy token contract not configured")

      try {
        const balance = await simulateContractRead<bigint>({
          contractId: CONTRACTS.ENERGY_TOKEN,
          method: "balance",
          args: [StellarSdk.nativeToScVal(targetAddress, { type: "address" })],
          sourceAddress: targetAddress,
        })
        return (Number(balance) / 1e7).toFixed(2)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.toLowerCase().includes("account not found")) return "0.00"
        throw err
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
      throw err
    } finally {
      setIsLoading(false)
    }
  }, [address])

  const write = async (
    operation: "token.transfer" | "token.mint_energy" | "token.burn_energy",
    method: string,
    args: StellarSdk.xdr.ScVal[],
    description: string,
  ): Promise<string> => {
    try {
      setIsLoading(true)
      setError(null)
      if (!address || !kit) throw new Error("No wallet connected")
      if (!CONTRACTS.ENERGY_TOKEN) throw new Error("Energy token contract not configured")

      return await invokeContractWrite({
        operation,
        contractId: CONTRACTS.ENERGY_TOKEN,
        method,
        args,
        sourceAddress: address,
        kit,
        description,
      })
    } catch (err) {
      const message = translateStellarError(err)
      setError(message)
      console.error(`Error in ${method}:`, err)
      rethrowTyped(err, message)
    } finally {
      setIsLoading(false)
    }
  }

  /** Transfer HDROP credits to another address. */
  const transfer = (to: string, amount: number): Promise<string> =>
    write(
      "token.transfer",
      "transfer",
      [
        StellarSdk.nativeToScVal(address, { type: "address" }),
        StellarSdk.nativeToScVal(to, { type: "address" }),
        StellarSdk.nativeToScVal(toStroops(amount), { type: "i128" }),
      ],
      `Transfer ${amount} HDROP`,
    )

  /**
   * Check if an address holds the on-chain `minter` role. Authorization data
   * is never cached: on outage this reports `false` (fail closed).
   */
  const checkIsMinter = async (accountAddress: string): Promise<boolean> => {
    try {
      if (!CONTRACTS.ENERGY_TOKEN) throw new Error("Energy token contract not configured")
      const sourceAddress = accountAddress || address
      if (!sourceAddress) throw new Error("No address provided to check")

      return await simulateContractRead<boolean>({
        contractId: CONTRACTS.ENERGY_TOKEN,
        method: "is_minter",
        args: [StellarSdk.nativeToScVal(sourceAddress, { type: "address" })],
        sourceAddress,
      })
    } catch (err) {
      console.error("Error checking minter role:", err)
      return false
    }
  }

  /**
   * Mint HDROP credits to a recipient (minter role required). The connected
   * wallet is the `minter` argument and must sign.
   */
  const mintEnergy = (to: string, amount: number): Promise<string> =>
    write(
      "token.mint_energy",
      "mint_energy",
      [
        StellarSdk.nativeToScVal(to, { type: "address" }),
        StellarSdk.nativeToScVal(toStroops(amount), { type: "i128" }),
        StellarSdk.nativeToScVal(address, { type: "address" }),
      ],
      `Mint ${amount} HDROP`,
    )

  /** Burn HDROP credits held by the connected wallet. */
  const burnEnergy = (amount: number): Promise<string> =>
    write(
      "token.burn_energy",
      "burn_energy",
      [
        StellarSdk.nativeToScVal(address, { type: "address" }),
        StellarSdk.nativeToScVal(toStroops(amount), { type: "i128" }),
      ],
      `Burn ${amount} HDROP`,
    )

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

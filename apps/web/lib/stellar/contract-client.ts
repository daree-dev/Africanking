import * as StellarSdk from "@stellar/stellar-sdk"
import { STELLAR_CONFIG, NETWORK_PASSPHRASE } from "@/lib/contracts-config"
import {
  ChainUnavailableError,
  ChainWriteFailedError,
  ChainWritePendingError,
  PendingWriteStore,
  isTransientChainError,
  submitSignedTransaction,
  withBackoff,
  type BackoffOptions,
  type ChainOperation,
  type RpcWriteClient,
} from "./resilience"

/** Seconds a client-built transaction stays valid (its maxTime). */
export const TX_TIMEOUT_SECONDS = 30

export function getRpcServer(): StellarSdk.rpc.Server {
  return new StellarSdk.rpc.Server(STELLAR_CONFIG.RPC_URL)
}

/**
 * Read-only contract call via simulation. Idempotent, so transient failures
 * are retried with bounded backoff.
 */
export async function simulateContractRead<T>(
  params: {
    contractId: string
    method: string
    args?: StellarSdk.xdr.ScVal[]
    sourceAddress: string
  },
  backoff?: BackoffOptions,
): Promise<T> {
  const server = getRpcServer()
  const contract = new StellarSdk.Contract(params.contractId)

  return withBackoff(async () => {
    const account = await server.getAccount(params.sourceAddress)
    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call(params.method, ...(params.args ?? [])))
      .setTimeout(TX_TIMEOUT_SECONDS)
      .build()

    const sim = await server.simulateTransaction(tx)
    if (StellarSdk.rpc.Api.isSimulationSuccess(sim)) {
      return StellarSdk.scValToNative(sim.result!.retval) as T
    }
    throw new Error(`Simulation of ${params.method} failed`)
  }, backoff)
}

interface SignerKit {
  signTransaction(xdr: string): Promise<{ signedTxXdr: string }>
}

/**
 * Build, sign once and submit a contract invocation.
 *
 * - Preparation (getAccount / prepareTransaction) is retried with backoff; if
 *   it still fails the call throws `ChainUnavailableError` — nothing was
 *   submitted, so the UI can safely say "not sent".
 * - The signed envelope is submitted by `submitSignedTransaction`, which only
 *   re-sends that identical envelope. Never retry this whole function.
 * - When the chain gives no verdict the hash is recorded in the pending-write
 *   ledger and `ChainWritePendingError` is thrown.
 */
export async function invokeContractWrite(params: {
  operation: ChainOperation
  contractId: string
  method: string
  args: StellarSdk.xdr.ScVal[]
  sourceAddress: string
  kit: SignerKit
  description?: string
  pendingStore?: PendingWriteStore
}): Promise<string> {
  const server = getRpcServer()
  const contract = new StellarSdk.Contract(params.contractId)

  let prepared: StellarSdk.Transaction
  try {
    prepared = await withBackoff(async () => {
      const account = await server.getAccount(params.sourceAddress)
      const tx = new StellarSdk.TransactionBuilder(account, {
        fee: "100000",
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(contract.call(params.method, ...params.args))
        .setTimeout(TX_TIMEOUT_SECONDS)
        .build()
      return server.prepareTransaction(tx)
    })
  } catch (err) {
    if (isTransientChainError(err)) throw new ChainUnavailableError(undefined, err)
    throw err
  }

  // Signing happens exactly once per user action.
  const { signedTxXdr } = await params.kit.signTransaction(prepared.toXDR())
  const signed = StellarSdk.TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE) as StellarSdk.Transaction
  const maxTime = Number(signed.timeBounds?.maxTime ?? 0)
  const expiresAt = maxTime > 0 ? maxTime * 1000 : null

  const store = params.pendingStore ?? new PendingWriteStore()
  const outcome = await submitSignedTransaction(server as unknown as RpcWriteClient, signed)

  if (outcome.status === "confirmed") return outcome.hash
  if (outcome.status === "pending") {
    store.add({
      hash: outcome.hash,
      operation: params.operation,
      submittedAt: Date.now(),
      expiresAt,
      description: params.description,
    })
    throw new ChainWritePendingError(outcome.hash, outcome.reason)
  }
  throw new ChainWriteFailedError(outcome.hash, outcome.reason)
}

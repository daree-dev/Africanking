/**
 * Centralized Soroban transaction service.
 *
 * Every API route that writes to a contract goes through `invokeContract`, which owns:
 * - network-specific RPC + passphrase selection (from the validated config),
 * - simulation + resource/fee assembly,
 * - submission with safe re-submission of the *same* signed envelope,
 * - bounded confirmation polling,
 * - explicit classification of PENDING / DUPLICATE / TRY_AGAIN_LATER / ERROR /
 *   SUCCESS / FAILED / timeout / unknown states.
 *
 * Failures are thrown as `StellarTransactionError` carrying the transaction hash
 * (when known) and a structured reason so callers can persist it for reconciliation.
 */
import * as StellarSdk from "@stellar/stellar-sdk"
import {
  assertStellarWritesEnabled,
  getStellarConfigReport,
  StellarConfigError,
  type StellarNetworkName,
} from "./network-config"

export type TxFailureCode =
  | "WRITES_DISABLED"
  | "RPC_UNAVAILABLE"
  | "SIMULATION_FAILED"
  | "SUBMISSION_REJECTED"
  | "TRY_AGAIN_LATER"
  | "FAILED"
  | "TIMEOUT"
  | "UNKNOWN_STATUS"

export interface TxFailureReason {
  code: TxFailureCode
  message: string
  tx_hash: string | null
  /** true when the transaction may be on-chain: reconcile by hash before retrying. */
  submitted: boolean
  /** true when retrying with a fresh transaction is safe. */
  retryable: boolean
  details?: Record<string, unknown>
}

export class StellarTransactionError extends Error {
  readonly code: TxFailureCode
  readonly hash: string | null
  readonly submitted: boolean
  readonly retryable: boolean
  readonly details?: Record<string, unknown>

  constructor(reason: Omit<TxFailureReason, "tx_hash"> & { hash?: string | null }) {
    super(reason.message)
    this.name = "StellarTransactionError"
    this.code = reason.code
    this.hash = reason.hash ?? null
    this.submitted = reason.submitted
    this.retryable = reason.retryable
    this.details = reason.details
  }

  toFailureReason(): TxFailureReason {
    return {
      code: this.code,
      message: this.message,
      tx_hash: this.hash,
      submitted: this.submitted,
      retryable: this.retryable,
      ...(this.details ? { details: this.details } : {}),
    }
  }
}

export function isStellarTransactionError(err: unknown): err is StellarTransactionError {
  return err instanceof StellarTransactionError
}

/** Minimal RPC surface the service needs — lets tests inject a fake server. */
export interface RpcClient {
  getAccount(address: string): Promise<StellarSdk.Account>
  simulateTransaction(tx: StellarSdk.Transaction): Promise<StellarSdk.rpc.Api.SimulateTransactionResponse>
  sendTransaction(tx: StellarSdk.Transaction): Promise<StellarSdk.rpc.Api.SendTransactionResponse>
  getTransaction(hash: string): Promise<StellarSdk.rpc.Api.GetTransactionResponse>
}

export interface TransactionServiceOptions {
  server: RpcClient
  networkPassphrase: string
  /** Max inclusion fee in stroops (resource fee is added by simulation). */
  baseFee?: string
  txTimeoutSeconds?: number
  pollIntervalMs?: number
  maxPollAttempts?: number
  /** Attempts for idempotent reads (getAccount, simulate). */
  readAttempts?: number
  /** Attempts for submitting the same signed envelope. */
  submitAttempts?: number
  retryDelayMs?: number
  sleep?: (ms: number) => Promise<void>
  assemble?: (
    tx: StellarSdk.Transaction,
    sim: StellarSdk.rpc.Api.SimulateTransactionSuccessResponse
  ) => StellarSdk.Transaction
}

export interface InvokeContractRequest {
  signer: StellarSdk.Keypair
  contractId: string
  method: string
  args: StellarSdk.xdr.ScVal[]
  /** Called once the hash may be on-chain (accepted, duplicate, or ambiguous submit). */
  onSubmitted?: (hash: string) => Promise<void> | void
  label?: string
}

export interface InvokeContractResult {
  status: "SUCCESS"
  hash: string
  ledger: number | null
  pollAttempts: number
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Best-effort decode of a TransactionResult code (e.g. txBadSeq, txInsufficientFee). */
function resultCode(result: unknown): string | null {
  try {
    const r = result as { result: () => { switch: () => { name: string } } } | undefined
    return r?.result().switch().name ?? null
  } catch {
    return null
  }
}

export function createTransactionService(opts: TransactionServiceOptions) {
  const {
    server,
    networkPassphrase,
    baseFee = "100000",
    txTimeoutSeconds = 300,
    pollIntervalMs = 1000,
    maxPollAttempts = 90,
    readAttempts = 2,
    submitAttempts = 3,
    retryDelayMs = 2000,
    sleep = defaultSleep,
    assemble = (tx, sim) => StellarSdk.rpc.assembleTransaction(tx, sim).build(),
  } = opts

  async function readWithRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
    let lastError: unknown
    for (let attempt = 1; attempt <= readAttempts; attempt++) {
      try {
        return await fn()
      } catch (err) {
        lastError = err
        console.warn(`[stellar-tx] ${label} failed (attempt ${attempt}/${readAttempts}): ${errorMessage(err)}`)
        if (attempt < readAttempts) await sleep(retryDelayMs)
      }
    }
    throw new StellarTransactionError({
      code: "RPC_UNAVAILABLE",
      message: `RPC ${label} failed: ${errorMessage(lastError)}`,
      submitted: false,
      retryable: true,
    })
  }

  async function pollForResult(hash: string): Promise<InvokeContractResult> {
    let lastError: unknown = null
    for (let attempt = 1; attempt <= maxPollAttempts; attempt++) {
      let response: StellarSdk.rpc.Api.GetTransactionResponse | null = null
      try {
        response = await server.getTransaction(hash)
      } catch (err) {
        // Transient RPC failure while polling: the tx may still land, keep polling.
        lastError = err
      }

      if (response) {
        switch (response.status) {
          case StellarSdk.rpc.Api.GetTransactionStatus.SUCCESS:
            return { status: "SUCCESS", hash, ledger: response.ledger ?? null, pollAttempts: attempt }
          case StellarSdk.rpc.Api.GetTransactionStatus.FAILED:
            throw new StellarTransactionError({
              code: "FAILED",
              message: `Transaction ${hash} failed on-chain`,
              hash,
              submitted: true,
              retryable: false,
              details: { result_code: resultCode(response.resultXdr), ledger: response.ledger ?? null },
            })
          case StellarSdk.rpc.Api.GetTransactionStatus.NOT_FOUND:
            break
          default:
            throw new StellarTransactionError({
              code: "UNKNOWN_STATUS",
              message: `Transaction ${hash} returned unexpected status`,
              hash,
              submitted: true,
              retryable: false,
              details: { status: (response as { status?: unknown }).status ?? null },
            })
        }
      }

      if (attempt < maxPollAttempts) await sleep(pollIntervalMs)
    }

    throw new StellarTransactionError({
      code: "TIMEOUT",
      message:
        `Transaction ${hash} was submitted but not confirmed after ${maxPollAttempts} checks. ` +
        `Reconcile by hash before retrying.`,
      hash,
      submitted: true,
      retryable: false,
      details: { poll_attempts: maxPollAttempts, last_poll_error: lastError ? errorMessage(lastError) : null },
    })
  }

  async function invokeContract(req: InvokeContractRequest): Promise<InvokeContractResult> {
    const label = req.label ?? req.method
    const source = req.signer.publicKey()

    const account = await readWithRetry(`${label}:getAccount`, () => server.getAccount(source))

    const tx = new StellarSdk.TransactionBuilder(account, { fee: baseFee, networkPassphrase })
      .addOperation(new StellarSdk.Contract(req.contractId).call(req.method, ...req.args))
      .setTimeout(txTimeoutSeconds)
      .build()

    const sim = await readWithRetry(`${label}:simulate`, () => server.simulateTransaction(tx))
    if (StellarSdk.rpc.Api.isSimulationError(sim)) {
      throw new StellarTransactionError({
        code: "SIMULATION_FAILED",
        message: `Simulation of ${req.method} failed`,
        submitted: false,
        retryable: false,
        details: { simulation_error: sim.error },
      })
    }

    const prepared = assemble(tx, sim as StellarSdk.rpc.Api.SimulateTransactionSuccessResponse)
    prepared.sign(req.signer)
    const hash = prepared.hash().toString("hex")

    let notified = false
    const markSubmitted = async () => {
      if (notified || !req.onSubmitted) return
      notified = true
      await req.onSubmitted(hash)
    }

    let ambiguous = false
    for (let attempt = 1; attempt <= submitAttempts; attempt++) {
      let send: StellarSdk.rpc.Api.SendTransactionResponse
      try {
        send = await server.sendTransaction(prepared)
      } catch (err) {
        // The request may have reached the network. Re-sending the *same* envelope is
        // safe (same hash + sequence number), so retry; never rebuild a new transaction.
        ambiguous = true
        console.warn(`[stellar-tx] ${label}:send ambiguous failure for ${hash}: ${errorMessage(err)}`)
        await markSubmitted()
        if (attempt < submitAttempts) await sleep(retryDelayMs)
        continue
      }

      switch (send.status) {
        case "PENDING":
        case "DUPLICATE":
          await markSubmitted()
          return pollForResult(hash)
        case "TRY_AGAIN_LATER":
          if (attempt < submitAttempts) {
            await sleep(retryDelayMs)
            continue
          }
          if (ambiguous) return pollForResult(hash)
          throw new StellarTransactionError({
            code: "TRY_AGAIN_LATER",
            message: `RPC asked to retry ${req.method} later`,
            hash,
            submitted: false,
            retryable: true,
          })
        case "ERROR":
          if (ambiguous) {
            // An earlier attempt may have been accepted (e.g. now txBadSeq). Resolve by hash.
            return pollForResult(hash)
          }
          throw new StellarTransactionError({
            code: "SUBMISSION_REJECTED",
            message: `Transaction for ${req.method} was rejected at submission`,
            hash,
            submitted: false,
            retryable: false,
            details: { result_code: resultCode(send.errorResult) },
          })
        default:
          await markSubmitted()
          throw new StellarTransactionError({
            code: "UNKNOWN_STATUS",
            message: `Unexpected submission status for ${hash}`,
            hash,
            submitted: true,
            retryable: false,
            details: { status: (send as { status?: unknown }).status ?? null },
          })
      }
    }

    // Every send attempt threw: outcome unknown, resolve by hash.
    return pollForResult(hash)
  }

  return { invokeContract }
}

export type TransactionService = ReturnType<typeof createTransactionService>

// ---------------------------------------------------------------------------
// Default service bound to the validated network configuration
// ---------------------------------------------------------------------------

const DEFAULT_RPC: Record<StellarNetworkName, string> = {
  PUBLIC: "",
  TESTNET: "https://soroban-testnet.stellar.org",
  FUTURENET: "https://rpc-futurenet.stellar.org",
  LOCAL: "http://localhost:8000/rpc",
}

let cachedService: { fingerprint: string; service: TransactionService } | null = null

/**
 * Returns the service for the validated configuration. Throws
 * `StellarTransactionError(WRITES_DISABLED)` when configuration validation failed.
 */
export function getTransactionService(): TransactionService {
  try {
    assertStellarWritesEnabled()
  } catch (err) {
    if (err instanceof StellarConfigError) {
      throw new StellarTransactionError({
        code: "WRITES_DISABLED",
        message: err.message,
        submitted: false,
        retryable: false,
        details: { config_issues: err.issues.map((i) => i.code) },
      })
    }
    throw err
  }

  const report = getStellarConfigReport()
  if (cachedService?.fingerprint === report.fingerprint) return cachedService.service

  const network = report.network!
  const rpcUrl = report.rpcUrl ?? DEFAULT_RPC[network]
  const server = new StellarSdk.rpc.Server(rpcUrl, { allowHttp: network === "LOCAL" })
  const service = createTransactionService({ server, networkPassphrase: report.networkPassphrase! })
  cachedService = { fingerprint: report.fingerprint, service }
  return service
}

const HTTP_STATUS: Record<TxFailureCode, number> = {
  WRITES_DISABLED: 503,
  RPC_UNAVAILABLE: 503,
  TRY_AGAIN_LATER: 503,
  SIMULATION_FAILED: 422,
  SUBMISSION_REJECTED: 502,
  FAILED: 502,
  UNKNOWN_STATUS: 502,
  TIMEOUT: 504,
}

export function httpStatusForTxError(err: StellarTransactionError): number {
  return HTTP_STATUS[err.code] ?? 500
}

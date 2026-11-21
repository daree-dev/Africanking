/**
 * Guarded contract write pipeline for browser wallets.
 *
 *   preflight → build/simulate → user confirms intent → wallet signs →
 *   re-read wallet state → verify signed envelope → submit → confirm
 *
 * Every step that depends on the outside world (RPC, wallet, UI) is injected
 * so the pipeline can be tested deterministically.
 */

import * as StellarSdk from "@stellar/stellar-sdk"
import { walletNetworkMismatch, type StellarNetworkConfig, type StellarNetworkName } from "@/lib/stellar-network"

export type WriteOperation = "mint" | "burn" | "transfer" | "record_generation"

export interface CooperativeRef {
  id: string
  name: string
}

/** Everything the user must see and approve before a signature is requested. */
export interface WriteIntent {
  operation: WriteOperation
  cooperative: CooperativeRef
  /** Energy amount in kWh (1 HDROP = 1 kWh) */
  amountKwh: number
  contractId: string
  method: string
  signer: string
  recipient: string | null
  network: StellarNetworkName
  networkPassphrase: string
  /** True when the wallet did not report its network; the signature check still enforces it. */
  networkUnverified: boolean
}

export interface LiveWalletState {
  address: string | null
  network?: string | null
  passphrase?: string | null
}

export type WalletWriteErrorCode =
  | "config_invalid"
  | "no_wallet"
  | "wrong_network"
  | "contract_not_configured"
  | "invalid_intent"
  | "user_cancelled"
  | "signature_rejected"
  | "account_changed"
  | "network_changed"
  | "tx_tampered"
  | "submit_failed"
  | "tx_failed"
  | "confirmation_timeout"

export class WalletWriteError extends Error {
  constructor(
    public readonly code: WalletWriteErrorCode,
    message: string,
    public readonly txHash?: string
  ) {
    super(message)
    this.name = "WalletWriteError"
  }
}

type WriteServer = Pick<
  StellarSdk.rpc.Server,
  "getAccount" | "prepareTransaction" | "sendTransaction" | "getTransaction"
>

export type SignFn = (
  xdr: string,
  opts: { networkPassphrase: string; address: string }
) => Promise<{ signedTxXdr: string; signerAddress?: string }>

export interface ContractWriteRequest {
  operation: WriteOperation
  cooperative: CooperativeRef | null | undefined
  amountKwh: number
  contractId: string
  method: string
  args: StellarSdk.xdr.ScVal[]
  recipient?: string | null
}

export interface ContractWriteDeps {
  config: StellarNetworkConfig
  server: WriteServer
  getWalletState: () => Promise<LiveWalletState>
  confirmIntent: (intent: WriteIntent) => Promise<boolean>
  signTransaction: SignFn
  fee?: string
  pollIntervalMs?: number
  maxPollAttempts?: number
  sleep?: (ms: number) => Promise<void>
}

export interface ContractWriteResult {
  hash: string
  ledger: number
  intent: WriteIntent
}

function reportsNetwork(state: LiveWalletState): boolean {
  return Boolean(state.passphrase || state.network)
}

/** Validate configuration, wallet and request before anything is built. */
export function preflight(
  config: StellarNetworkConfig,
  wallet: LiveWalletState,
  req: ContractWriteRequest
): WriteIntent {
  if (!config.valid) {
    throw new WalletWriteError("config_invalid", `Network configuration is invalid: ${config.issues.join("; ")}`)
  }
  if (!wallet.address) {
    throw new WalletWriteError("no_wallet", "No wallet connected")
  }
  if (reportsNetwork(wallet)) {
    const mismatch = walletNetworkMismatch(config, wallet)
    if (mismatch) throw new WalletWriteError("wrong_network", mismatch)
  }
  if (!req.contractId) {
    throw new WalletWriteError("contract_not_configured", "Target contract is not configured for this network")
  }
  if (!req.cooperative?.id || !req.cooperative.name) {
    throw new WalletWriteError("invalid_intent", "A cooperative must be selected for this operation")
  }
  if (!Number.isFinite(req.amountKwh) || req.amountKwh <= 0) {
    throw new WalletWriteError("invalid_intent", "Energy amount must be a positive number")
  }

  return {
    operation: req.operation,
    cooperative: req.cooperative,
    amountKwh: req.amountKwh,
    contractId: req.contractId,
    method: req.method,
    signer: wallet.address,
    recipient: req.recipient ?? null,
    network: config.network,
    networkPassphrase: config.passphrase,
    networkUnverified: !reportsNetwork(wallet),
  }
}

/**
 * Confirm the wallet returned exactly the transaction we built, signed by the
 * expected account for the configured network passphrase. A signature made for
 * another network is over a different hash and fails verification.
 */
export function verifySignedEnvelope(
  signedXdr: string,
  prepared: StellarSdk.Transaction,
  intent: WriteIntent
): StellarSdk.Transaction {
  let signed: StellarSdk.Transaction
  try {
    const parsed = StellarSdk.TransactionBuilder.fromXDR(signedXdr, intent.networkPassphrase)
    if (!(parsed instanceof StellarSdk.Transaction)) throw new Error("fee bump not expected")
    signed = parsed
  } catch (err) {
    throw new WalletWriteError("tx_tampered", `Wallet returned an unreadable transaction: ${(err as Error).message}`)
  }

  if (!signed.hash().equals(prepared.hash())) {
    throw new WalletWriteError("tx_tampered", "Wallet returned a different transaction than the one you approved")
  }
  if (signed.source !== intent.signer) {
    throw new WalletWriteError("account_changed", "Transaction source does not match the approving account")
  }

  const keypair = StellarSdk.Keypair.fromPublicKey(intent.signer)
  const hint = keypair.signatureHint()
  const valid = signed.signatures.some(
    (s) => s.hint().equals(hint) && keypair.verify(signed.hash(), s.signature())
  )
  if (!valid) {
    throw new WalletWriteError(
      "wrong_network",
      `Signature is not valid for ${intent.network}; check that your wallet is set to ${intent.network}`
    )
  }
  return signed
}

export async function executeContractWrite(
  req: ContractWriteRequest,
  deps: ContractWriteDeps
): Promise<ContractWriteResult> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const maxPolls = deps.maxPollAttempts ?? 60
  const interval = deps.pollIntervalMs ?? 1000

  // 1. Preflight against live wallet state, not cached context.
  const before = await deps.getWalletState()
  const intent = preflight(deps.config, before, req)

  // 2. Build + simulate so simulation errors surface before the user is asked.
  const account = await deps.server.getAccount(intent.signer)
  const contract = new StellarSdk.Contract(intent.contractId)
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: deps.fee ?? "100000",
    networkPassphrase: intent.networkPassphrase,
  })
    .addOperation(contract.call(intent.method, ...req.args))
    .setTimeout(120)
    .build()
  const prepared = await deps.server.prepareTransaction(tx)

  // 3. User must see and approve cooperative, operation, amount and contract.
  const approved = await deps.confirmIntent(intent)
  if (!approved) throw new WalletWriteError("user_cancelled", "Operation cancelled")

  // 4. Wallet signature.
  let signedTxXdr: string
  try {
    const res = await deps.signTransaction(prepared.toXDR(), {
      networkPassphrase: intent.networkPassphrase,
      address: intent.signer,
    })
    signedTxXdr = res.signedTxXdr
    if (res.signerAddress && res.signerAddress !== intent.signer) {
      throw new WalletWriteError("account_changed", "Wallet signed with a different account than the one you approved")
    }
  } catch (err) {
    if (err instanceof WalletWriteError) throw err
    throw new WalletWriteError("signature_rejected", "Signature was rejected in the wallet")
  }
  if (!signedTxXdr) throw new WalletWriteError("signature_rejected", "Signature was rejected in the wallet")

  // 5. Revalidate account + network after the wallet interaction.
  const after = await deps.getWalletState()
  if (after.address !== intent.signer) {
    throw new WalletWriteError("account_changed", "Wallet account changed while signing; nothing was submitted")
  }
  if (reportsNetwork(after)) {
    const mismatch = walletNetworkMismatch(deps.config, after)
    if (mismatch) throw new WalletWriteError("network_changed", `${mismatch}; nothing was submitted`)
  }

  // 6. Signed envelope must be exactly what was approved.
  const signed = verifySignedEnvelope(signedTxXdr, prepared, intent)

  // 7. Submit and wait for finality.
  const sent = await deps.server.sendTransaction(signed)
  if (sent.status !== "PENDING" && sent.status !== "DUPLICATE") {
    throw new WalletWriteError("submit_failed", `Transaction was not accepted (${sent.status})`, sent.hash)
  }

  for (let attempt = 0; attempt < maxPolls; attempt++) {
    const res = await deps.server.getTransaction(sent.hash)
    if (res.status === StellarSdk.rpc.Api.GetTransactionStatus.SUCCESS) {
      return { hash: sent.hash, ledger: res.ledger, intent }
    }
    if (res.status === StellarSdk.rpc.Api.GetTransactionStatus.FAILED) {
      throw new WalletWriteError("tx_failed", "Transaction failed on-chain", sent.hash)
    }
    await sleep(interval)
  }

  throw new WalletWriteError(
    "confirmation_timeout",
    `Transaction ${sent.hash} was submitted but not confirmed yet; check the explorer before retrying`,
    sent.hash
  )
}

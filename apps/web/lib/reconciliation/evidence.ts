/**
 * Collects finalized transaction evidence from Soroban RPC and decodes token
 * `mint` events. Kept separate from the rules so the rules stay pure and can
 * be tested against JSON fixtures.
 */

import * as StellarSdk from "@stellar/stellar-sdk"
import type { MintEvent, TransactionEvidence } from "./types"

type RpcServer = Pick<StellarSdk.rpc.Server, "getTransaction" | "getNetwork">

/**
 * Decode a single contract event into a MintEvent, or null if it is not a
 * token `mint` event. Supports both the legacy SEP-41 shape
 * (topics: ["mint", to] / data: i128) and the struct-style shape
 * (topics: ["mint", to] / data: { amount: i128 }).
 */
export function decodeMintEvent(event: StellarSdk.xdr.ContractEvent): MintEvent | null {
  const contractHash = event.contractId()
  if (!contractHash) return null

  const body = event.body().v0()
  const topics = body.topics().map((t) => StellarSdk.scValToNative(t))
  if (topics[0] !== "mint") return null

  // Recipient is the last address-like topic (skip optional admin/minter topic).
  const to = [...topics.slice(1)].reverse().find((t) => typeof t === "string" && /^[GCM]/.test(t))
  if (typeof to !== "string") return null

  const data = StellarSdk.scValToNative(body.data())
  let amount: bigint | null = null
  if (typeof data === "bigint") amount = data
  else if (typeof data === "number") amount = BigInt(data)
  else if (data && typeof data === "object" && "amount" in data) {
    const raw = (data as { amount: unknown }).amount
    if (typeof raw === "bigint" || typeof raw === "number") amount = BigInt(raw)
  }
  if (amount == null) return null

  return {
    contract_id: StellarSdk.StrKey.encodeContract(Buffer.from(contractHash as unknown as Uint8Array)),
    to,
    amount: amount.toString(),
  }
}

function contractEventsFrom(
  response: StellarSdk.rpc.Api.GetSuccessfulTransactionResponse
): StellarSdk.xdr.ContractEvent[] {
  const grouped = response.events?.contractEventsXdr
  if (grouped && grouped.length > 0) return grouped.flat()

  // Older RPC versions only expose events inside the transaction meta.
  try {
    const meta = response.resultMetaXdr
    const arm = meta.switch() as number
    if (arm === 3) return meta.v3().sorobanMeta()?.events() ?? []
    if (arm === 4) return meta.v4().operations().flatMap((op) => op.events())
  } catch {
    // fall through — no decodable events
  }
  return []
}

/**
 * Refuse to reconcile against an RPC endpoint on a different network than the
 * application is configured for — evidence from the wrong network is
 * meaningless and could cause destructive "repairs".
 */
export async function assertNetwork(server: RpcServer, expectedPassphrase: string): Promise<void> {
  const { passphrase } = await server.getNetwork()
  if (passphrase !== expectedPassphrase) {
    throw new Error(
      `RPC network mismatch: endpoint reports "${passphrase}", configuration expects "${expectedPassphrase}"`
    )
  }
}

export async function fetchTransactionEvidence(
  server: RpcServer,
  hash: string
): Promise<TransactionEvidence> {
  const response = await server.getTransaction(hash)
  const base = {
    hash,
    latest_ledger: response.latestLedger,
    oldest_ledger: response.oldestLedger ?? null,
  }

  if (response.status === StellarSdk.rpc.Api.GetTransactionStatus.SUCCESS) {
    const mint_events = contractEventsFrom(response)
      .map(decodeMintEvent)
      .filter((e): e is MintEvent => e !== null)
    return { ...base, status: "SUCCESS", ledger: response.ledger, mint_events }
  }

  if (response.status === StellarSdk.rpc.Api.GetTransactionStatus.FAILED) {
    return { ...base, status: "FAILED", ledger: response.ledger, mint_events: [] }
  }

  return { ...base, status: "NOT_FOUND", ledger: null, mint_events: [] }
}

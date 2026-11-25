/**
 * Token contract events (mint / burn / transfer) for an account, read from
 * Soroban RPC `getEvents`. RPC only retains a recent ledger window, so the
 * result reports that window and older history is "unsupported" from this
 * source.
 */

import * as StellarSdk from "@stellar/stellar-sdk"
import type { ContractEventActivity, ContractEventType, FetchErrorKind, PageResult } from "./types"

type EventsServer = Pick<StellarSdk.rpc.Server, "getHealth" | "getEvents">

const STROOPS = 10_000_000

export interface ContractEventsPage {
  /** Ledger window this RPC endpoint can answer for */
  oldestLedger: number
  latestLedger: number
}

function sym(value: string): string {
  return StellarSdk.nativeToScVal(value, { type: "symbol" }).toXDR("base64")
}

function addr(value: string): string {
  return StellarSdk.nativeToScVal(value, { type: "address" }).toXDR("base64")
}

/**
 * Topic filters for SEP-41 token events touching `address`:
 *   mint     [mint, to]  or  [mint, admin, to]
 *   burn     [burn, from]
 *   transfer [transfer, from, to]
 */
export function buildTopicFilters(address: string): string[][] {
  const a = addr(address)
  return [
    [sym("mint"), a],
    [sym("mint"), "*", a],
    [sym("burn"), a],
    [sym("transfer"), a, "*"],
    [sym("transfer"), "*", a],
  ]
}

function toAmount(value: unknown): bigint | null {
  if (typeof value === "bigint") return value
  if (typeof value === "number") return BigInt(value)
  if (value && typeof value === "object" && "amount" in value) return toAmount((value as { amount: unknown }).amount)
  return null
}

function formatUnits(stroops: bigint): string {
  const negative = stroops < BigInt(0)
  const abs = negative ? -stroops : stroops
  const whole = abs / BigInt(STROOPS)
  const frac = (abs % BigInt(STROOPS)).toString().padStart(7, "0").replace(/0+$/, "")
  return `${negative ? "-" : ""}${whole}${frac ? "." + frac : ""}`
}

export function toContractEventActivity(
  event: StellarSdk.rpc.Api.EventResponse,
  asset: string
): ContractEventActivity | null {
  const topics = event.topic.map((t) => StellarSdk.scValToNative(t))
  const name = topics[0]
  if (name !== "mint" && name !== "burn" && name !== "transfer") return null

  const amount = toAmount(StellarSdk.scValToNative(event.value))
  if (amount == null) return null

  let from: string | null = null
  let to: string | null = null
  if (name === "mint") to = String(topics[topics.length - 1])
  else if (name === "burn") from = String(topics[1])
  else {
    from = String(topics[1])
    to = String(topics[2])
  }

  return {
    kind: "contract_event",
    id: event.id,
    eventType: name as ContractEventType,
    contractId: event.contractId?.contractId() ?? null,
    createdAt: event.ledgerClosedAt,
    txHash: event.txHash,
    from,
    to,
    amount: formatUnits(amount),
    asset,
    ledger: event.ledger,
  }
}

function classifyRpcError(err: unknown): { kind: FetchErrorKind | "unsupported"; message: string } {
  const message = err instanceof Error ? err.message : String(err)
  const status = (err as { response?: { status?: number } })?.response?.status
  const code = (err as { code?: number })?.code
  if (code === -32601 || /method not found/i.test(message)) {
    return { kind: "unsupported", message: "This RPC endpoint does not support event history" }
  }
  if (/startLedger must be|ledger range|out of range/i.test(message)) {
    return { kind: "unsupported", message: "Requested history is outside this RPC endpoint's retention window" }
  }
  if (status === 429) return { kind: "rate_limited", message }
  if (status && status >= 500) return { kind: "outage", message }
  if (status) return { kind: "bad_response", message }
  return { kind: "network", message }
}

export interface FetchContractEventsOptions {
  server: EventsServer
  contractId: string
  address: string
  asset?: string
  cursor?: string | null
  limit?: number
}

export async function fetchContractEventsPage(
  opts: FetchContractEventsOptions
): Promise<PageResult<ContractEventActivity> & Partial<ContractEventsPage>> {
  if (!opts.contractId) {
    return { status: "unsupported", reason: "No token contract is configured for this network" }
  }
  const limit = opts.limit ?? 100
  const asset = opts.asset ?? "HDROP"
  const filters: StellarSdk.rpc.Api.EventFilter[] = [
    { type: "contract", contractIds: [opts.contractId], topics: buildTopicFilters(opts.address) },
  ]

  try {
    let response: StellarSdk.rpc.Api.GetEventsResponse
    if (opts.cursor) {
      response = await opts.server.getEvents({ filters, cursor: opts.cursor, limit })
    } else {
      const health = await opts.server.getHealth()
      response = await opts.server.getEvents({ filters, startLedger: health.oldestLedger, limit })
    }

    const records = response.events
      .filter((e) => e.inSuccessfulContractCall !== false)
      .map((e) => {
        try {
          return toContractEventActivity(e, asset)
        } catch {
          return null // skip undecodable events rather than failing the whole page
        }
      })
      .filter((e): e is ContractEventActivity => e !== null)

    return {
      status: "ok",
      records,
      nextCursor: response.cursor || null,
      hasMore: response.events.length === limit,
      oldestLedger: response.oldestLedger,
      latestLedger: response.latestLedger,
    }
  } catch (err) {
    const { kind, message } = classifyRpcError(err)
    if (kind === "unsupported") return { status: "unsupported", reason: message }
    return { status: "error", kind, message }
  }
}

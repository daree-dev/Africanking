/**
 * Horizon payment history for an account. Pure fetch + mapping so it can be
 * tested without React.
 */

import type { FetchErrorKind, PageResult, PaymentActivity } from "./types"

/** Raw Horizon payment record (subset of fields used). */
export interface HorizonPaymentRecord {
  id: string
  paging_token: string
  type: string
  created_at: string
  transaction_hash: string
  asset_type?: string
  asset_code?: string
  from?: string
  to?: string
  amount?: string
  funder?: string
  account?: string
  starting_balance?: string
  into?: string
  source_amount?: string
}

/**
 * Operation types that Horizon lists under /payments but which do not carry a
 * classic payment amount. Soroban invocations are represented by contract
 * events instead, so they are excluded here to avoid amount-less rows.
 */
const NON_PAYMENT_TYPES = new Set(["invoke_host_function"])

export function toPaymentActivity(r: HorizonPaymentRecord): PaymentActivity | null {
  if (NON_PAYMENT_TYPES.has(r.type)) return null

  const asset = !r.asset_type || r.asset_type === "native" ? "XLM" : r.asset_code ?? r.asset_type
  const base = {
    kind: "payment" as const,
    id: r.id,
    pagingToken: r.paging_token,
    operationType: r.type,
    createdAt: r.created_at,
    txHash: r.transaction_hash,
  }

  switch (r.type) {
    case "create_account":
      return { ...base, from: r.funder ?? null, to: r.account ?? null, amount: r.starting_balance ?? null, asset: "XLM" }
    case "account_merge":
      return { ...base, from: r.account ?? null, to: r.into ?? null, amount: null, asset: "XLM" }
    default:
      return { ...base, from: r.from ?? null, to: r.to ?? null, amount: r.amount ?? r.source_amount ?? null, asset }
  }
}

function classifyStatus(status: number): FetchErrorKind {
  if (status === 429) return "rate_limited"
  if (status >= 500) return "outage"
  return "bad_response"
}

export interface FetchPaymentsOptions {
  horizonUrl: string
  address: string
  cursor?: string | null
  limit?: number
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}

export async function fetchPaymentsPage(opts: FetchPaymentsOptions): Promise<PageResult<PaymentActivity>> {
  const limit = opts.limit ?? 50
  const params = new URLSearchParams({ order: "desc", limit: String(limit) })
  if (opts.cursor) params.set("cursor", opts.cursor)
  const url = `${opts.horizonUrl}/accounts/${encodeURIComponent(opts.address)}/payments?${params}`
  const doFetch = opts.fetchImpl ?? fetch

  let response: Response
  try {
    response = await doFetch(url, { signal: opts.signal, headers: { Accept: "application/hal+json" } })
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err
    return { status: "error", kind: "network", message: err instanceof Error ? err.message : "Network error" }
  }

  // An unfunded account does not exist on-ledger yet; that is a state, not an error.
  if (response.status === 404) return { status: "account_not_found" }

  if (!response.ok) {
    return { status: "error", kind: classifyStatus(response.status), message: `Horizon responded ${response.status}` }
  }

  let body: { _embedded?: { records?: HorizonPaymentRecord[] } }
  try {
    body = await response.json()
  } catch {
    return { status: "error", kind: "bad_response", message: "Horizon returned invalid JSON" }
  }

  const raw = body._embedded?.records
  if (!Array.isArray(raw)) {
    return { status: "error", kind: "bad_response", message: "Horizon response missing records" }
  }

  const records = raw.map(toPaymentActivity).filter((r): r is PaymentActivity => r !== null)
  const last = raw[raw.length - 1]
  return {
    status: "ok",
    records,
    nextCursor: last?.paging_token ?? null,
    hasMore: raw.length === limit,
  }
}

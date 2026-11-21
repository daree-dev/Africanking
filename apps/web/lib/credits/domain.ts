/**
 * Generation-credit domain rules.
 *
 * A generation credit is an internal cooperative record: a period of verified
 * generation, issued on-chain, then allocated to members by their share. It
 * is NOT a certificate sold to an external buyer and NOT an I-REC/ESG claim.
 *
 * The persisted table is still `certificates` (no rename migration); legacy
 * `sold` / `retired` rows from the old buyer lifecycle stay readable but are
 * read-only.
 */

export type StoredCreditStatus = "pending" | "available" | "sold" | "retired"

/** Lifecycle shown in the UI. */
export type CreditLifecycleStatus = "pending_issuance" | "issued" | "allocated" | "legacy"

export const LEGACY_STATUSES: ReadonlySet<string> = new Set(["sold", "retired"])

export function isLegacyCredit(credit: { status: string }): boolean {
  return LEGACY_STATUSES.has(credit.status)
}

export function deriveCreditStatus(credit: { status: string }, allocationCount: number): CreditLifecycleStatus {
  if (isLegacyCredit(credit)) return "legacy"
  if (credit.status === "pending") return "pending_issuance"
  return allocationCount > 0 ? "allocated" : "issued"
}

/** Only issued (minted, available) credits with no allocation may be allocated. */
export function canAllocate(credit: { status: string }, allocationCount: number): boolean {
  return deriveCreditStatus(credit, allocationCount) === "issued"
}

// ── Allocation ────────────────────────────────────────────────────────────

/**
 * Domain-approved allocation bases:
 * - `installed_capacity`: share proportional to each member's registered
 *   panel capacity (kW) — the default for community parks where members
 *   subscribe to capacity.
 * - `equal`: equal shares among the active members.
 */
export const ALLOCATION_BASES = ["installed_capacity", "equal"] as const
export type AllocationBasis = (typeof ALLOCATION_BASES)[number]

export interface AllocationMember {
  stellar_address: string
  prosumer_id?: string | null
  name?: string | null
  panel_capacity_kw?: number | null
}

export interface AllocationRow {
  stellar_address: string
  prosumer_id: string | null
  name: string | null
  share_percent: number
  kwh_allocated: number
}

export interface AllocationPlan {
  basis: AllocationBasis
  share_version: string
  total_kwh: number
  rows: AllocationRow[]
}

export class AllocationError extends Error {
  constructor(message: string, readonly details: string[] = []) {
    super(message)
    this.name = "AllocationError"
  }
}

/** kWh are stored with 7 decimals, matching the on-chain token precision. */
const KWH_SCALE = 10_000_000

/** Small deterministic hash (FNV-1a, 32-bit) usable in browser and server. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

/**
 * Identifies the exact member register + basis used for an allocation, so a
 * member can later see which share version their amount came from and any
 * change in the register produces a new version.
 */
export function computeShareVersion(basis: AllocationBasis, members: AllocationMember[]): string {
  const canonical = [...members]
    .sort((a, b) => a.stellar_address.localeCompare(b.stellar_address))
    .map((m) => `${m.stellar_address}:${basis === "installed_capacity" ? Number(m.panel_capacity_kw ?? 0) : 1}`)
    .join("|")
  return `${basis}-v1-${fnv1a(canonical)}`
}

/**
 * Split `totalKwh` among members. Amounts are computed in integer stroops
 * (largest-remainder method) so the rows always sum exactly to the total.
 */
export function computeAllocation(totalKwh: number, members: AllocationMember[], basis: AllocationBasis): AllocationPlan {
  if (!(totalKwh > 0)) throw new AllocationError("Credit has no energy to allocate")

  const unique = new Map<string, AllocationMember>()
  for (const m of members) if (m.stellar_address) unique.set(m.stellar_address, m)
  const list = [...unique.values()].sort((a, b) => a.stellar_address.localeCompare(b.stellar_address))
  if (list.length === 0) throw new AllocationError("The cooperative has no members to allocate to")

  let weights: number[]
  if (basis === "installed_capacity") {
    const missing = list.filter((m) => !(Number(m.panel_capacity_kw) > 0))
    if (missing.length > 0) {
      throw new AllocationError(
        "Every member needs a registered panel capacity for an installed-capacity allocation",
        missing.map((m) => m.name || m.stellar_address),
      )
    }
    weights = list.map((m) => Number(m.panel_capacity_kw))
  } else {
    weights = list.map(() => 1)
  }

  const totalWeight = weights.reduce((s, w) => s + w, 0)
  const totalUnits = Math.round(totalKwh * KWH_SCALE)
  const exact = weights.map((w) => (totalUnits * w) / totalWeight)
  const floors = exact.map(Math.floor)
  let remainder = totalUnits - floors.reduce((s, u) => s + u, 0)
  const order = exact
    .map((v, i) => ({ i, frac: v - floors[i] }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (const { i } of order) {
    if (remainder <= 0) break
    floors[i] += 1
    remainder -= 1
  }

  const rows = list.map((m, i) => ({
    stellar_address: m.stellar_address,
    prosumer_id: m.prosumer_id ?? null,
    name: m.name ?? null,
    share_percent: Math.round((weights[i] / totalWeight) * 100 * 10_000) / 10_000,
    kwh_allocated: floors[i] / KWH_SCALE,
  }))

  return { basis, share_version: computeShareVersion(basis, list), total_kwh: totalUnits / KWH_SCALE, rows }
}

/**
 * Issue #8 — Internal credit lifecycle.
 *
 * Replaces the external-buyer (retirement/ESG) flow with an internal
 * cooperative credit lifecycle.  The old "certificates" and "retirements"
 * tables are retained for historical audit; new workflows operate on
 * "credits" with the states below.
 *
 * Credit state machine
 * ────────────────────
 *
 *   measured → validated → allocated → settled
 *                       ↘ cancelled
 *
 *   measured  : a generation event has been recorded from a verified reading
 *   validated : a cooperative admin has confirmed the measurement is correct
 *               and covers a coherent generation period
 *   allocated : the validated credit has been distributed to member accounts
 *               according to their share versions active at that time
 *   settled   : the allocation has been used for billing or token minting
 *   cancelled : the credit was invalidated (e.g. reading later corrected)
 *
 * Historic "pending", "available", "sold", and "retired" certificate rows
 * are preserved as-is; new certificate inserts are blocked in favour of
 * the credit workflow.
 *
 * Migration mapping
 * ─────────────────
 * pending   → measured   (reading recorded, not yet validated)
 * available → validated  (minted but not yet allocated)
 * sold      → allocated  (tokens distributed; treat "sold" as internal allocation)
 * retired   → settled    (closed for billing/external use — keep for audit only)
 */

export type CreditState =
  | "measured"
  | "validated"
  | "allocated"
  | "settled"
  | "cancelled"

/** Legacy states from the certificates table — retained for audit queries */
export type LegacyCertificateState = "pending" | "available" | "sold" | "retired"

/**
 * Maps a legacy certificate status to the equivalent internal credit state.
 * Used during read-time translation so old rows appear in the new lifecycle view.
 */
export function mapLegacyStatusToCreditState(
  legacyStatus: LegacyCertificateState
): CreditState {
  const mapping: Record<LegacyCertificateState, CreditState> = {
    pending:   "measured",
    available: "validated",
    sold:      "allocated",
    retired:   "settled",
  }
  return mapping[legacyStatus]
}

/**
 * Permitted state transitions for the internal credit lifecycle.
 * Any transition not listed here is a bug and should throw.
 */
const ALLOWED_TRANSITIONS: Record<CreditState, CreditState[]> = {
  measured:  ["validated", "cancelled"],
  validated: ["allocated", "cancelled"],
  allocated: ["settled", "cancelled"],
  settled:   [],
  cancelled: [],
}

export function assertValidCreditTransition(
  current: CreditState,
  next: CreditState
): void {
  const allowed = ALLOWED_TRANSITIONS[current]
  if (!allowed.includes(next)) {
    throw new CreditLifecycleError(
      `Invalid credit state transition: "${current}" → "${next}". ` +
        `Allowed from "${current}": [${allowed.join(", ") || "none"}].`
    )
  }
}

export interface CreditAllocation {
  credit_id: string
  member_id: string
  cooperative_id: string
  share_version_id: string  // provenance: which share version governed this allocation
  share_percentage: number
  allocated_kwh: number
  allocation_date: string
  state: CreditState
}

/**
 * Distributes `total_kwh` across members according to their share versions.
 * Each allocation row carries the `share_version_id` for full provenance.
 *
 * Rounding: the last member absorbs any remainder from floating-point
 * truncation so that the sum of allocated kWh always equals total_kwh
 * within one Wh (0.001 kWh).
 */
export function computeAllocations(params: {
  credit_id: string
  cooperative_id: string
  total_kwh: number
  allocation_date: string
  memberShares: Array<{
    member_id: string
    share_percentage: number
    share_version_id: string
  }>
}): CreditAllocation[] {
  const { credit_id, cooperative_id, total_kwh, allocation_date, memberShares } = params

  if (memberShares.length === 0) {
    throw new CreditLifecycleError(
      "Cannot allocate: no member shares provided for this cooperative."
    )
  }

  const PRECISION = 3
  const factor = 10 ** PRECISION

  let remaining = Math.round(total_kwh * factor)
  const allocations: CreditAllocation[] = []

  memberShares.forEach((ms, idx) => {
    const isLast = idx === memberShares.length - 1
    const rawKwh = isLast
      ? remaining / factor
      : Math.floor((ms.share_percentage / 100) * total_kwh * factor) / factor

    if (!isLast) {
      remaining -= Math.round(rawKwh * factor)
    }

    allocations.push({
      credit_id,
      member_id: ms.member_id,
      cooperative_id,
      share_version_id: ms.share_version_id,
      share_percentage: ms.share_percentage,
      allocated_kwh: rawKwh,
      allocation_date,
      state: "allocated",
    })
  })

  return allocations
}

export class CreditLifecycleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CreditLifecycleError"
  }
}

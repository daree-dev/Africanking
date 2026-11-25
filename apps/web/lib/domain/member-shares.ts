/**
 * Issue #5 — Member participation share versioning.
 *
 * Share percentages are stored as effective-dated versions instead of a single
 * mutable value.  Every allocation resolves which share version was active on
 * the allocation date and stores that provenance (share_version_id) alongside
 * the allocation row.
 *
 * Canonical unit: percentage, stored as a decimal in [0, 100] with two decimal
 * places of precision.
 */

export interface MemberShareVersion {
  id: string
  member_id: string
  cooperative_id: string
  share_percentage: number  // 0–100, two decimal precision
  effective_from: string    // ISO date
  effective_until: string | null  // null = currently active
  created_by: string        // stellar address of admin who set this
  created_at: string
}

/**
 * Returns the share version that was active on `allocationDate`.
 * Throws when no version covers that date, which prevents silent
 * mis-allocation.
 */
export function resolveShareVersion(
  versions: MemberShareVersion[],
  allocationDate: string
): MemberShareVersion {
  const target = new Date(allocationDate)
  const active = versions
    .filter((v) => {
      const from = new Date(v.effective_from)
      const until = v.effective_until ? new Date(v.effective_until) : null
      return from <= target && (until === null || target <= until)
    })
    .sort((a, b) => new Date(b.effective_from).getTime() - new Date(a.effective_from).getTime())

  if (active.length === 0) {
    throw new Error(
      `No active share version found for member on date ${allocationDate}. ` +
        `Create a share version that covers this period before allocating.`
    )
  }
  return active[0]!
}

/**
 * Validates that the total shares for all active members in a cooperative
 * do not exceed the cooperative's allocation cap (default 100 %).
 * Returns the sum so callers can include it in error messages.
 */
export function validateShareTotal(
  activeMemberShares: { share_percentage: number; member_id: string }[],
  allocationCap: number = 100
): { valid: boolean; total: number; excess: number } {
  const total = activeMemberShares.reduce(
    (sum, m) => sum + m.share_percentage,
    0
  )
  // Round to two decimal places to avoid floating-point drift
  const rounded = Math.round(total * 100) / 100
  const excess = Math.max(0, Math.round((rounded - allocationCap) * 100) / 100)
  return { valid: excess === 0, total: rounded, excess }
}

/**
 * Builds the effective period for a new share version being added for a member.
 * Closes the previous open-ended version the day before the new effective_from.
 */
export function computeEffectiveUntil(
  existingActiveVersion: MemberShareVersion | undefined,
  newEffectiveFrom: string
): { closeDate: string | null } {
  if (!existingActiveVersion) return { closeDate: null }

  const from = new Date(newEffectiveFrom)
  const dayBefore = new Date(from)
  dayBefore.setDate(dayBefore.getDate() - 1)
  const closeDate = dayBefore.toISOString().split("T")[0]!

  return { closeDate }
}

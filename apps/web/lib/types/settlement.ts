/**
 * Settlement domain types (issue #9).
 *
 * Key design decisions:
 * - SettlementStatus and approver are separate from on-chain transaction status.
 * - EnergyCredit is never a monetary invoice; it carries kWh and allocation metadata only.
 * - MonetaryInvoice is an explicit, separate type so the two can never be confused.
 */

// ---------------------------------------------------------------------------
// Settlement period
// ---------------------------------------------------------------------------

export interface SettlementPeriod {
  id: string
  cooperative_id: string
  /** ISO-8601 date, inclusive */
  period_start: string
  /** ISO-8601 date, inclusive */
  period_end: string
  /** Monotonically increasing; bumped on every correction run */
  allocation_version: number
  status: SettlementStatus
  /** DB user id of the cooperative admin who approved this settlement */
  approved_by: string | null
  approved_at: string | null
  created_at: string
  updated_at: string
}

/** Off-chain settlement lifecycle — independent of on-chain tx status */
export type SettlementStatus =
  | "draft"      // period created, allocation not yet finalised
  | "pending"    // allocation computed, awaiting approver review
  | "approved"   // approver confirmed the figures
  | "corrected"  // a correction was applied after initial approval
  | "closed"     // immutable; no further corrections allowed

// ---------------------------------------------------------------------------
// Source readings snapshot
// ---------------------------------------------------------------------------

export interface SettlementSourceReading {
  settlement_id: string
  reading_id: string
  meter_id: string
  /** ISO-8601 timestamp from the device */
  source_timestamp: string
  kwh_generated: number
  kwh_injected: number
  kwh_self_consumed: number | null
  interval_minutes: number
  /** Source as recorded on the reading row (meter | manual | estimate) */
  source: string
}

// ---------------------------------------------------------------------------
// Allocation record (per member, per period)
// ---------------------------------------------------------------------------

export interface MemberAllocation {
  id: string
  settlement_id: string
  member_stellar_address: string
  /** Snapshot of the allocation rule version used */
  allocation_version: number
  /** kWh share assigned to this member based on panel_capacity_kw ratio */
  allocated_kwh: number
  /** Fraction of cooperative total (0–1) */
  allocation_share: number
  /** Reference to any manual adjustment applied */
  adjustment_reference: string | null
  adjustment_reason: string | null
  created_at: string
}

// ---------------------------------------------------------------------------
// Energy credit
//
// An energy credit represents a member's share of cooperative generation.
// It is NOT a monetary invoice and does NOT represent an I-REC/ESG certificate.
// ---------------------------------------------------------------------------

export interface EnergyCredit {
  id: string
  settlement_id: string
  member_stellar_address: string
  cooperative_id: string
  /** kWh credited to the member for this settlement period */
  credit_kwh: number
  /** Blockchain token units minted, if any (informational only) */
  token_units: number | null
  /** On-chain mint transaction hash — separate from settlement status */
  mint_tx_hash: string | null
  /** On-chain status is tracked here, independently of SettlementStatus */
  onchain_status: OnchainCreditStatus
  credit_type: "generation" // explicitly not "payment" or "invoice"
  created_at: string
}

/** On-chain lifecycle for the token side of a credit */
export type OnchainCreditStatus =
  | "pending_mint"
  | "minted"
  | "mint_failed"

// ---------------------------------------------------------------------------
// Adjustment / correction trail
// ---------------------------------------------------------------------------

export interface SettlementAdjustment {
  id: string
  settlement_id: string
  /** References the allocation row being corrected */
  member_stellar_address: string
  previous_kwh: number
  corrected_kwh: number
  reason: string
  /** DB user id of who applied the correction */
  applied_by: string
  applied_at: string
}

// ---------------------------------------------------------------------------
// Helpers — explicit guard so callers never mix energy credits with invoices
// ---------------------------------------------------------------------------

/** Monetary invoice is an entirely separate concept from an energy credit. */
export interface MonetaryInvoice {
  id: string
  cooperative_id: string
  member_stellar_address: string
  /** ISO 4217 currency code */
  currency: string
  amount: number
  description: string
  issued_at: string
  due_at: string | null
  status: "draft" | "issued" | "paid" | "void"
}

/**
 * Type guard: confirms a value is an EnergyCredit, not a MonetaryInvoice.
 * Use this whenever a function might receive either to prevent mixing them.
 */
export function isEnergyCredit(value: EnergyCredit | MonetaryInvoice): value is EnergyCredit {
  return (value as EnergyCredit).credit_type === "generation"
}

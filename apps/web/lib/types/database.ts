export interface Cooperative {
  id: string
  name: string
  location: string | null
  province: string | null
  country: string
  technology: "solar" | "wind" | "hydro" | "mixed"
  admin_stellar_address: string
  token_contract_address: string | null
  distribution_contract_address: string | null
  status: "active" | "inactive"
  created_at: string
}

export interface Member {
  id: string
  stellar_address: string
  name: string | null
  hive_id: string
  panel_capacity_kw: number | null
  cooperative_id: string | null
  role: "prosumer" | "copropietario" | "mixed"
  created_at: string
}

/** Issue #5 — effective-dated share version for a member */
export interface MemberShareVersion {
  id: string
  member_id: string
  cooperative_id: string
  share_percentage: number
  effective_from: string
  effective_until: string | null
  created_by: string
  created_at: string
}

export interface Meter {
  id: string
  cooperative_id: string
  member_stellar_address: string
  device_type: "inverter" | "bidirectional_meter" | "smart_meter"
  manufacturer: string | null
  model: string | null
  serial_number: string | null
  location_lat: number | null
  location_lng: number | null
  technology: "solar" | "wind" | "hydro" | "biomass"
  capacity_kw: number
  installed_at: string | null
  status: "active" | "inactive" | "maintenance"
  created_at: string
}

/** Issue #7 — source type distinguishes authoritative meter from operational telemetry */
export type ReadingSourceType = "distributor_meter" | "inverter" | "scada" | "manual"

/** Issue #7 — verification state machine for readings */
export type VerificationState = "pending" | "verified" | "rejected" | "corrected"

export interface Reading {
  id: string
  prosumer_id: string | null
  meter_id: string | null
  cooperative_id: string | null
  kwh_generated: number
  kwh_self_consumed: number | null
  /** Issue #6 — canonical net surplus quantity */
  kwh_net_surplus: number | null
  power_watts: number | null
  interval_minutes: number
  reading_date: string | null
  reading_timestamp: string | null
  /** Issue #7 — provenance fields */
  source: string
  source_type: ReadingSourceType
  source_id: string | null
  ingestion_time: string | null
  measurement_time: string | null
  verification_state: VerificationState
  verified_by: string | null
  verified_at: string | null
  corrects_reading_id: string | null
  status: string
  tx_hash: string | null
  created_at: string
}

export interface Certificate {
  id: string
  cooperative_id: string
  generation_period_start: string
  generation_period_end: string
  total_kwh: number
  technology: string
  location: string | null
  mint_tx_hash: string | null
  token_amount: number | null
  /**
   * "sold" is a retired marketplace concept. Historic records may carry this
   * status; active cooperative flows use "pending" | "available" | "retired".
   * @deprecated Use "retired" for new cooperative member allocations.
   */
  status: "pending" | "available" | "retired" | "sold"
  created_at: string
}

/** Per-member share of a generation credit (see docs/migrations/20261121_credit_allocations.sql). */
export interface CreditAllocation {
  id: string
  certificate_id: string
  cooperative_id: string
  member_stellar_address: string
  prosumer_id: string | null
  basis: "installed_capacity" | "equal"
  share_version: string
  share_percent: number
  kwh_allocated: number
  allocated_by: string
  allocated_at: string
}

/** LEGACY buyer retirement from the pre-pivot marketplace model. Read-only. */
export interface Retirement {
  id: string
  certificate_id: string
  /**
   * @deprecated buyer_address is a retired marketplace concept. Retained for
   * historic audit records. New cooperative retirements set this to the
   * cooperative admin's Stellar address.
   */
  buyer_address: string
  /** @deprecated See buyer_address */
  buyer_name: string | null
  /**
   * Purpose codes retained for historic records; new cooperative flows do not
   * expose esg_reporting / carbon_offset in the member-facing UI.
   */
  buyer_purpose:
    | "esg_reporting"
    | "carbon_offset"
    | "voluntary_commitment"
    | "regulatory_compliance"
    | "other"
  kwh_retired: number
  burn_tx_hash: string | null
  retired_at: string
}

export interface MintLog {
  id: string
  reading_id: string | null
  certificate_id: string | null
  prosumer_address: string
  amount_hdrop: number
  tx_hash: string
  minted_at: string
}

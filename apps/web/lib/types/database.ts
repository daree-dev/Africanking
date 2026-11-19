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
  /** Legacy status — use Credit.state for new workflows */
  status: "pending" | "available" | "sold" | "retired"
  created_at: string
}

/** Issue #8 — internal credit state machine */
export type CreditState = "measured" | "validated" | "allocated" | "settled" | "cancelled"

/** Issue #8 — internal credit replacing the external certificate/retirement flow */
export interface Credit {
  id: string
  cooperative_id: string
  reading_id: string
  generation_period_start: string
  generation_period_end: string
  kwh_generated: number
  kwh_self_consumed: number
  kwh_net_surplus: number
  state: CreditState
  notes: string | null
  created_by: string
  validated_by: string | null
  validated_at: string | null
  updated_by: string | null
  updated_at: string | null
  created_at: string
}

/** Issue #8 — per-member allocation row produced by the allocated transition */
export interface CreditAllocation {
  id: string
  credit_id: string
  member_id: string
  cooperative_id: string
  share_version_id: string
  share_percentage: number
  allocated_kwh: number
  allocation_date: string
  state: CreditState
  created_at: string
}

export interface Retirement {
  id: string
  certificate_id: string
  buyer_address: string
  buyer_name: string | null
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

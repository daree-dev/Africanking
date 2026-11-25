/**
 * Types for Stellar mint/allocation reconciliation.
 *
 * Reconciliation compares what the database claims about a mint (certificate
 * or legacy reading) against finalized transaction evidence from the
 * configured Stellar network. Generation credits are assigned to cooperative
 * members; this tooling only verifies that on-chain issuance matches the
 * cooperative's records — it makes no certification claim.
 */

export type MintRecordKind = "certificate" | "reading"

/** A database row that tracks a mint, normalised for reconciliation. */
export interface MintRecord {
  kind: MintRecordKind
  id: string
  cooperative_id: string | null
  /** Raw DB status (certificate: pending|available|sold|retired, reading: pending|minted|failed) */
  status: string
  /** Hash stored on the row (certificates.mint_tx_hash / readings.tx_hash) */
  tx_hash: string | null
  /** kWh the row expects to have been minted */
  expected_kwh: number | null
  /** Token contract the mint must have been executed against */
  expected_contract: string
  /** Recipient recorded at mint time, if known (mint_log / prosumer address) */
  expected_recipient: string | null
  /** token_amount for certificates, null for readings */
  token_amount: number | null
}

/** A decoded `mint` contract event. */
export interface MintEvent {
  contract_id: string
  to: string
  /** Amount in stroops (7 decimals) as a decimal string so fixtures stay JSON-safe. */
  amount: string
}

export type EvidenceStatus = "SUCCESS" | "FAILED" | "NOT_FOUND"

/**
 * Finalized evidence for one transaction hash. Stellar has deterministic
 * finality: SUCCESS/FAILED returned by RPC are already in a closed ledger.
 * NOT_FOUND is ambiguous — the transaction may never have landed, or may be
 * older than the RPC retention window (see `oldest_ledger`).
 */
export interface TransactionEvidence {
  hash: string
  status: EvidenceStatus
  ledger: number | null
  latest_ledger: number
  oldest_ledger: number | null
  mint_events: MintEvent[]
}

export type Verdict =
  /** DB and chain agree */
  | "consistent"
  /** DB says completed but chain says the tx failed */
  | "completed_but_failed"
  /** DB still pending although the tx is finalized as SUCCESS */
  | "pending_but_confirmed"
  /** DB pending with a hash whose tx finalized as FAILED (blocks retries) */
  | "pending_but_failed"
  /** No finalized evidence available for the stored hash */
  | "missing_evidence"
  /** Pending row with no hash — nothing to reconcile yet */
  | "not_submitted"
  /** Row claims completion without any hash */
  | "completed_without_hash"
  /** Evidence exists but disagrees with the row (amount, recipient, contract) */
  | "conflicting_evidence"

/** A single field change proposed by reconciliation. */
export interface RepairPatch {
  table: "certificates" | "readings"
  id: string
  /** Values the update is conditioned on (optimistic concurrency). */
  expect: Record<string, unknown>
  /** Values to write. */
  set: Record<string, unknown>
}

export interface ReconciliationResult {
  record: MintRecord
  verdict: Verdict
  /** Human-readable reasons, one per check that failed or passed notably. */
  reasons: string[]
  /** Present only when the correction is a safe derived-state change. */
  repair: RepairPatch | null
  /** True when an operator must look at this row; no automatic change is made. */
  needs_manual_review: boolean
}

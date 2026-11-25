/**
 * Issue #7 — Source and verification provenance for every reading.
 *
 * A reading must record:
 *  - source_type: who or what produced the value
 *  - source_id:   identifier of the specific device or operator
 *  - ingestion_time: when the system received the data
 *  - measurement_time: when the energy was actually measured
 *  - verification_state: whether the reading has been approved for use in
 *    crediting workflows
 *
 * Authoritative vs. operational telemetry
 * ────────────────────────────────────────
 * "distributor_meter" readings come from the utility's bidirectional meter —
 * these are commercially authoritative for net injection.
 *
 * "inverter" and "scada" readings are operational telemetry.  They can be used
 * for real-time monitoring but must NOT enter any crediting workflow until
 * promoted to "verified" by a cooperative admin.
 *
 * Verification state machine:
 *   pending → verified  (admin approves)
 *   pending → rejected  (admin rejects)
 *   verified → corrected  (admin supersedes with a correction)
 *
 *   Only "verified" readings can be referenced by certificates / allocations.
 */

export type ReadingSourceType =
  | "distributor_meter"   // bidirectional meter owned by the utility distributor
  | "inverter"            // DC/AC inverter telemetry (operational, not authoritative)
  | "scada"               // SCADA/EMS aggregated data (operational)
  | "manual"              // human operator entry

export type VerificationState = "pending" | "verified" | "rejected" | "corrected"

export interface ReadingProvenance {
  source_type: ReadingSourceType
  source_id: string        // device serial, SCADA system ID, or operator address
  ingestion_time: string   // ISO 8601, server-assigned on receipt
  measurement_time: string // ISO 8601, reflects when the interval ended
  verification_state: VerificationState
  verified_by: string | null       // stellar address of the verifying admin
  verified_at: string | null       // ISO 8601
  corrects_reading_id: string | null  // id of the reading this row supersedes
}

/**
 * Returns true when the source_type is commercially authoritative for net
 * injection into the grid.
 */
export function isAuthoritativeSource(sourceType: ReadingSourceType): boolean {
  return sourceType === "distributor_meter"
}

/**
 * Returns true when a reading is eligible to enter a crediting workflow.
 * Unverified operational telemetry is explicitly blocked here so the check
 * exists in one place and cannot be bypassed.
 */
export function isVerifiedForCrediting(provenance: {
  source_type: ReadingSourceType
  verification_state: VerificationState
}): boolean {
  return provenance.verification_state === "verified"
}

/**
 * Throws if the reading is not eligible for a crediting workflow.
 * Call this at the start of any allocation, certificate creation, or minting
 * path to prevent unverified operational data from silently entering.
 */
export function assertVerifiedForCrediting(provenance: {
  source_type: ReadingSourceType
  verification_state: VerificationState
  id?: string
}): void {
  if (!isVerifiedForCrediting(provenance)) {
    const id = provenance.id ? ` (id: ${provenance.id})` : ""
    throw new ProvenanceError(
      `Reading${id} has verification_state="${provenance.verification_state}" ` +
        `and source_type="${provenance.source_type}". ` +
        "Only verified readings may enter crediting workflows. " +
        "Have a cooperative admin verify this reading first."
    )
  }
}

/**
 * Validates that a state transition is permitted.
 * Permitted transitions:
 *   pending  → verified
 *   pending  → rejected
 *   verified → corrected
 *
 * Any other transition is rejected to preserve audit integrity.
 */
export function assertValidStateTransition(
  current: VerificationState,
  next: VerificationState
): void {
  const allowed: Record<VerificationState, VerificationState[]> = {
    pending:   ["verified", "rejected"],
    verified:  ["corrected"],
    rejected:  [],
    corrected: [],
  }

  if (!allowed[current].includes(next)) {
    throw new ProvenanceError(
      `Invalid state transition: "${current}" → "${next}". ` +
        `Allowed transitions from "${current}": [${allowed[current].join(", ") || "none"}].`
    )
  }
}

export class ProvenanceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ProvenanceError"
  }
}

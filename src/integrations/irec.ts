/**
 * I-REC integration boundary.
 *
 * BeEnergy generation credits are internal cooperative-management records
 * assigned to cooperative members. They are NOT I-REC certificates and must
 * never be represented as formal environmental-attribute claims.
 *
 * This module defines the boundary only. It does not submit, register, or
 * represent any formal claim. Formal claims are blocked until an approved
 * provider agreement and an explicit product decision exist.
 *
 * Responsibilities in any I-REC workflow are kept separate from BeEnergy
 * generation credits:
 *   - registration:  registering a device/project with the I-REC registry
 *   - issuer:        the approved I-REC issuer acting on our behalf
 *   - issuance:      minting I-REC certificates for verified generation
 *   - transfer:      moving certificates between registry accounts
 *   - retirement:    permanently retiring certificates against a claim
 *
 * Provider identifiers and formal certificate status live in their own
 * namespace and are never stored on, or derived from, generation credits.
 */

/** The distinct responsibilities of an I-REC workflow. */
export type IrecResponsibility =
  | "registration"
  | "issuer"
  | "issuance"
  | "transfer"
  | "retirement";

/**
 * Formal certificate status. This is deliberately separate from any
 * BeEnergy generation-credit status and must not be cross-labeled.
 */
export type IrecCertificateStatus =
  | "none"
  | "pending"
  | "issued"
  | "transferred"
  | "retired";

/**
 * Provider-side identifiers for an I-REC workflow. These are never the same
 * as BeEnergy generation-credit identifiers.
 */
export interface IrecProviderIdentifiers {
  /** Approved I-REC provider/issuer identifier, if any. */
  providerId?: string;
  /** Registry device/project identifier, if any. */
  registryDeviceId?: string;
  /** Registry account identifier, if any. */
  registryAccountId?: string;
}

/**
 * A formal I-REC record. Kept in a separate namespace from generation credits
 * so the two can never be conflated.
 */
export interface IrecCertificateRecord {
  /** Formal certificate status — not a generation-credit status. */
  status: IrecCertificateStatus;
  /** Provider identifiers, kept apart from generation-credit ids. */
  provider: IrecProviderIdentifiers;
  /** Responsibility currently owning this record, if any. */
  responsibility?: IrecResponsibility;
}

/**
 * Gate for any formal I-REC claim. Both an approved provider agreement and an
 * explicit product decision are required before anything may be submitted or
 * represented as a formal claim.
 */
export interface IrecClaimGate {
  approvedProviderAgreement: boolean;
  productDecisionApproved: boolean;
}

/**
 * Returns true only when formal I-REC claims are permitted. Until both the
 * provider agreement and the product decision are approved, no formal claim
 * may be submitted or represented.
 */
export function canRepresentFormalClaim(gate: IrecClaimGate): boolean {
  return gate.approvedProviderAgreement === true && gate.productDecisionApproved === true;
}

/**
 * Guard used before submitting or representing any formal I-REC claim.
 * Throws when the gate is not satisfied so callers cannot accidentally
 * represent internal generation credits as formal certificates.
 */
export function assertFormalClaimAllowed(gate: IrecClaimGate): void {
  if (!canRepresentFormalClaim(gate)) {
    throw new Error(
      "Formal I-REC claims are blocked until an approved provider agreement and product decision exist.",
    );
  }
}

/**
 * Human-readable label for a formal certificate status. Used to keep
 * terminology distinct from BeEnergy generation-credit labels.
 */
export function describeCertificateStatus(status: IrecCertificateStatus): string {
  switch (status) {
    case "none":
      return "No formal I-REC certificate";
    case "pending":
      return "I-REC certificate pending issuance";
    case "issued":
      return "I-REC certificate issued";
    case "transferred":
      return "I-REC certificate transferred";
    case "retired":
      return "I-REC certificate retired";
  }
}

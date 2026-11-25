/**
 * Issue #7 — Reading provenance badge.
 * Displays source type and verification state so users can distinguish
 * commercially authoritative distributor meter readings from operational telemetry.
 */
import type { ReadingSourceType, VerificationState } from "@/lib/types/database"

const SOURCE_LABELS: Record<ReadingSourceType, string> = {
  distributor_meter: "Distributor Meter",
  inverter:          "Inverter",
  scada:             "SCADA",
  manual:            "Manual",
}

const VERIFICATION_STYLES: Record<VerificationState, { label: string; className: string }> = {
  pending:   { label: "Pending",   className: "bg-solar-yellow/10 text-solar-yellow border-solar-yellow/20" },
  verified:  { label: "Verified",  className: "bg-energy-green/10 text-energy-green border-energy-green/20" },
  rejected:  { label: "Rejected",  className: "bg-red-500/10 text-red-500 border-red-500/20" },
  corrected: { label: "Corrected", className: "bg-web3-purple/10 text-web3-purple border-web3-purple/20" },
}

interface ReadingProvenanceBadgeProps {
  sourceType: ReadingSourceType | string
  verificationState: VerificationState | string
  sourceId?: string | null
  verifiedBy?: string | null
  verifiedAt?: string | null
  className?: string
}

export function ReadingProvenanceBadge({
  sourceType,
  verificationState,
  sourceId,
  verifiedBy,
  verifiedAt,
  className = "",
}: ReadingProvenanceBadgeProps) {
  const sourceLabel = SOURCE_LABELS[sourceType as ReadingSourceType] ?? sourceType
  const isAuthoritative = sourceType === "distributor_meter"

  const verStyle =
    VERIFICATION_STYLES[verificationState as VerificationState] ?? VERIFICATION_STYLES.pending

  const title = [
    `Source: ${sourceLabel}`,
    sourceId ? `ID: ${sourceId}` : null,
    `Verification: ${verStyle.label}`,
    verifiedBy ? `Verified by: ${verifiedBy}` : null,
    verifiedAt ? `at ${new Date(verifiedAt).toLocaleString()}` : null,
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full border ${verStyle.className} ${className}`}
      title={title}
    >
      {isAuthoritative && (
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-energy-green mr-0.5" aria-hidden />
      )}
      {sourceLabel} · {verStyle.label}
    </span>
  )
}

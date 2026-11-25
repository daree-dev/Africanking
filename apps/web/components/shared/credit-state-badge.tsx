/**
 * Issue #8 — Credit state badge component.
 * Renders the internal credit lifecycle state with appropriate colour coding.
 * Also handles the legacy certificate statuses by mapping them to credit states.
 */
import type { CreditState } from "@/lib/types/database"

type LegacyStatus = "pending" | "available" | "sold" | "retired"

const LEGACY_TO_CREDIT: Record<LegacyStatus, CreditState> = {
  pending:   "measured",
  available: "validated",
  sold:      "allocated",
  retired:   "settled",
}

const STATE_STYLES: Record<CreditState, { label: string; className: string }> = {
  measured:  { label: "Measured",  className: "bg-muted/60 text-muted-foreground border-muted" },
  validated: { label: "Validated", className: "bg-energy-green/10 text-energy-green border-energy-green/20" },
  allocated: { label: "Allocated", className: "bg-web3-purple/10 text-web3-purple border-web3-purple/20" },
  settled:   { label: "Settled",   className: "bg-solar-orange/10 text-solar-orange border-solar-orange/20" },
  cancelled: { label: "Cancelled", className: "bg-red-500/10 text-red-500 border-red-500/20" },
}

interface CreditStateBadgeProps {
  /** Either a CreditState or a legacy certificate status string */
  state: string
  className?: string
}

function resolveCreditState(state: string): CreditState {
  if (state in LEGACY_TO_CREDIT) {
    return LEGACY_TO_CREDIT[state as LegacyStatus]
  }
  if (state in STATE_STYLES) {
    return state as CreditState
  }
  return "measured"
}

export function CreditStateBadge({ state, className = "" }: CreditStateBadgeProps) {
  const creditState = resolveCreditState(state)
  const { label, className: stateClass } = STATE_STYLES[creditState]

  return (
    <span
      className={`text-xs font-medium px-2 py-1 rounded-full border ${stateClass} ${className}`}
      title={`Credit state: ${creditState}${state !== creditState ? ` (from legacy: ${state})` : ""}`}
    >
      {label}
    </span>
  )
}

/**
 * Issue #6 — Gross generation, self-consumption, and net surplus calculations.
 *
 * Canonical definitions
 * ─────────────────────
 * kwh_generated  : total energy produced by the generation asset (gross), always ≥ 0
 * kwh_self_consumed : portion of generated energy consumed on-site, 0 ≤ value ≤ kwh_generated
 * kwh_net_surplus   : energy injected into the grid = max(0, kwh_generated − kwh_self_consumed)
 *
 * Sign convention: all quantities are non-negative.  A net surplus of 0 means
 * everything generated was consumed on-site (or generation was 0).
 *
 * Precision: results are rounded to three decimal places (Wh-level resolution
 * for readings in the kWh range, e.g. 0.001 kWh = 1 Wh).
 *
 * Missing / estimated inputs
 * ──────────────────────────
 * - If kwh_self_consumed is null, the caller must supply kwh_net_surplus directly
 *   (e.g. from a bidirectional meter's export register).
 * - An "estimated" reading may enter the system but cannot trigger an allocation
 *   until it is superseded by a verified reading or manually confirmed.
 * - A "corrected" reading replaces an earlier estimated or erroneous row; both
 *   are retained for audit.  Only the corrected row participates in allocation.
 */

export type ReadingQuality = "measured" | "estimated" | "corrected"

export interface EnergyInput {
  kwh_generated: number
  kwh_self_consumed: number | null
  kwh_net_surplus_override: number | null  // from bidirectional meter export register
  quality: ReadingQuality
}

export interface EnergyResult {
  kwh_generated: number
  kwh_self_consumed: number | null
  kwh_net_surplus: number
  quality: ReadingQuality
  /**
   * When true, the net surplus was derived from kwh_generated − kwh_self_consumed.
   * When false, it came directly from an authoritative meter register.
   */
  surplus_is_derived: boolean
}

const PRECISION = 3  // decimal places (1 Wh)

function round(value: number): number {
  const factor = 10 ** PRECISION
  return Math.round(value * factor) / factor
}

/**
 * Compute the canonical energy quantities for one reading interval.
 *
 * Rules:
 *  1. kwh_generated must be ≥ 0.
 *  2. kwh_self_consumed, when provided, is clamped to [0, kwh_generated] so
 *     that measurement noise or rounding errors cannot produce a negative
 *     surplus.  Any clamped value is noted in the returned object.
 *  3. If a bidirectional-meter surplus override is supplied, it takes
 *     precedence over the derived calculation.
 *  4. Throws `EnergyCalculationError` for inputs that are logically impossible
 *     and cannot be recovered (e.g. negative generation).
 */
export function computeEnergyQuantities(input: EnergyInput): EnergyResult {
  const { kwh_generated, kwh_self_consumed, kwh_net_surplus_override, quality } = input

  if (kwh_generated < 0) {
    throw new EnergyCalculationError(
      `kwh_generated cannot be negative (got ${kwh_generated}). ` +
        "Check meter orientation or sign convention."
    )
  }

  const gen = round(kwh_generated)

  // If an authoritative export-register value is available, use it directly.
  if (kwh_net_surplus_override !== null) {
    if (kwh_net_surplus_override < 0) {
      throw new EnergyCalculationError(
        `kwh_net_surplus_override cannot be negative (got ${kwh_net_surplus_override}).`
      )
    }
    const surplus = round(kwh_net_surplus_override)
    // Derive self-consumption from the override when possible
    const self = gen >= surplus ? round(gen - surplus) : null
    return {
      kwh_generated: gen,
      kwh_self_consumed: self,
      kwh_net_surplus: surplus,
      quality,
      surplus_is_derived: false,
    }
  }

  // Derive from kwh_self_consumed
  if (kwh_self_consumed === null) {
    throw new EnergyCalculationError(
      "Cannot compute net surplus: kwh_self_consumed is null and no " +
        "kwh_net_surplus_override was provided."
    )
  }

  if (kwh_self_consumed < 0) {
    throw new EnergyCalculationError(
      `kwh_self_consumed cannot be negative (got ${kwh_self_consumed}).`
    )
  }

  // Clamp self-consumption to generation — protects against minor sensor drift.
  const self = round(Math.min(kwh_self_consumed, kwh_generated))
  const surplus = round(Math.max(0, gen - self))

  return {
    kwh_generated: gen,
    kwh_self_consumed: self,
    kwh_net_surplus: surplus,
    quality,
    surplus_is_derived: true,
  }
}

export class EnergyCalculationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "EnergyCalculationError"
  }
}

/**
 * Guards the crediting workflow against using gross generation as the
 * creditable quantity when only net surplus should be credited.
 *
 * Throws if the caller is about to credit kwh_generated instead of
 * kwh_net_surplus without an explicit override flag.
 */
export function assertNetSurplusForCrediting(
  result: EnergyResult,
  allowGrossOverride: boolean = false
): void {
  if (allowGrossOverride) return
  if (result.kwh_net_surplus === result.kwh_generated) {
    // This is only valid when self-consumption is zero — allow it.
    return
  }
  // If surplus < generated, crediting generated would inflate the credit.
  if (result.kwh_net_surplus < result.kwh_generated) {
    throw new EnergyCalculationError(
      `Crediting workflow received kwh_generated (${result.kwh_generated} kWh) ` +
        `but the creditable quantity is kwh_net_surplus (${result.kwh_net_surplus} kWh). ` +
        "Pass the EnergyResult.kwh_net_surplus to the crediting function, " +
        "or set allowGrossOverride=true if gross generation is intentional."
    )
  }
}

/**
 * Determines the creditable kWh for a reading result.
 * This is the single entry point the mint/allocation path calls so it cannot
 * silently treat gross generation as the creditable amount.
 */
export function getCreditableKwh(result: EnergyResult): number {
  assertNetSurplusForCrediting(result)
  return result.kwh_net_surplus
}

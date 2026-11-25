/**
 * Shared energy amount utilities.
 *
 * Energy amounts are stored as exact decimals, never as binary floating point.
 * The canonical representation is a fixed-scale decimal string with
 * `ENERGY_DECIMALS` fractional digits, which maps 1:1 onto Soroban contract
 * subunits (stroops-style integer units).
 *
 * Database representation: `NUMERIC(38, 7)` (see migration notes below).
 * JavaScript representation: `string` (canonical) or `bigint` (subunits).
 * Never convert through `number` for persisted values.
 */

/** Fractional digits of the canonical energy scale. Must match the DB column scale. */
export const ENERGY_DECIMALS = 7;

/** Integer subunits per whole energy unit (10^ENERGY_DECIMALS). */
export const ENERGY_SCALE = 10n ** BigInt(ENERGY_DECIMALS);

/** Maximum total digits supported by the NUMERIC(38, 7) column. */
export const ENERGY_MAX_DIGITS = 38;

/** Maximum absolute value in subunits that fits NUMERIC(38, 7). */
export const ENERGY_MAX_SUBUNITS = 10n ** BigInt(ENERGY_MAX_DIGITS) - 1n;

const CANONICAL_RE = /^-?\d+(\.\d{1,7})?$/;

export class EnergyAmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnergyAmountError';
  }
}

/**
 * Parse a decimal energy string into exact integer subunits.
 * Rejects values with more than ENERGY_DECIMALS fractional digits instead of
 * silently rounding, so callers can decide how to handle the drift.
 */
export function toSubunits(value: string): bigint {
  const trimmed = value.trim();
  if (!CANONICAL_RE.test(trimmed)) {
    throw new EnergyAmountError(`Invalid energy amount: ${JSON.stringify(value)}`);
  }

  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole, fraction = ''] = unsigned.split('.');
  const paddedFraction = fraction.padEnd(ENERGY_DECIMALS, '0');
  const subunits = BigInt(whole) * ENERGY_SCALE + BigInt(paddedFraction);
  return negative ? -subunits : subunits;
}

/**
 * Format exact integer subunits as a canonical decimal string with exactly
 * ENERGY_DECIMALS fractional digits. This is the value to persist and to
 * serialize over the API.
 */
export function fromSubunits(subunits: bigint): string {
  const negative = subunits < 0n;
  const abs = negative ? -subunits : subunits;
  const whole = abs / ENERGY_SCALE;
  const fraction = (abs % ENERGY_SCALE).toString().padStart(ENERGY_DECIMALS, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${fraction}`;
}

/** Normalize any accepted decimal string to the canonical persisted form. */
export function normalizeEnergyAmount(value: string): string {
  return fromSubunits(toSubunits(value));
}

/**
 * Convert a legacy floating point amount to exact subunits, reporting whether
 * the conversion required rounding. Used by the backfill to surface drift
 * before records are modified.
 */
export function fromLegacyNumber(value: number): {
  subunits: bigint;
  rounded: boolean;
  overflow: boolean;
} {
  if (!Number.isFinite(value)) {
    throw new EnergyAmountError(`Non-finite legacy energy amount: ${value}`);
  }

  // Use the shortest round-trip decimal representation of the double, then
  // scale exactly. This avoids multiplying the double itself.
  const exact = toSubunits(value.toString());
  const overflow = exact > ENERGY_MAX_SUBUNITS || exact < -ENERGY_MAX_SUBUNITS;
  const rounded = fromSubunits(exact) !== value.toString();
  return { subunits: exact, rounded, overflow };
}

/**
 * Migration / rollout notes (issue #40):
 *
 * 1. Add `energy_amount NUMERIC(38, 7)` alongside the legacy float column.
 * 2. Run the backfill in report-only mode first: for each legacy row call
 *    `fromLegacyNumber` and aggregate `rounded` / `overflow` counts. Do not
 *    write until the report is reviewed.
 * 3. Backfill `energy_amount = fromSubunits(subunits)` for rows without
 *    overflow; quarantine overflow rows for manual review.
 * 4. Switch reads/writes to the numeric column, then drop the legacy column.
 * 5. API responses must serialize `energy_amount` as the canonical string
 *    returned by `fromSubunits`; never pass it through `Number()`.
 */

/**
 * Energy amount representation.
 *
 * Energy amounts are stored and transported as exact decimal strings, never as
 * JavaScript `number` (binary floating point), to avoid rounding drift when
 * converting to Soroban integer subunits.
 *
 * Canonical scale: contract decimals = 7 (Stellar/Soroban stroop-style scale).
 * Database representation: NUMERIC(38, 7) — exact, fixed scale, no drift.
 */

/** Canonical number of decimal places shared with contract decimals. */
export const ENERGY_DECIMALS = 7 as const;

/** Canonical conversion scale: 1 energy unit = 10^7 contract subunits. */
export const ENERGY_SCALE = 10n ** BigInt(ENERGY_DECIMALS);

/** Maximum integer digits supported by NUMERIC(38, 7). */
export const ENERGY_MAX_INTEGER_DIGITS = 38 - ENERGY_DECIMALS;

/** Exact decimal string, e.g. "123.4567890". Never a JS number. */
export type EnergyAmount = string;

/** Exact integer subunit string, e.g. "1234567890". Never a JS number. */
export type EnergySubunits = string;

const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

export interface EnergyConversionResult {
  ok: boolean;
  value?: EnergySubunits;
  error?: string;
}

/**
 * Parse an exact decimal string into integer subunits at ENERGY_DECIMALS.
 * Rejects lossy inputs (numbers, exponent notation, excess precision).
 */
export function energyToSubunits(amount: EnergyAmount): EnergyConversionResult {
  if (typeof amount !== 'string') {
    return { ok: false, error: 'energy amount must be a decimal string' };
  }
  const trimmed = amount.trim();
  if (!DECIMAL_PATTERN.test(trimmed)) {
    return { ok: false, error: `invalid decimal amount: ${amount}` };
  }

  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [intPart, fracPart = ''] = unsigned.split('.');

  if (fracPart.length > ENERGY_DECIMALS) {
    return {
      ok: false,
      error: `amount has more than ${ENERGY_DECIMALS} decimal places: ${amount}`,
    };
  }

  const paddedFrac = fracPart.padEnd(ENERGY_DECIMALS, '0');
  const digits = `${intPart}${paddedFrac}`.replace(/^0+(?=\d)/, '');
  const subunits = BigInt(digits);

  if (intPart.replace(/^0+/, '').length > ENERGY_MAX_INTEGER_DIGITS) {
    return { ok: false, error: `amount overflows NUMERIC(38, ${ENERGY_DECIMALS}): ${amount}` };
  }

  return { ok: true, value: (negative ? -subunits : subunits).toString() };
}

/**
 * Format integer subunits back into an exact decimal string at ENERGY_DECIMALS.
 * Round-trips with energyToSubunits without loss.
 */
export function subunitsToEnergy(subunits: EnergySubunits): EnergyConversionResult {
  if (typeof subunits !== 'string' || !/^-?\d+$/.test(subunits)) {
    return { ok: false, error: `invalid subunit amount: ${String(subunits)}` };
  }

  const negative = subunits.startsWith('-');
  const digits = (negative ? subunits.slice(1) : subunits).padStart(ENERGY_DECIMALS + 1, '0');
  const intPart = digits.slice(0, digits.length - ENERGY_DECIMALS);
  const fracPart = digits.slice(digits.length - ENERGY_DECIMALS);

  return { ok: true, value: `${negative ? '-' : ''}${intPart}.${fracPart}` };
}

/**
 * Normalize a decimal string to the canonical NUMERIC(38, 7) form.
 * Used by API serialization so responses are explicit and lossless.
 */
export function normalizeEnergyAmount(amount: EnergyAmount): EnergyConversionResult {
  const subunits = energyToSubunits(amount);
  if (!subunits.ok) return subunits;
  return subunitsToEnergy(subunits.value as EnergySubunits);
}

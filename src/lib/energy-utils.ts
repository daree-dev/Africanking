/**
 * Shared energy amount utilities.
 *
 * Energy amounts are stored as exact decimals (Postgres NUMERIC(38, 7)) and
 * converted to Soroban integer subunits using a canonical scale that matches
 * the contract decimals. JavaScript `number` is never used for amounts: all
 * arithmetic is done on `bigint` subunits or on decimal strings.
 */

/** Canonical scale shared with the Soroban contract decimals. */
export const ENERGY_DECIMALS = 7;

/** 10^ENERGY_DECIMALS as a bigint, used for subunit conversion. */
export const ENERGY_SCALE = 10n ** BigInt(ENERGY_DECIMALS);

/** Maximum integer digits supported by NUMERIC(38, 7). */
export const ENERGY_MAX_INTEGER_DIGITS = 38 - ENERGY_DECIMALS;

/** Largest representable amount in subunits (NUMERIC(38, 7) upper bound). */
export const ENERGY_MAX_SUBUNITS = 10n ** 38n - 1n;

const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

export type EnergyParseResult =
  | { ok: true; subunits: bigint }
  | { ok: false; reason: 'invalid' | 'precision' | 'overflow' };

/**
 * Parse a decimal energy amount string into exact integer subunits.
 * Rejects values with more fractional digits than ENERGY_DECIMALS instead of
 * silently rounding, so callers can surface the risk explicitly.
 */
export function parseEnergyAmount(value: string): EnergyParseResult {
  const trimmed = value.trim();
  if (!DECIMAL_PATTERN.test(trimmed)) {
    return { ok: false, reason: 'invalid' };
  }

  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole, fraction = ''] = unsigned.split('.');

  if (fraction.length > ENERGY_DECIMALS) {
    return { ok: false, reason: 'precision' };
  }

  const paddedFraction = fraction.padEnd(ENERGY_DECIMALS, '0');
  const digits = `${whole}${paddedFraction}`.replace(/^0+(?=\d)/, '');
  const subunits = BigInt(digits || '0');

  if (subunits > ENERGY_MAX_SUBUNITS) {
    return { ok: false, reason: 'overflow' };
  }

  return { ok: true, subunits: negative ? -subunits : subunits };
}

/**
 * Format exact integer subunits back into a canonical decimal string.
 * The result is always safe to persist into NUMERIC(38, 7) and to serialize
 * over the API without lossy number conversion.
 */
export function formatEnergyAmount(subunits: bigint): string {
  const negative = subunits < 0n;
  const abs = negative ? -subunits : subunits;
  const whole = abs / ENERGY_SCALE;
  const fraction = (abs % ENERGY_SCALE).toString().padStart(ENERGY_DECIMALS, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${fraction}`;
}

/**
 * Convert a decimal energy amount string to contract subunits.
 * Returns null when the value cannot be represented exactly.
 */
export function toContractSubunits(value: string): bigint | null {
  const parsed = parseEnergyAmount(value);
  return parsed.ok ? parsed.subunits : null;
}

/**
 * Convert contract subunits to a canonical decimal string for persistence
 * and API serialization.
 */
export function fromContractSubunits(subunits: bigint): string {
  return formatEnergyAmount(subunits);
}

export type EnergyRiskReport = {
  total: number;
  invalid: number;
  precision: number;
  overflow: number;
  samples: { value: string; reason: 'invalid' | 'precision' | 'overflow' }[];
};

/**
 * Report rounding and overflow risk for a batch of legacy amounts before a
 * backfill modifies any records. Does not mutate input.
 */
export function assessEnergyBackfillRisk(values: readonly string[]): EnergyRiskReport {
  const report: EnergyRiskReport = {
    total: values.length,
    invalid: 0,
    precision: 0,
    overflow: 0,
    samples: [],
  };

  for (const value of values) {
    const parsed = parseEnergyAmount(value);
    if (parsed.ok) continue;

    report[parsed.reason] += 1;
    if (report.samples.length < 20) {
      report.samples.push({ value, reason: parsed.reason });
    }
  }

  return report;
}

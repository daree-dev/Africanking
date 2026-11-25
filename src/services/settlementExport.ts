/**
 * Settlement export service.
 *
 * Defines a stable, versioned boundary for exporting cooperative settlement
 * data into existing cooperative billing systems. Energy quantities are kept
 * strictly separate from local-currency amounts and tax treatment; on-chain
 * tokens are never treated as currency or invoices.
 */

export const SETTLEMENT_EXPORT_SCHEMA_VERSION = "1.0.0" as const;

export type SettlementExportSchemaVersion =
  typeof SETTLEMENT_EXPORT_SCHEMA_VERSION;

export interface ExportPeriod {
  /** Inclusive start of the settlement period (ISO 8601, UTC). */
  start: string;
  /** Exclusive end of the settlement period (ISO 8601, UTC). */
  end: string;
  /** IANA timezone the period was defined in, e.g. "Europe/Berlin". */
  timezone: string;
}

export interface EnergyQuantity {
  /** Numeric quantity in the given unit. */
  value: number;
  /** Unit of energy, e.g. "kWh". */
  unit: "kWh" | "MWh";
}

export interface MemberAllocation {
  memberId: string;
  /** Energy allocated to the member for the period. */
  energy: EnergyQuantity;
}

export interface Adjustment {
  /** Stable identifier for the adjustment (e.g. correction reference). */
  id: string;
  /** Human-readable reason for the adjustment. */
  reason: string;
  /** Energy delta; may be negative for corrections. */
  energy: EnergyQuantity;
}

export interface LocalCurrencyAmount {
  /** Amount in minor units of the currency (e.g. cents). */
  amountMinor: number;
  /** ISO 4217 currency code, e.g. "EUR". */
  currency: string;
}

export interface TaxTreatment {
  /** Tax regime identifier, e.g. "standard", "exempt". */
  regime: string;
  /** Tax rate as a fraction (0.19 = 19%). */
  rate: number;
  /** Tax amount in minor units of the currency. */
  amountMinor: number;
}

export interface BillingAmounts {
  /** Net amount before tax, in local currency. */
  net: LocalCurrencyAmount;
  /** Tax treatment applied to the net amount. */
  tax: TaxTreatment;
  /** Gross amount including tax, in local currency. */
  gross: LocalCurrencyAmount;
}

export interface Provenance {
  /** Source system that produced the underlying data. */
  source: string;
  /** Identifier of the source record (e.g. meter reading batch). */
  sourceId: string;
  /** When the source data was captured (ISO 8601, UTC). */
  capturedAt: string;
  /** Optional reference to the generating process/version. */
  generator?: string;
}

export interface SettlementExportRecord {
  memberId: string;
  energy: EnergyQuantity;
  adjustments: Adjustment[];
  amounts: BillingAmounts;
}

export interface SettlementExport {
  schemaVersion: SettlementExportSchemaVersion;
  /** Deterministic, idempotent identity for this export. */
  exportId: string;
  period: ExportPeriod;
  provenance: Provenance;
  records: SettlementExportRecord[];
}

export interface SettlementExportInput {
  period: ExportPeriod;
  provenance: Provenance;
  records: SettlementExportRecord[];
}

export interface DryRunResult {
  /** The payload that would be written to the external system. */
  payload: SettlementExport;
  /** True when an export with the same identity already exists. */
  duplicate: boolean;
}

/**
 * Minimal sink abstraction for an external cooperative billing system.
 * Implementations must treat `exportId` as an idempotency key.
 */
export interface BillingExportSink {
  hasExport(exportId: string): Promise<boolean>;
  write(payload: SettlementExport): Promise<void>;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

/**
 * Compute a deterministic export identity from the semantic content of the
 * export. Identical inputs always yield the same id, so duplicate exports can
 * be detected before writing to an external system.
 */
export function computeExportId(input: SettlementExportInput): string {
  const canonical = stableStringify({
    schemaVersion: SETTLEMENT_EXPORT_SCHEMA_VERSION,
    period: input.period,
    provenance: input.provenance,
    records: input.records,
  });
  return `settlement-export:${fnv1aHex(canonical)}`;
}

function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Build the versioned export payload without writing anywhere. Used for
 * dry-run previews and as the basis for idempotent writes.
 */
export function buildSettlementExport(
  input: SettlementExportInput,
): SettlementExport {
  return {
    schemaVersion: SETTLEMENT_EXPORT_SCHEMA_VERSION,
    exportId: computeExportId(input),
    period: input.period,
    provenance: input.provenance,
    records: input.records,
  };
}

/**
 * Produce a dry-run preview: the payload plus whether an export with the same
 * identity already exists in the target system. Never writes.
 */
export async function previewSettlementExport(
  input: SettlementExportInput,
  sink: BillingExportSink,
): Promise<DryRunResult> {
  const payload = buildSettlementExport(input);
  const duplicate = await sink.hasExport(payload.exportId);
  return { payload, duplicate };
}

/**
 * Idempotently export settlement data. If an export with the same identity
 * already exists, it is not written again.
 */
export async function exportSettlement(
  input: SettlementExportInput,
  sink: BillingExportSink,
): Promise<{ payload: SettlementExport; written: boolean }> {
  const payload = buildSettlementExport(input);
  if (await sink.hasExport(payload.exportId)) {
    return { payload, written: false };
  }
  await sink.write(payload);
  return { payload, written: true };
}

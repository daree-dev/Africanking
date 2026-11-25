/**
 * Versioned boundary for cooperative billing exports.
 *
 * Settlement data may flow into existing cooperative billing systems without
 * treating on-chain tokens as currency or invoices. Energy quantities are kept
 * strictly separate from local-currency amounts and tax treatment.
 *
 * Bump `SETTLEMENT_EXPORT_SCHEMA_VERSION` on any breaking change and document
 * the migration/rollout requirement alongside the change.
 */

export const SETTLEMENT_EXPORT_SCHEMA_VERSION = "1.0.0" as const;

export type SettlementExportSchemaVersion =
  typeof SETTLEMENT_EXPORT_SCHEMA_VERSION;

/** Energy is always expressed in explicit units, never as currency. */
export type EnergyUnit = "kWh" | "MWh";

export interface EnergyQuantity {
  /** Numeric quantity in `unit`. */
  value: number;
  unit: EnergyUnit;
}

/** Local-currency amounts are kept apart from energy quantities. */
export interface CurrencyAmount {
  /** ISO 4217 code, e.g. "EUR". */
  currency: string;
  /** Minor-unit-safe decimal amount. */
  amount: number;
}

export type TaxTreatment =
  | { kind: "none" }
  | { kind: "exempt"; reason?: string }
  | { kind: "standard"; rate: number; note?: string };

/** Reporting period, expressed in an explicit IANA timezone. */
export interface SettlementPeriod {
  /** Inclusive start, ISO 8601 timestamp. */
  start: string;
  /** Exclusive end, ISO 8601 timestamp. */
  end: string;
  /** IANA timezone the period boundaries are interpreted in, e.g. "Europe/Berlin". */
  timezone: string;
}

export interface SettlementMember {
  /** Stable cooperative member identifier. */
  memberId: string;
  displayName?: string;
}

export interface EnergyAllocation {
  memberId: string;
  /** Assigned generation credits for the period. */
  allocated: EnergyQuantity;
  /** Optional meter/source reference for provenance. */
  meterId?: string;
}

export type AdjustmentKind = "correction" | "credit" | "debit";

export interface SettlementAdjustment {
  /** Stable identifier so corrections are traceable and idempotent. */
  adjustmentId: string;
  kind: AdjustmentKind;
  memberId: string;
  /** Energy delta; may be negative for corrections. */
  energy?: EnergyQuantity;
  /** Monetary delta, kept separate from energy. */
  amount?: CurrencyAmount;
  /** Human-readable reason for the adjustment. */
  reason?: string;
}

export interface SettlementProvenance {
  /** Identifier of the system that produced the export. */
  source: string;
  /** ISO 8601 timestamp the export was generated. */
  generatedAt: string;
  /** Optional upstream references (e.g. meter import batch ids). */
  references?: string[];
}

export interface SettlementExport {
  schemaVersion: SettlementExportSchemaVersion;
  /** Deterministic, idempotent identity for this export. */
  exportId: string;
  period: SettlementPeriod;
  members: SettlementMember[];
  allocations: EnergyAllocation[];
  adjustments: SettlementAdjustment[];
  /** Monetary totals, separate from energy quantities. */
  amounts?: CurrencyAmount[];
  taxTreatment: TaxTreatment;
  provenance: SettlementProvenance;
}

/**
 * Result of a dry-run preview: the payload that *would* be written, without
 * touching any external system.
 */
export interface SettlementExportPreview {
  exportId: string;
  payload: SettlementExport;
  /** True when an export with this identity was already written. */
  duplicate: boolean;
}

/**
 * Compute a deterministic, idempotent export identity from the stable inputs
 * that define an export. The same period + members + allocations + adjustments
 * always yields the same id, so duplicate exports are detected and not
 * re-written.
 */
export function computeSettlementExportId(input: {
  period: SettlementPeriod;
  members: SettlementMember[];
  allocations: EnergyAllocation[];
  adjustments: SettlementAdjustment[];
}): string {
  const canonical = JSON.stringify({
    schemaVersion: SETTLEMENT_EXPORT_SCHEMA_VERSION,
    period: {
      start: input.period.start,
      end: input.period.end,
      timezone: input.period.timezone,
    },
    members: [...input.members]
      .map((m) => m.memberId)
      .sort(),
    allocations: [...input.allocations]
      .map((a) => ({
        memberId: a.memberId,
        value: a.allocated.value,
        unit: a.allocated.unit,
        meterId: a.meterId ?? null,
      }))
      .sort((a, b) => a.memberId.localeCompare(b.memberId)),
    adjustments: [...input.adjustments]
      .map((adj) => ({
        adjustmentId: adj.adjustmentId,
        kind: adj.kind,
        memberId: adj.memberId,
        energy: adj.energy ?? null,
        amount: adj.amount ?? null,
      }))
      .sort((a, b) => a.adjustmentId.localeCompare(b.adjustmentId)),
  });

  return `settlement-export:${hashString(canonical)}`;
}

/** Small deterministic FNV-1a hash; stable across runtimes. */
function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

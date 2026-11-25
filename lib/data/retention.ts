/**
 * Data lifecycle: retention classes and archival policy for meter telemetry.
 *
 * Product direction: generation credits are assigned to cooperative members.
 * This module does not model an external certificate marketplace and makes no
 * I-REC/ESG certification claims. It only governs how long operational data is
 * kept and how it is archived without breaking auditability.
 */

export type RetentionClassId =
  | "raw_source_payload"
  | "normalized_reading"
  | "aggregate_record";

export interface RetentionClass {
  id: RetentionClassId;
  label: string;
  /** Days of hot retention before a record becomes eligible for archival. */
  hotRetentionDays: number;
  /** Whether the record may be archived (moved) rather than deleted. */
  archivable: boolean;
  /** Whether the record is an immutable audit reference and must never be deleted. */
  immutable: boolean;
  description: string;
}

export const RETENTION_CLASSES: Record<RetentionClassId, RetentionClass> = {
  raw_source_payload: {
    id: "raw_source_payload",
    label: "Raw source payloads",
    hotRetentionDays: 90,
    archivable: true,
    immutable: false,
    description:
      "Verbatim meter/inverter payloads as received. Archived after the hot window; kept in cold storage for reproducibility.",
  },
  normalized_reading: {
    id: "normalized_reading",
    label: "Normalized readings",
    hotRetentionDays: 365,
    archivable: true,
    immutable: false,
    description:
      "Parsed, unit-normalized readings used by dashboards. Archived after the hot window; aggregates remain queryable.",
  },
  aggregate_record: {
    id: "aggregate_record",
    label: "Aggregate records",
    hotRetentionDays: 0,
    archivable: false,
    immutable: true,
    description:
      "Per-cooperative generation aggregates referenced by issued allocations. Never archived or deleted.",
  },
};

/**
 * Immutable references that must remain resolvable after archival so that
 * issued allocations can be reproduced. Archival must never drop these.
 */
export const IMMUTABLE_REFERENCES = [
  "allocation_id",
  "cooperative_id",
  "aggregate_record_id",
  "reading_id",
  "source_payload_hash",
] as const;

export type ImmutableReference = (typeof IMMUTABLE_REFERENCES)[number];

export interface ArchivableRecord {
  id: string;
  cooperativeId: string;
  retentionClass: RetentionClassId;
  /** ISO timestamp of when the record was captured. */
  capturedAt: string;
  /** References this record must keep resolvable for audit. */
  references: ImmutableReference[];
}

export interface CooperativeArchiveCount {
  cooperativeId: string;
  counts: Record<RetentionClassId, number>;
  total: number;
}

export interface ArchivePlan {
  dryRun: boolean;
  /** ISO timestamp the plan was computed at. */
  computedAt: string;
  perCooperative: CooperativeArchiveCount[];
  /** Records skipped because they are immutable or not yet eligible. */
  skippedImmutable: number;
  skippedNotEligible: number;
  /** Human-readable restore guidance for operators. */
  restoreGuidance: string[];
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function emptyCounts(): Record<RetentionClassId, number> {
  return { raw_source_payload: 0, normalized_reading: 0, aggregate_record: 0 };
}

function isEligible(record: ArchivableRecord, now: number): boolean {
  const cls = RETENTION_CLASSES[record.retentionClass];
  if (!cls.archivable || cls.immutable) return false;
  const captured = Date.parse(record.capturedAt);
  if (Number.isNaN(captured)) return false;
  return now - captured >= cls.hotRetentionDays * MS_PER_DAY;
}

/**
 * Build an archive plan. Always safe to run: with `dryRun: true` it only
 * reports per-cooperative counts and never mutates input.
 */
export function planArchive(
  records: readonly ArchivableRecord[],
  options: { now?: Date; dryRun?: boolean } = {},
): ArchivePlan {
  const now = (options.now ?? new Date()).getTime();
  const dryRun = options.dryRun ?? true;
  const byCoop = new Map<string, CooperativeArchiveCount>();
  let skippedImmutable = 0;
  let skippedNotEligible = 0;

  for (const record of records) {
    const cls = RETENTION_CLASSES[record.retentionClass];
    if (cls.immutable || !cls.archivable) {
      skippedImmutable += 1;
      continue;
    }
    if (!isEligible(record, now)) {
      skippedNotEligible += 1;
      continue;
    }
    let entry = byCoop.get(record.cooperativeId);
    if (!entry) {
      entry = {
        cooperativeId: record.cooperativeId,
        counts: emptyCounts(),
        total: 0,
      };
      byCoop.set(record.cooperativeId, entry);
    }
    entry.counts[record.retentionClass] += 1;
    entry.total += 1;
  }

  const perCooperative = Array.from(byCoop.values()).sort((a, b) =>
    a.cooperativeId.localeCompare(b.cooperativeId),
  );

  return {
    dryRun,
    computedAt: new Date(now).toISOString(),
    perCooperative,
    skippedImmutable,
    skippedNotEligible,
    restoreGuidance: buildRestoreGuidance(),
  };
}

/**
 * Operator-facing restore guidance. Archived records are moved, not deleted,
 * so they can be restored by id while keeping audit references resolvable.
 */
export function buildRestoreGuidance(): string[] {
  return [
    "Archived records are moved to cold storage, never deleted.",
    "Restore by record id; immutable references (" +
      IMMUTABLE_REFERENCES.join(", ") +
      ") must remain resolvable after restore.",
    "Aggregate records are immutable and are never archived; issued allocations stay reproducible.",
    "Run the archive job with dryRun=true first and review per-cooperative counts before applying.",
  ];
}

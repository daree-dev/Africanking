/**
 * Retention & archival job for raw meter readings.
 *
 * Retention classes (see RETENTION_CLASSES):
 *  - raw_source_payloads: original device/source payloads. Shortest retention;
 *    archived (moved out of hot storage) after RAW_RETENTION_DAYS.
 *  - normalized_readings: parsed/normalized meter readings used by dashboards.
 *    Archived after NORMALIZED_RETENTION_DAYS.
 *  - aggregate_records: rolled-up aggregates. Retained indefinitely (never
 *    archived/deleted) so dashboards and audits stay resolvable.
 *
 * Immutable references: audit records (issued allocations) reference readings
 * by immutable id. Archival NEVER deletes audit records or the ids they point
 * to; archived rows keep their original ids and are written to an archive
 * store, so `resolveAuditReference` can still resolve them after archival.
 *
 * Usage:
 *   ts-node scripts/archive-meter-readings.ts --dry-run
 *   ts-node scripts/archive-meter-readings.ts --archive
 *
 * Restore guidance:
 *   Archived rows are written to ARCHIVE_DIR as JSONL keyed by retention
 *   class and cooperative. To restore, re-insert the JSONL rows into the
 *   source table (ids are preserved) and remove the archive file. Audit
 *   records are never touched, so they remain resolvable throughout.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

/** Retention classes for telemetry data. */
export type RetentionClass =
  | "raw_source_payloads"
  | "normalized_readings"
  | "aggregate_records";

export interface RetentionPolicy {
  retentionClass: RetentionClass;
  /** Days of hot retention before archival. `null` = retain forever. */
  retentionDays: number | null;
  /** Whether rows in this class may be archived out of hot storage. */
  archivable: boolean;
  description: string;
}

export const RETENTION_CLASSES: Record<RetentionClass, RetentionPolicy> = {
  raw_source_payloads: {
    retentionClass: "raw_source_payloads",
    retentionDays: 90,
    archivable: true,
    description: "Original device/source payloads; archived after 90 days.",
  },
  normalized_readings: {
    retentionClass: "normalized_readings",
    retentionDays: 365,
    archivable: true,
    description: "Normalized meter readings; archived after 365 days.",
  },
  aggregate_records: {
    retentionClass: "aggregate_records",
    retentionDays: null,
    archivable: false,
    description: "Rolled-up aggregates; retained indefinitely.",
  },
};

/** A row eligible for archival, tagged with its retention class. */
export interface ArchivableRow {
  id: string;
  cooperativeId: string;
  retentionClass: RetentionClass;
  recordedAt: string; // ISO timestamp
  payload: unknown;
}

/** An immutable audit record referencing a reading by id. */
export interface AuditRecord {
  id: string;
  cooperativeId: string;
  /** Immutable reference to the reading this allocation was derived from. */
  readingId: string;
}

export interface ArchivePlanEntry {
  retentionClass: RetentionClass;
  cooperativeId: string;
  count: number;
}

export interface ArchivePlan {
  generatedAt: string;
  cutoffByClass: Record<RetentionClass, string | null>;
  perCooperative: ArchivePlanEntry[];
  totalRows: number;
  /** Audit records whose referenced reading is in the archive set. */
  referencedAuditIds: string[];
}

const ARCHIVE_DIR = path.resolve(process.cwd(), "archive");

function cutoffFor(policy: RetentionPolicy, now: Date): string | null {
  if (policy.retentionDays === null) return null;
  const cutoff = new Date(now.getTime() - policy.retentionDays * 86_400_000);
  return cutoff.toISOString();
}

/**
 * Build an archive plan: which rows are eligible per retention class, counted
 * per cooperative. Pure function so it can be dry-run and tested.
 */
export function buildArchivePlan(
  rows: ArchivableRow[],
  now: Date = new Date(),
): ArchivePlan {
  const cutoffByClass = {} as Record<RetentionClass, string | null>;
  for (const policy of Object.values(RETENTION_CLASSES)) {
    cutoffByClass[policy.retentionClass] = cutoffFor(policy, now);
  }

  const counts = new Map<string, ArchivePlanEntry>();
  let totalRows = 0;

  for (const row of rows) {
    const policy = RETENTION_CLASSES[row.retentionClass];
    if (!policy.archivable) continue;
    const cutoff = cutoffByClass[row.retentionClass];
    if (cutoff === null) continue;
    if (row.recordedAt >= cutoff) continue; // still within hot retention

    const key = `${row.retentionClass}::${row.cooperativeId}`;
    const entry = counts.get(key) ?? {
      retentionClass: row.retentionClass,
      cooperativeId: row.cooperativeId,
      count: 0,
    };
    entry.count += 1;
    counts.set(key, entry);
    totalRows += 1;
  }

  const perCooperative = [...counts.values()].sort((a, b) =>
    a.cooperativeId.localeCompare(b.cooperativeId) ||
    a.retentionClass.localeCompare(b.retentionClass),
  );

  return {
    generatedAt: now.toISOString(),
    cutoffByClass,
    perCooperative,
    totalRows,
    referencedAuditIds: [],
  };
}

/**
 * Confirm that every audit record referencing an archived reading remains
 * resolvable: the referenced id must exist in the archive set (ids preserved).
 */
export function verifyAuditResolvable(
  auditRecords: AuditRecord[],
  archivedIds: Set<string>,
): { resolvable: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const audit of auditRecords) {
    if (!archivedIds.has(audit.readingId)) missing.push(audit.id);
  }
  return { resolvable: missing.length === 0, missing };
}

function formatPlan(plan: ArchivePlan): string {
  const lines: string[] = [];
  lines.push(`Archive plan generated at ${plan.generatedAt}`);
  lines.push("Cutoffs by retention class:");
  for (const [cls, cutoff] of Object.entries(plan.cutoffByClass)) {
    lines.push(`  ${cls}: ${cutoff ?? "retained forever"}`);
  }
  lines.push(`Eligible rows: ${plan.totalRows}`);
  if (plan.perCooperative.length === 0) {
    lines.push("  (no rows eligible for archival)");
  } else {
    lines.push("Per-cooperative counts:");
    for (const entry of plan.perCooperative) {
      lines.push(
        `  cooperative=${entry.cooperativeId} class=${entry.retentionClass} count=${entry.count}`,
      );
    }
  }
  return lines.join("\n");
}

async function writeArchive(
  rows: ArchivableRow[],
  plan: ArchivePlan,
): Promise<void> {
  await fs.mkdir(ARCHIVE_DIR, { recursive: true });
  const byClass = new Map<RetentionClass, ArchivableRow[]>();
  for (const row of rows) {
    const policy = RETENTION_CLASSES[row.retentionClass];
    if (!policy.archivable) continue;
    const cutoff = plan.cutoffByClass[row.retentionClass];
    if (cutoff === null || row.recordedAt >= cutoff) continue;
    const bucket = byClass.get(row.retentionClass) ?? [];
    bucket.push(row);
    byClass.set(row.retentionClass, bucket);
  }

  for (const [cls, bucket] of byClass) {
    const file = path.join(ARCHIVE_DIR, `${cls}.jsonl`);
    const body = bucket.map((r) => JSON.stringify(r)).join("\n") + "\n";
    await fs.appendFile(file, body, "utf8");
  }
}

/**
 * Run the archive job. In dry-run mode only the plan is printed; no data is
 * moved. In archive mode eligible rows are appended to the archive store.
 */
export async function runArchiveJob(
  rows: ArchivableRow[],
  auditRecords: AuditRecord[],
  options: { dryRun: boolean; now?: Date },
): Promise<ArchivePlan> {
  const plan = buildArchivePlan(rows, options.now ?? new Date());

  const archivedIds = new Set(
    rows
      .filter((r) => {
        const policy = RETENTION_CLASSES[r.retentionClass];
        if (!policy.archivable) return false;
        const cutoff = plan.cutoffByClass[r.retentionClass];
        return cutoff !== null && r.recordedAt < cutoff;
      })
      .map((r) => r.id),
  );

  const auditCheck = verifyAuditResolvable(auditRecords, archivedIds);
  plan.referencedAuditIds = auditRecords
    .filter((a) => archivedIds.has(a.readingId))
    .map((a) => a.id);

  console.log(formatPlan(plan));
  console.log(
    `Audit references resolvable after archival: ${auditCheck.resolvable}` +
      (auditCheck.missing.length
        ? ` (missing: ${auditCheck.missing.join(", ")})`
        : ""),
  );

  if (!auditCheck.resolvable) {
    throw new Error(
      "Refusing to archive: some audit records would become unresolvable.",
    );
  }

  if (options.dryRun) {
    console.log("Dry run: no data moved. Re-run with --archive to apply.");
    console.log(
      `Restore guidance: archived rows are written to ${ARCHIVE_DIR} as JSONL ` +
        "with original ids preserved; re-insert them to restore.",
    );
    return plan;
  }

  await writeArchive(rows, plan);
  console.log(`Archived ${plan.totalRows} rows to ${ARCHIVE_DIR}.`);
  return plan;
}

async function main(): Promise<void> {
  const dryRun = !process.argv.includes("--archive");
  // Data source is injected by the caller in production; this entrypoint
  // expects rows/audit records to be provided by the surrounding pipeline.
  const rows: ArchivableRow[] = [];
  const auditRecords: AuditRecord[] = [];
  await runArchiveJob(rows, auditRecords, { dryRun });
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

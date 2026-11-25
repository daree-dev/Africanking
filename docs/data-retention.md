# Data Retention & Archival Policy — Raw Meter Readings

This document defines how long-lived, high-frequency telemetry is retained and
archived. It keeps the cooperative-management product direction: generation
credits are assigned to cooperative members. This is **not** an external
certificate marketplace and makes **no** I-REC/ESG certification claims.

## Retention classes

| Class | What it holds | Default retention | Notes |
|-------|---------------|-------------------|-------|
| `raw_source` | Raw source payloads exactly as received from meters/gateways (bytes/JSON, checksums) | 90 days hot, then archived | Needed to reproduce parsing and to audit source integrity. |
| `normalized_reading` | Parsed, unit-normalized readings (kWh, timestamps, meter id) | 24 months hot, then archived | Primary input for allocation computation. |
| `aggregate` | Per-cooperative / per-period aggregates and issued allocation records | Indefinite (hot) | Small, query-critical, and referenced by audit records. |

Retention windows are defaults; a cooperative may extend them. Shortening below
the audit floor is rejected by the archive job.

## Immutable references for issued allocations

Every issued allocation record must remain resolvable after archival. To
preserve reproducibility:

- Each allocation stores immutable references to the `normalized_reading` rows
  and the `raw_source` payload checksums it was derived from.
- Archived rows are moved to cold storage but keep their original IDs and
  checksums; references are never rewritten or deleted.
- Aggregates and allocation records are never archived away from hot storage.
- Restore must bring back rows with identical IDs so existing references keep
  resolving.

## Archive job (dry-run first)

An archive job moves rows past their retention window from hot to cold storage.
It always supports a dry-run mode that reports, **per cooperative**, how many
rows of each class would be archived, without mutating data.

Dry-run output (per cooperative):

```
cooperative: <id/name>
  raw_source:          <n> rows eligible
  normalized_reading:  <n> rows eligible
  aggregate:           0 rows (never archived)
  referenced_by_allocations: <n> rows (must stay resolvable)
```

Runbook:

1. Run the job in dry-run mode and review per-cooperative counts.
2. Confirm every row referenced by an issued allocation is accounted for and
   will remain resolvable after archival.
3. Run the archive for real; verify checksums and IDs are preserved.
4. Spot-check that audit records still resolve to their source rows.

## Restore guidance

- Restore by original ID and checksum; never re-key archived rows.
- After restore, re-run the dry-run to confirm counts return to expected values.
- If an audit record fails to resolve, halt and restore the referenced
  `raw_source` / `normalized_reading` rows before proceeding.

## Rollout / migration

- No destructive migration: existing rows are classified in place by age.
- Backfill immutable references on existing allocation records before the first
  real archive run.
- Roll out dry-run only for one cycle, review counts with each cooperative, then
  enable real archival.

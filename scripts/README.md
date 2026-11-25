# Data lifecycle & operations scripts

This directory documents the data lifecycle policy for the cooperative energy
tracking product and the operational scripts that enforce it. Generation
credits are assigned to cooperative members; this is **not** an external
certificate marketplace and makes **no** I-REC/ESG certification claims.

## Retention classes

| Class | Examples | Retention | Notes |
| --- | --- | --- | --- |
| `raw_source` | Original meter payloads as received (JSON/CSV blobs) | 90 days hot, then archived | Kept for replay/debugging; not needed for dashboards. |
| `normalized_reading` | Parsed, unit-normalized meter readings | 24 months hot, then archived | Backs common dashboard queries. |
| `aggregate` | Per-cooperative/per-period rollups used for allocations | Indefinite | Small; required to reproduce issued allocations. |
| `audit_reference` | Immutable pointers (reading id, payload hash, allocation id) | Indefinite | Never deleted; keeps issued allocations resolvable after archival. |

Archival moves rows out of the hot tables into archive storage but **never**
deletes `audit_reference` records. Every archived reading keeps its immutable
reference (id + payload hash) so an issued allocation can still be reproduced.

## Archive job (dry-run first)

Always run the dry-run before archiving. It reports per-cooperative counts and
prints restore guidance without mutating data.

```sh
# Dry-run: per-cooperative counts, no writes
node scripts/archive-readings.mjs --class raw_source --dry-run
node scripts/archive-readings.mjs --class normalized_reading --dry-run

# Apply after reviewing the dry-run output
node scripts/archive-readings.mjs --class raw_source --apply
```

The dry-run output lists, per cooperative: rows eligible for archival, rows
retained, and the count of audit references that will remain resolvable.

## Restore guidance

Archived rows are keyed by their immutable reference. To restore a reading for
audit or replay:

1. Look up the `audit_reference` by reading id or allocation id.
2. Restore the archived row from archive storage using that reference.
3. Confirm the referenced audit record resolves before closing the request.

## Rollout / migration

- No schema migration is required to adopt the policy; archival is opt-in per class.
- Run dry-runs on generated data first and confirm referenced audit records remain resolvable.
- Existing data is preserved: archival is additive and reversible via restore.

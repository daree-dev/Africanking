# Disaster Recovery: Backup, Restore, and Rehearsal

This document defines the recovery process for the cooperative-management platform.
Generation credits are assigned to cooperative members; this is **not** an external
certificate marketplace and makes **no** claim of I-REC/ESG certification. Recovery
restores relational data and operational configuration only.

## 1. RPO / RTO targets

| Asset | RPO | RTO | Notes |
| --- | --- | --- | --- |
| Primary database (Supabase Postgres) | 15 min (PITR) | 2 h | Point-in-time recovery via WAL |
| Migrations (`supabase/migrations`) | 0 (versioned in git) | 30 min | Replayed from repo, never hand-edited |
| Audit records | 15 min | 2 h | Restored with DB; append-only, never mutated |
| Contract manifests | 0 (versioned in git) | 30 min | Source of truth for on-chain contract IDs |
| Operational config (env, secrets) | 24 h | 1 h | Stored in secret manager, not in DB |

RPO = maximum acceptable data loss. RTO = maximum acceptable time to restore service.

## 2. Backup scope

- **Database**: automated daily snapshots + continuous WAL archiving (PITR window ≥ 7 days).
- **Migrations**: every migration is committed to `supabase/migrations`; the repo is the
  authoritative schema history. No out-of-band DDL in production.
- **Audit records**: stored in the database (`audit` tables) and covered by the same
  snapshot/PITR policy. They are append-only and must never be rewritten during restore.
- **Contract manifests**: committed to the repo (contract IDs, network, deploy metadata).
  These are the reconciliation anchor against Stellar.
- **Operational config**: environment variables and secrets live in the secret manager and
  are backed up separately from the database.

## 3. Restore order

Restore in this order to keep referential integrity and reconciliation possible:

1. **Provision** a clean database instance (do not restore over the live primary).
2. **Restore schema**: apply migrations from `supabase/migrations` in order up to the
   target release tag.
3. **Restore data**: replay the snapshot / PITR to the chosen recovery timestamp.
4. **Restore audit records**: included in the data restore; verify append-only integrity
   (no gaps in sequence, no mutated rows).
5. **Restore operational config**: load env/secrets from the secret manager backup.
6. **Load contract manifests**: check out the matching release tag so contract IDs match
   the restored data.
7. **Cut over**: repoint the application at the restored instance only after consistency
   checks pass (see §5).

## 4. Reconciliation against immutable Stellar evidence

Stellar ledger state is the immutable source of truth for on-chain events. After restore:

- For each contract manifest entry, query the Stellar network (Horizon/RPC) for the
  contract ID and compare recorded on-chain events against restored DB rows.
- Any DB record referencing an on-chain event that does not exist on Stellar is a
  **data gap** — record it, do not fabricate it.
- Any on-chain event with no corresponding DB row is a **missed write** — replay it from
  the ledger into the restored DB via the normal ingestion path.
- Generation-credit assignments must reconcile 1:1 with on-chain issuance events for the
  cooperative members in scope.

## 5. Automated post-restore consistency checks

Run these checks before cutover; fail the restore if any check fails:

- Migration version in the restored DB equals the target release tag.
- Row counts for core tables (members, credits, audit) are within expected bounds.
- Audit sequence has no gaps and no mutated rows (append-only invariant).
- Every contract manifest ID resolves on the target Stellar network.
- On-chain issuance events reconcile with restored credit assignments (no orphans).

These checks are scripted so they can be re-run idempotently during rehearsal and after
any real restore.

## 6. Staged restore rehearsal

Rehearsals are run on a staging copy, never against production.

Procedure:

1. Take a snapshot of staging (or a sanitized production snapshot).
2. Record `T0` and follow §3 restore order on a fresh instance.
3. Run §5 consistency checks; record pass/fail per check.
4. Reconcile against Stellar per §4; record any data gaps and missed writes.
5. Record `T1` (service reachable and checks green) → **measured recovery time = T1 − T0**.
6. Compare measured recovery time against the RTO targets in §1.

### Rehearsal record (template)

| Field | Value |
| --- | --- |
| Rehearsal date | YYYY-MM-DD |
| Snapshot / PITR timestamp | |
| Target release tag | |
| T0 / T1 | |
| Measured recovery time | |
| RTO target | 2 h |
| Consistency checks | pass / fail (list) |
| Data gaps found | count + description |
| Missed writes replayed | count |
| Sanitized evidence attached | link to redacted logs/screenshots |

Attach **sanitized** evidence only: redact member PII, secrets, and connection strings.
Record measurable recovery time and any data gaps explicitly — a rehearsal with gaps is
still a valid result and must be documented, not hidden.

## 7. Risk and rollout

- **Risk: High.** A restore must never overwrite the live primary; always restore to a
  fresh instance and cut over only after checks pass.
- Preserve existing data: audit records are append-only and must not be rewritten.
- Any schema change requires a committed migration; document rollout requirements in the
  release notes and confirm the migration is applied before data restore.
- Keep the previous instance available (read-only) until reconciliation is signed off, so
  no data is lost if a gap is discovered late.

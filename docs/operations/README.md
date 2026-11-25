# Operations Runbook

Operational guidance for running the cooperative-management platform. Generation credits are assigned to cooperative members; this is not an external certificate marketplace and makes no I-REC/ESG certification claim.

## Backup, Restore, and Disaster Recovery

### RPO / RTO targets

| Data class | RPO | RTO | Notes |
| --- | --- | --- | --- |
| Relational database (Supabase Postgres) | 15 min (PITR) | 2 h | Daily full snapshot + WAL/PITR window |
| Migrations (`supabase/migrations`) | 0 (versioned in git) | 30 min | Replayed from the tagged release commit |
| Audit records | 15 min | 2 h | Stored in DB; also reconciled against Stellar evidence |
| Contract manifests | 0 (versioned in git) | 30 min | Immutable once deployed; source of truth is the repo + Stellar |

### Backup scope

- **Database**: automated daily snapshots plus point-in-time recovery (PITR) enabled on the Supabase project. Retain at least 30 days.
- **Migrations**: every migration is committed under `supabase/migrations` and tagged with the release. Never edit an applied migration; add a new one.
- **Audit records**: covered by the database backup. Because audit rows reference on-chain activity, they are additionally reconcilable against Stellar (see below).
- **Contract manifests**: committed to the repo and recorded on Stellar. The deployed contract IDs and wasm hashes are the immutable evidence; the repo manifest must match them.

### Restore order

1. **Provision** a fresh Supabase project (do not restore over production).
2. **Restore the database** from the most recent snapshot, then replay PITR to the target timestamp.
3. **Apply migrations** from the release tag up to the restored schema version; verify `supabase_migrations.schema_migrations` matches the expected set.
4. **Restore configuration** (env vars, secrets, contract manifests) from the release tag. Do not copy secrets into tickets or evidence.
5. **Reconcile against Stellar** (see below) before cutting traffic over.
6. **Cut over** DNS/connection strings only after consistency checks pass.

### Reconciliation against immutable Stellar evidence

Stellar is the source of truth for on-chain events (credit assignments, contract invocations). After restore:

- For each audit record that references a transaction hash, confirm the transaction exists on the expected network and its ledger close time is consistent with the restored row.
- Compare the restored contract manifest (contract IDs + wasm hashes) against the on-chain contract data. Any mismatch is a data gap — do not cut over.
- Record any audit rows present on-chain but missing in the restored DB (or vice versa) as explicit data gaps in the rehearsal log.

### Post-restore consistency checks

Automate these checks and run them as part of every rehearsal and restore:

- Schema version matches the release tag's migration set.
- Row counts for core tables (members, credit assignments, audit records) are within expected bounds of the pre-restore snapshot.
- Every audit record with a `tx_hash` resolves on Stellar.
- Contract manifest hashes match on-chain wasm hashes.
- No orphaned foreign keys (run the standard integrity queries).

### Staged restore rehearsal

Run a rehearsal at least quarterly and before any high-risk migration:

1. Restore the latest snapshot into a staging project and replay PITR to a chosen timestamp.
2. Apply migrations and configuration from the release tag.
3. Run the post-restore consistency checks above.
4. Record measurable results in the rehearsal log:
   - **Recovery time**: wall-clock from restore start to checks passing (compare against RTO).
   - **Data gap**: rows/events present on-chain but missing after restore, and vice versa (compare against RPO).
5. Attach **sanitized** evidence (no secrets, no PII): check output, timings, and gap counts.

### Rehearsal log template

```
Date:
Release tag:
Snapshot / PITR target:
Restore start / checks-passed (recovery time):
RTO target vs actual:
Data gaps (on-chain vs restored):
Consistency checks: PASS / FAIL (attach sanitized output)
Follow-ups:
```

### Risk and rollout

This is a high-risk area. Preserve existing data: never restore over production, always restore into a fresh project first. Any migration or rollout requirement must be documented in the release notes and validated by a rehearsal before it reaches production.

# Member Identity & Cooperative Membership Normalization (Issue #45)

## Purpose

Legacy `prosumers` rows conflated two distinct concepts:

1. **Authentication identity** — a wallet address (or other credential) used to authenticate a user.
2. **Cooperative membership** — the relationship between a person and a cooperative, which is what generation credits are assigned to.

This migration normalizes those into a canonical `members` record with separate `member_identities` (auth) and `cooperative_memberships` (relationship) tables. Generation credits continue to be assigned to cooperative members; this is **not** an external certificate marketplace and makes **no** I-REC/ESG certification claim.

## Canonical model

- `members` — one canonical record per person (canonical member record).
- `member_identities` — authentication identities (wallet addresses, credentials) linked to a member. A wallet may map to at most one member.
- `cooperative_memberships` — membership relationships linking a member to a cooperative. A member may hold multiple memberships (one per cooperative).

## Migration from legacy `prosumers`

Run the migration in a transaction. It performs the following, and **reports conflicts explicitly** rather than silently merging:

1. **Duplicate wallets** — if the same wallet address appears on multiple legacy `prosumers` rows, the migration aborts and reports each conflicting wallet with the affected legacy row ids. Resolve manually (merge or retire rows) before re-running.
2. **Multiple memberships** — a single legacy prosumer that references more than one cooperative is split into one `cooperative_memberships` row per cooperative; each split is logged.
3. **Missing cooperative references** — legacy rows whose `cooperative_id` is null or does not resolve to an existing cooperative are reported and skipped (not silently dropped). They are left in the legacy table for follow-up.
4. **Rollback** — the migration is wrapped in a single transaction; any conflict aborts and rolls back cleanly, leaving legacy data intact. A companion down-migration restores the legacy view.

### Conflict report format

Each conflict is emitted as a structured record:

```
{ type: 'duplicate_wallet' | 'missing_cooperative' | 'multiple_memberships',
  legacy_row_id, wallet, cooperative_id, detail }
```

Operators must review the report and resolve conflicts before the migration is considered complete.

## Backward-compatible reads (sunset period)

A compatibility view `prosumers_compat` exposes the legacy `prosumers` shape by joining `members`, `member_identities`, and `cooperative_memberships`. Existing read paths may continue to use it **only** during the documented sunset period.

- **Sunset period:** 90 days from the migration rollout date.
- **After sunset:** the compatibility view is dropped and all reads must use the canonical tables. Writes to legacy `prosumers` are disabled at rollout; only reads via the compat view are supported.

## Rollout requirements

1. Back up `prosumers` before running the migration.
2. Run the migration in a transaction; capture the conflict report.
3. Resolve reported conflicts and re-run until the report is empty.
4. Enable the `prosumers_compat` view for read paths.
5. Schedule removal of the compat view at the end of the sunset period.

## Validation checklist

- [ ] Duplicate wallets are detected and reported (migration aborts).
- [ ] Multiple memberships are split and logged.
- [ ] Missing cooperative references are reported and skipped.
- [ ] Rollback restores legacy data with no partial writes.

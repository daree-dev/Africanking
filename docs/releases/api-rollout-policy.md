# API and Database Rollout Policy

> Applies to `apps/api`. Last updated: 2026-10.
>
> Goal: independent web and API deployments can run different versions during a rollout without data loss or breakage on either side.

---

## 1. Expand–Migrate–Contract for schema changes

Breaking schema changes — column renames, type changes, dropping columns, adding NOT NULL without a default — follow three sequential deployment steps:

### Step 1 — Expand

Add the new shape alongside the old one. The database accepts both old and new writes.

Examples:
- Rename `kwh_generated` → `kwh_gross`: add column `kwh_gross`, keep `kwh_generated`, write to both.
- Add NOT NULL column: add it as nullable first, back-fill existing rows, then apply the NOT NULL constraint in Step 3.
- Split a column into two: add both new columns, start writing to all three.

No code is removed at this step. Old API pods still work against the expanded schema.

### Step 2 — Migrate

Deploy the new API version that reads from the new shape. Both old and new pods run simultaneously for the duration of the compatibility window (see §3). Writes go to both columns/tables so a rollback returns old pods to a consistent state.

Verify:
- Old API pods still serve requests without error.
- New API pods read and write correctly.
- No data written by the new version is unreadable by the old version.

### Step 3 — Contract

After the compatibility window closes and all old pods are retired:
1. Stop writing to the old shape.
2. Drop the old column/table in a separate migration.

This migration is irreversible. Confirm rollback criteria (§4) are met before running it.

---

## 2. API versioning and deprecation

### Versioning policy

BeEnergy API is currently unversioned (all routes under `/api/`). Until explicit versioning is introduced, breaking changes are managed through the expand–migrate–contract process above rather than parallel route versions.

When a route's response shape or required parameters must change incompatibly:

1. Add the new behaviour behind a request header or query parameter (e.g. `?v=2`) or a new route path (`/api/v2/...`).
2. Keep the old behaviour working for the compatibility window.
3. Mark the old path deprecated (see below).

### Deprecation notice

A deprecated route or parameter must:

- Return a `Deprecation` response header with the sunset date:
  ```
  Deprecation: true
  Sunset: Sat, 01 Nov 2026 00:00:00 GMT
  ```
- Log a warning server-side on each request so usage can be measured.
- Be listed in the deprecation register (§2.1).

Minimum sunset period from deprecation announcement: **60 days**, or until measured usage drops to zero, whichever is longer.

### 2.1 Deprecation register

| Route / parameter | Deprecated since | Sunset date | Replacement | Usage signal |
|---|---|---|---|---|
| `POST /api/mint` (direct) | — | — | Use `energy_distribution.record_generation` via contract hook | Server logs |
| `GET /api/prosumers` (legacy) | 2026-09 | 2026-11-30 | `GET /api/members` | Server logs |

Add rows here when deprecating. Remove rows after the contract step is complete.

---

## 3. Compatibility window

| Change type | Minimum window |
|---|---|
| New optional field added | No window required |
| Response field renamed | 60 days |
| Route deprecated | 60 days or zero-usage |
| Column renamed or type changed | Until all pods updated (tracked in deploy manifest) |
| Column dropped | After contract step confirmed |

---

## 4. Rollback criteria

A rollback is safe when **all** of the following hold:

1. No writes accepted exclusively by the new version have been made — or those writes are present in both old and new columns (Expand step was not skipped).
2. The old API version can read all rows in the database without schema errors.
3. No irreversible contract step has been run (column drop, NOT NULL constraint applied).

If condition 1 is violated (new-only writes exist), roll forward instead of back: fix the bug in a new patch and deploy forward. Do not drop the new column to recover old behaviour — that destroys accepted writes.

---

## 5. Staged migration example — `readings` table

This is a worked example of renaming `kwh_generated` to `kwh_gross` using the three steps.

**Context:** `POST /api/readings` and `POST /api/meters/readings` both write `kwh_generated`. The new API would write `kwh_gross`. Both columns are read by the mint and distribution logic.

### Step 1 — Expand (migration `0012_add_kwh_gross.sql`)

```sql
-- Add new column alongside existing one
ALTER TABLE readings ADD COLUMN kwh_gross numeric;

-- Back-fill from existing data
UPDATE readings SET kwh_gross = kwh_generated WHERE kwh_gross IS NULL;
```

Deploy: API unchanged. Both columns exist. Old pods write `kwh_generated`; migration script keeps `kwh_gross` in sync via a trigger or scheduled job during the window.

### Step 2 — Migrate (new API version)

The new API version writes to both `kwh_generated` and `kwh_gross`:

```typescript
// apps/api — write to both during compatibility window
await supabase.from("readings").insert({
  kwh_generated: body.kwh_generated,   // keep for old pods
  kwh_gross: body.kwh_generated,        // new canonical column
  // ...
})
```

Reads switch to `kwh_gross`. Old pods still read `kwh_generated` — no breakage.

**Validation:** run both old and new API versions against the staging database and confirm:
- Old `GET /api/readings` returns correct data.
- New `GET /api/readings` returns correct data.
- A mint triggered by old pod reads a consistent value.

### Step 3 — Contract (migration `0013_drop_kwh_generated.sql`)

After all pods run the new version:

```sql
ALTER TABLE readings DROP COLUMN kwh_generated;
```

Update API to stop writing the old column.

---

## 6. Deployment checklist for breaking changes

Before merging a breaking change:

- [ ] Expand migration written and reviewed.
- [ ] New API version writes to both old and new shape during the window.
- [ ] Deprecation header added to old route/parameter if applicable.
- [ ] Deprecation register updated (§2.1).
- [ ] Rollback criteria documented for this change.
- [ ] Staged validation passed (old + new pods against staging DB — see §5).
- [ ] Contract migration scheduled with sunset date.

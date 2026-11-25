# Data Dictionary and Migration Ownership

This document describes every table, its columns, units, status transitions, and migration ownership rules. It is the canonical reference for schema changes.

---

## Schema ownership

**Canonical source for schema changes:** Supabase project schema editor and any SQL migration files under `supabase/migrations/`. All schema changes must go through a migration file — do not alter tables directly in the Supabase dashboard on a shared environment.

**Supported migration workflow:**

1. Create a new migration: `supabase migration new <descriptive-name>`
2. Write the SQL in the generated file under `supabase/migrations/`.
3. Apply locally: `supabase db reset` (destroys and recreates) or `supabase migration up` (incremental).
4. Commit the migration file alongside the application code that depends on it.
5. On deploy, run `supabase migration up` against the target environment before deploying the application.

**TypeScript types** are maintained manually in `apps/web/lib/types/database.ts`. After a schema change, update that file to match.

---

## Energy units

All energy quantities stored in this database use **kilowatt-hours (kWh)** unless a column name says otherwise. `power_watts` is an instantaneous measurement in **watts (W)**. Timestamps are stored as ISO-8601 strings in UTC.

---

## Tables

### `cooperatives`

Represents an electricity cooperative that uses Africanking to manage generation credits among its members.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | uuid | no | Primary key |
| `name` | text | no | Display name of the cooperative |
| `location` | text | yes | City or locality |
| `province` | text | yes | Province or state |
| `country` | text | no | Country code or name |
| `technology` | enum | no | Primary generation technology: `solar`, `wind`, `hydro`, `mixed` |
| `admin_stellar_address` | text | no | Stellar public key of the cooperative administrator |
| `token_contract_address` | text | yes | Deployed `energy_token` contract address on Stellar |
| `distribution_contract_address` | text | yes | Deployed `energy_distribution` contract address on Stellar |
| `status` | enum | no | `active` or `inactive` |
| `created_at` | timestamptz | no | Row creation time (UTC) |

**Status transitions:** `active` → `inactive` (manual admin action). Inactive cooperatives are hidden from member dashboards but retained for audit history.

**Tenant ownership:** Each cooperative is its own tenant boundary. Rows in `members`, `meters`, `readings`, and `certificates` are scoped by `cooperative_id`.

---

### `prosumers` (members)

> **Note:** The table is named `prosumers` in the database; the application code and TypeScript types refer to this concept as `Member`. The `prosumers` name is a legacy of the early product direction and will be renamed to `members` in a future migration. See *Legacy fields and tables* below.

Represents an individual member of a cooperative who generates and/or consumes energy.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | uuid | no | Primary key |
| `stellar_address` | text | no | Stellar public key; used as the member's unique identity |
| `name` | text | yes | Display name |
| `hive_id` | text | no | Internal identifier within the cooperative's management system |
| `panel_capacity_kw` | numeric | yes | Installed generation capacity in kilowatts |
| `cooperative_id` | uuid | yes | Foreign key to `cooperatives.id` |
| `role` | enum | no | `prosumer` (generates and consumes), `copropietario` (co-owner, generates only), `mixed` |
| `created_at` | timestamptz | no | Row creation time (UTC) |

---

### `meters`

A physical or virtual measurement device associated with a cooperative member.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | uuid | no | Primary key |
| `cooperative_id` | uuid | no | Foreign key to `cooperatives.id` |
| `member_stellar_address` | text | no | Stellar address of the owning member |
| `device_type` | enum | no | `inverter`, `bidirectional_meter`, `smart_meter` |
| `manufacturer` | text | yes | Hardware manufacturer name |
| `model` | text | yes | Hardware model name |
| `serial_number` | text | yes | Physical serial number |
| `location_lat` | numeric | yes | Latitude (decimal degrees, WGS-84) |
| `location_lng` | numeric | yes | Longitude (decimal degrees, WGS-84) |
| `technology` | enum | no | `solar`, `wind`, `hydro`, `biomass` |
| `capacity_kw` | numeric | no | Nameplate capacity in kilowatts |
| `installed_at` | timestamptz | yes | Installation date (UTC) |
| `status` | enum | no | `active`, `inactive`, `maintenance` |
| `created_at` | timestamptz | no | Row creation time (UTC) |

**Status transitions:** `active` ↔ `maintenance` ↔ `inactive`. Readings are only processed for `active` meters.

---

### `readings`

A single energy measurement from a meter or member. Readings are the input to certificate minting.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | uuid | no | Primary key |
| `prosumer_id` | uuid | yes | Foreign key to `prosumers.id` (legacy path; prefer `meter_id`) |
| `meter_id` | uuid | yes | Foreign key to `meters.id` |
| `cooperative_id` | uuid | yes | Foreign key to `cooperatives.id` |
| `kwh_generated` | numeric | no | Energy generated in this interval, in kWh |
| `kwh_self_consumed` | numeric | yes | Energy consumed on-site in this interval, in kWh |
| `power_watts` | numeric | yes | Instantaneous power at the time of reading, in W |
| `interval_minutes` | integer | no | Duration this reading covers, in minutes (default 15) |
| `reading_date` | date | yes | Calendar date of the reading (UTC) |
| `reading_timestamp` | timestamptz | yes | Exact timestamp of the reading (UTC). At least one of `reading_date` or `reading_timestamp` must be provided |
| `source` | text | no | Origin of the reading: `api`, `mock`, `manual`, etc. |
| `status` | enum | no | `pending` → `verified` or `rejected` |
| `tx_hash` | text | yes | Stellar transaction hash if this reading was minted on-chain |
| `created_at` | timestamptz | no | Row creation time (UTC) |

**Status transitions:** `pending` → `verified` (admin or automated verification) → used in certificate generation. `pending` → `rejected` (failed validation). Verified readings cannot revert to pending.

**Units:** `kwh_generated` and `kwh_self_consumed` are both in kWh. The API validation cap is 1000 kWh per reading (per `createReadingSchema`). `power_watts` is watts, not kWh.

---

### `certificates`

Aggregates one or more verified readings into a generation credit that can be assigned to cooperative members as proof of generation. This is **not** an I-REC certificate or an external ESG claim — it is an internal cooperative generation record minted on Stellar.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | uuid | no | Primary key |
| `cooperative_id` | uuid | no | Foreign key to `cooperatives.id` |
| `generation_period_start` | timestamptz | no | Start of the generation period covered (UTC) |
| `generation_period_end` | timestamptz | no | End of the generation period covered (UTC) |
| `total_kwh` | numeric | no | Total energy in kWh represented by this certificate |
| `technology` | text | no | Generation technology (mirrors the contributing meters) |
| `location` | text | yes | Human-readable location description |
| `mint_tx_hash` | text | yes | Stellar transaction hash of the minting transaction |
| `token_amount` | numeric | yes | Number of `energy_token` tokens minted (1 token = 1 kWh) |
| `status` | enum | no | `pending` → `available` → `sold` → `retired` |
| `created_at` | timestamptz | no | Row creation time (UTC) |

**Status transitions:**

```
pending → available   (minting succeeded; tokens exist on-chain)
available → sold      (tokens transferred to a buyer — planned feature)
available → retired   (tokens burned on-chain via /api/certificates/retire)
sold → retired        (buyer retires)
```

**Token relationship:** 1 token = 1 kWh. `token_amount` mirrors `total_kwh` after minting.

---

### `retirements`

Records the on-chain retirement (burn) of a certificate's tokens, providing verifiable proof that the generation credits were used.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | uuid | no | Primary key |
| `certificate_id` | uuid | no | Foreign key to `certificates.id` |
| `buyer_address` | text | no | Stellar address of the entity retiring the tokens |
| `buyer_name` | text | yes | Display name of the retiring party |
| `buyer_purpose` | enum | no | Reason for retirement: `esg_reporting`, `carbon_offset`, `voluntary_commitment`, `regulatory_compliance`, `other` |
| `kwh_retired` | numeric | no | kWh value retired (must equal or be less than `certificates.total_kwh`) |
| `burn_tx_hash` | text | yes | Stellar transaction hash of the burn transaction |
| `retired_at` | timestamptz | no | Timestamp of retirement (UTC) |

---

### `mint_logs`

Audit trail for every minting operation.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | uuid | no | Primary key |
| `reading_id` | uuid | yes | Foreign key to `readings.id` (if minted from a reading) |
| `certificate_id` | uuid | yes | Foreign key to `certificates.id` (if minted from a certificate) |
| `prosumer_address` | text | no | Stellar address that received the minted tokens |
| `amount_hdrop` | numeric | no | Amount minted in the token's smallest unit (hdrop; 1 kWh = 1 token at the current scale) |
| `tx_hash` | text | no | Stellar transaction hash |
| `minted_at` | timestamptz | no | Timestamp of minting (UTC) |

---

## Legacy fields and tables

| Item | Owner | Deprecation condition |
|------|-------|-----------------------|
| `prosumers` table | Backend team | Rename to `members` once all API routes and TypeScript types are updated. No removal until a migration is authored, reviewed, and deployed. |
| `readings.prosumer_id` | Backend team | Retained for backward compatibility with older API callers. New code should use `readings.meter_id`. Remove after confirming no active callers use `prosumer_id` exclusively. |
| `mint_logs.amount_hdrop` | Backend team | The column name is a holdover from an earlier token design. The value represents the token amount at the standard scale (1 kWh = 1 token). Rename to `amount_tokens` in a future migration. |

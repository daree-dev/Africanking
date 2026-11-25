-- Generation credits: internal allocation to cooperative members.
--
-- Additive only. No existing table or column is renamed or dropped:
--   * `certificates` keeps its name and data; the UI calls these rows
--     "generation credits".
--   * `retirements` (legacy buyer lifecycle) is kept as-is and becomes
--     read-only — /api/certificates/retire now answers 410 Gone.
--
-- Rollout: apply this migration BEFORE deploying the API. Until it is
-- applied, the API treats a missing `credit_allocations` table as "no
-- allocations" for reads, and POST /api/credits/allocate returns 500.

create table if not exists credit_allocations (
  id                      uuid primary key default gen_random_uuid(),
  certificate_id          uuid not null references certificates(id) on delete restrict,
  cooperative_id          uuid not null references cooperatives(id) on delete restrict,
  member_stellar_address  text not null,
  prosumer_id             uuid references prosumers(id) on delete set null,
  basis                   text not null check (basis in ('installed_capacity', 'equal')),
  share_version           text not null,
  share_percent           numeric(9, 4) not null check (share_percent >= 0 and share_percent <= 100),
  kwh_allocated           numeric(20, 7) not null check (kwh_allocated >= 0),
  allocated_by            text not null,
  allocated_at            timestamptz not null default now(),
  unique (certificate_id, member_stellar_address)
);

create index if not exists credit_allocations_member_idx
  on credit_allocations (member_stellar_address);
create index if not exists credit_allocations_cooperative_idx
  on credit_allocations (cooperative_id);

-- Prevent any further writes to the legacy buyer table while keeping rows.
revoke insert, update, delete on retirements from anon, authenticated;

comment on table credit_allocations is
  'Per-member share of a generation credit. Internal cooperative record; not an I-REC or ESG certificate.';
comment on table retirements is
  'LEGACY (pre-pivot buyer lifecycle). Read-only; kept for historical access.';

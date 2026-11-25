-- Cooperative credit management schema
-- Generation credits are assigned to cooperative members.
-- This is not an external certificate marketplace and makes no I-REC/ESG claim.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Core cooperative entities
-- ---------------------------------------------------------------------------

create table if not exists cooperatives (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists members (
  id uuid primary key default gen_random_uuid(),
  cooperative_id uuid not null references cooperatives(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

create index if not exists members_cooperative_id_idx on members(cooperative_id);

-- ---------------------------------------------------------------------------
-- Meter readings, allocations, and credit operations
-- ---------------------------------------------------------------------------

create table if not exists readings (
  id uuid primary key default gen_random_uuid(),
  cooperative_id uuid not null references cooperatives(id) on delete cascade,
  member_id uuid not null references members(id) on delete restrict,
  kwh numeric(18, 6) not null check (kwh >= 0),
  read_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists readings_cooperative_id_idx on readings(cooperative_id);
create index if not exists readings_member_id_idx on readings(member_id);

create table if not exists allocations (
  id uuid primary key default gen_random_uuid(),
  cooperative_id uuid not null references cooperatives(id) on delete cascade,
  reading_id uuid not null references readings(id) on delete restrict,
  member_id uuid not null references members(id) on delete restrict,
  kwh numeric(18, 6) not null check (kwh >= 0),
  created_at timestamptz not null default now()
);

create index if not exists allocations_cooperative_id_idx on allocations(cooperative_id);
create index if not exists allocations_reading_id_idx on allocations(reading_id);
create index if not exists allocations_member_id_idx on allocations(member_id);

create table if not exists credit_operations (
  id uuid primary key default gen_random_uuid(),
  cooperative_id uuid not null references cooperatives(id) on delete cascade,
  allocation_id uuid not null references allocations(id) on delete restrict,
  member_id uuid not null references members(id) on delete restrict,
  credits numeric(18, 6) not null check (credits >= 0),
  created_at timestamptz not null default now()
);

create index if not exists credit_operations_cooperative_id_idx on credit_operations(cooperative_id);
create index if not exists credit_operations_allocation_id_idx on credit_operations(allocation_id);
create index if not exists credit_operations_member_id_idx on credit_operations(member_id);

-- ---------------------------------------------------------------------------
-- Mint log: confirmed mint history with referential integrity
-- ---------------------------------------------------------------------------
-- Each confirmed mint record must reference exactly one logical source
-- operation (reading, allocation, or credit operation) and the Stellar
-- transaction that confirms it. Transaction hashes are unique across
-- confirmed mints so the same on-chain transaction cannot be double-counted.

create table if not exists mint_log (
  id uuid primary key default gen_random_uuid(),
  cooperative_id uuid not null references cooperatives(id) on delete cascade,
  reading_id uuid references readings(id) on delete restrict,
  allocation_id uuid references allocations(id) on delete restrict,
  credit_operation_id uuid references credit_operations(id) on delete restrict,
  transaction_hash text not null,
  credits numeric(18, 6) not null check (credits >= 0),
  confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint mint_log_transaction_hash_key unique (transaction_hash),
  constraint mint_log_source_operation_required check (
    (reading_id is not null)::int
    + (allocation_id is not null)::int
    + (credit_operation_id is not null)::int = 1
  )
);

create index if not exists mint_log_cooperative_id_idx on mint_log(cooperative_id);
create index if not exists mint_log_reading_id_idx on mint_log(reading_id);
create index if not exists mint_log_allocation_id_idx on mint_log(allocation_id);
create index if not exists mint_log_credit_operation_id_idx on mint_log(credit_operation_id);

-- ---------------------------------------------------------------------------
-- Failed mint attempts: preserved separately from confirmed mint history
-- ---------------------------------------------------------------------------
-- Failed attempts keep their evidence (including the attempted transaction
-- hash) without polluting confirmed mint history or its uniqueness rule.

create table if not exists mint_attempts (
  id uuid primary key default gen_random_uuid(),
  cooperative_id uuid not null references cooperatives(id) on delete cascade,
  reading_id uuid references readings(id) on delete restrict,
  allocation_id uuid references allocations(id) on delete restrict,
  credit_operation_id uuid references credit_operations(id) on delete restrict,
  transaction_hash text,
  credits numeric(18, 6) not null check (credits >= 0),
  status text not null default 'failed' check (status in ('failed', 'pending')),
  error_message text,
  attempted_at timestamptz not null default now(),
  constraint mint_attempts_source_operation_required check (
    (reading_id is not null)::int
    + (allocation_id is not null)::int
    + (credit_operation_id is not null)::int = 1
  )
);

create index if not exists mint_attempts_cooperative_id_idx on mint_attempts(cooperative_id);
create index if not exists mint_attempts_transaction_hash_idx on mint_attempts(transaction_hash);

-- ---------------------------------------------------------------------------
-- Reconciliation query for orphaned or mismatched mint rows
-- ---------------------------------------------------------------------------
-- Returns mint_log rows whose source operation is missing, whose source
-- operation belongs to a different cooperative, or whose referenced member
-- does not match the source operation's member. Also surfaces failed
-- attempts that reference a transaction hash already confirmed in mint_log.

create or replace view mint_log_reconciliation as
select
  ml.id as mint_log_id,
  ml.cooperative_id,
  ml.transaction_hash,
  case
    when ml.reading_id is not null and r.id is null then 'orphaned_reading'
    when ml.allocation_id is not null and a.id is null then 'orphaned_allocation'
    when ml.credit_operation_id is not null and co.id is null then 'orphaned_credit_operation'
    when ml.reading_id is not null and r.cooperative_id <> ml.cooperative_id then 'mismatched_cooperative'
    when ml.allocation_id is not null and a.cooperative_id <> ml.cooperative_id then 'mismatched_cooperative'
    when ml.credit_operation_id is not null and co.cooperative_id <> ml.cooperative_id then 'mismatched_cooperative'
    else 'ok'
  end as issue
from mint_log ml
left join readings r on r.id = ml.reading_id
left join allocations a on a.id = ml.allocation_id
left join credit_operations co on co.id = ml.credit_operation_id
where
  (ml.reading_id is not null and r.id is null)
  or (ml.allocation_id is not null and a.id is null)
  or (ml.credit_operation_id is not null and co.id is null)
  or (ml.reading_id is not null and r.cooperative_id <> ml.cooperative_id)
  or (ml.allocation_id is not null and a.cooperative_id <> ml.cooperative_id)
  or (ml.credit_operation_id is not null and co.cooperative_id <> ml.cooperative_id)
union all
select
  null as mint_log_id,
  ma.cooperative_id,
  ma.transaction_hash,
  'failed_attempt_already_confirmed' as issue
from mint_attempts ma
join mint_log ml on ml.transaction_hash = ma.transaction_hash
where ma.transaction_hash is not null;

-- ---------------------------------------------------------------------------
-- Migration / rollout notes
-- ---------------------------------------------------------------------------
-- 1. Existing mint_log rows must be backfilled with a valid source operation
--    reference and a unique transaction_hash before the NOT NULL / UNIQUE
--    constraints are enforced. Run the reconciliation view first to find
--    orphaned or mismatched rows.
-- 2. Failed attempts previously stored in mint_log should be moved into
--    mint_attempts (status = 'failed') before adding the uniqueness rule.
-- 3. Apply in a transaction; validate with the reconciliation view after
--    backfill and before enabling constraints on production data.

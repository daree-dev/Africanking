-- Cooperative management schema
-- Tenant-aware constraints: members, meters, readings, and credits are bound
-- to a single cooperative via composite keys/foreign keys.

-- ---------------------------------------------------------------------------
-- Core tables
-- ---------------------------------------------------------------------------

create table if not exists cooperatives (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists members (
  id uuid primary key default gen_random_uuid(),
  cooperative_id uuid not null references cooperatives (id) on delete restrict on update cascade,
  full_name text not null,
  created_at timestamptz not null default now(),
  -- Composite key so children can bind to (member, cooperative) atomically.
  unique (id, cooperative_id)
);

create table if not exists meters (
  id uuid primary key default gen_random_uuid(),
  cooperative_id uuid not null references cooperatives (id) on delete restrict on update cascade,
  member_id uuid not null,
  serial text not null,
  created_at timestamptz not null default now(),
  unique (id, cooperative_id),
  -- Meter must belong to a member of the same cooperative.
  constraint meters_member_cooperative_fk
    foreign key (member_id, cooperative_id)
    references members (id, cooperative_id)
    on delete restrict on update cascade
);

create table if not exists readings (
  id uuid primary key default gen_random_uuid(),
  cooperative_id uuid not null references cooperatives (id) on delete restrict on update cascade,
  meter_id uuid not null,
  value numeric not null,
  read_at timestamptz not null default now(),
  unique (id, cooperative_id),
  -- Reading must reference a meter of the same cooperative.
  constraint readings_meter_cooperative_fk
    foreign key (meter_id, cooperative_id)
    references meters (id, cooperative_id)
    on delete restrict on update cascade
);

create table if not exists credits (
  id uuid primary key default gen_random_uuid(),
  cooperative_id uuid not null references cooperatives (id) on delete restrict on update cascade,
  member_id uuid not null,
  reading_id uuid,
  amount numeric not null,
  created_at timestamptz not null default now(),
  -- Credit must be assigned to a member of the same cooperative.
  constraint credits_member_cooperative_fk
    foreign key (member_id, cooperative_id)
    references members (id, cooperative_id)
    on delete restrict on update cascade,
  -- Optional reading link must also stay within the cooperative.
  constraint credits_reading_cooperative_fk
    foreign key (reading_id, cooperative_id)
    references readings (id, cooperative_id)
    on delete restrict on update cascade
);

-- ---------------------------------------------------------------------------
-- Pre-enforcement audit: report cross-cooperative references.
-- Run this BEFORE adding the composite constraints above on an existing DB.
-- Any rows returned must be remediated (reassign or archive) first.
-- ---------------------------------------------------------------------------

create or replace view cooperative_fk_audit as
  select 'meters' as table_name, m.id as row_id, m.cooperative_id as row_cooperative_id,
         mem.cooperative_id as referenced_cooperative_id
    from meters m
    join members mem on mem.id = m.member_id
   where mem.cooperative_id <> m.cooperative_id
  union all
  select 'readings', r.id, r.cooperative_id, mt.cooperative_id
    from readings r
    join meters mt on mt.id = r.meter_id
   where mt.cooperative_id <> r.cooperative_id
  union all
  select 'credits_member', c.id, c.cooperative_id, mem.cooperative_id
    from credits c
    join members mem on mem.id = c.member_id
   where mem.cooperative_id <> c.cooperative_id
  union all
  select 'credits_reading', c.id, c.cooperative_id, r.cooperative_id
    from credits c
    join readings r on r.id = c.reading_id
   where r.cooperative_id <> c.cooperative_id;

-- ---------------------------------------------------------------------------
-- Delete/update behavior (explicit):
--   * cooperative_id references: ON DELETE RESTRICT, ON UPDATE CASCADE
--   * member/meter/reading composite FKs: ON DELETE RESTRICT, ON UPDATE CASCADE
-- Historical readings and credits are never cascaded away; archive or
-- soft-delete instead of deleting parents that still have children.
-- ---------------------------------------------------------------------------

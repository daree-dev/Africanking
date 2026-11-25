/**
 * Database migration for issues #5, #6, #7, and #8.
 *
 * Run from the repo root:
 *   npx tsx scripts/migrate-issues-5-6-7-8.ts
 *
 * Safe to run multiple times (all DDL uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
 */

import { config } from "dotenv"
import { createClient } from "@supabase/supabase-js"

config({ path: "apps/web/.env.local" })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

const SQL = `
-- ============================================================
-- Migration: Issues #5, #6, #7, #8
-- ============================================================

-- ============================================================
-- Issue #5 — Effective-dated member share versions
-- ============================================================

-- New table: member_shares stores one row per share version.
-- The currently active version for a member has effective_until IS NULL.
CREATE TABLE IF NOT EXISTS member_shares (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id        UUID NOT NULL REFERENCES prosumers(id) ON DELETE CASCADE,
  cooperative_id   UUID NOT NULL REFERENCES cooperatives(id) ON DELETE CASCADE,
  share_percentage NUMERIC(6,2) NOT NULL
    CHECK (share_percentage > 0 AND share_percentage <= 100),
  effective_from   DATE NOT NULL,
  effective_until  DATE,
  created_by       TEXT NOT NULL,  -- stellar address of the admin who set this
  created_at       TIMESTAMPTZ DEFAULT now(),

  -- A member can only have one open-ended (active) version at a time
  CONSTRAINT member_shares_one_active_version
    EXCLUDE USING gist (
      member_id WITH =,
      cooperative_id WITH =,
      daterange(effective_from, effective_until, '[]') WITH &&
    ) DEFERRABLE INITIALLY DEFERRED
);

-- Index for efficient per-member history queries
CREATE INDEX IF NOT EXISTS idx_member_shares_member
  ON member_shares (member_id, cooperative_id, effective_from);


-- ============================================================
-- Issue #6 — Canonical energy quantities on readings
-- ============================================================

-- Add kwh_net_surplus as the canonical creditable quantity.
-- Existing rows: derive from kwh_generated - kwh_self_consumed or kwh_injected.
ALTER TABLE readings ADD COLUMN IF NOT EXISTS kwh_net_surplus NUMERIC(12,3);

UPDATE readings
SET kwh_net_surplus = GREATEST(0, COALESCE(kwh_injected, kwh_generated - COALESCE(kwh_self_consumed, 0)))
WHERE kwh_net_surplus IS NULL;


-- ============================================================
-- Issue #7 — Source and verification provenance on readings
-- ============================================================

ALTER TABLE readings
  ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'manual'
    CHECK (source_type IN ('distributor_meter', 'inverter', 'scada', 'manual')),
  ADD COLUMN IF NOT EXISTS source_id TEXT,
  ADD COLUMN IF NOT EXISTS ingestion_time TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS measurement_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_state TEXT DEFAULT 'pending'
    CHECK (verification_state IN ('pending', 'verified', 'rejected', 'corrected')),
  ADD COLUMN IF NOT EXISTS verified_by TEXT,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS corrects_reading_id UUID REFERENCES readings(id);

-- Back-fill source_type from the existing source column
UPDATE readings
SET source_type = CASE
  WHEN source = 'meter'   THEN 'inverter'
  WHEN source = 'manual'  THEN 'manual'
  ELSE 'manual'
END
WHERE source_type IS NULL OR source_type = 'manual';

-- Back-fill verification_state from the existing status column
UPDATE readings
SET verification_state = CASE
  WHEN status = 'verified'  THEN 'verified'
  WHEN status = 'rejected'  THEN 'rejected'
  WHEN status = 'corrected' THEN 'corrected'
  ELSE 'pending'
END
WHERE verification_state = 'pending' AND status NOT IN ('pending');

-- Index for provenance queries (unverified readings dashboard)
CREATE INDEX IF NOT EXISTS idx_readings_verification_state
  ON readings (cooperative_id, verification_state);


-- ============================================================
-- Issue #8 — Internal credit lifecycle
-- ============================================================

-- New table: credits replaces the certificate/retirement external-buyer flow.
-- Legacy certificates are preserved for audit; new workflows use credits.
CREATE TABLE IF NOT EXISTS credits (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cooperative_id           UUID NOT NULL REFERENCES cooperatives(id),
  reading_id               UUID NOT NULL REFERENCES readings(id),
  generation_period_start  DATE NOT NULL,
  generation_period_end    DATE NOT NULL,
  kwh_generated            NUMERIC(12,3) NOT NULL,
  kwh_self_consumed        NUMERIC(12,3) NOT NULL DEFAULT 0,
  kwh_net_surplus          NUMERIC(12,3) NOT NULL,
  state                    TEXT NOT NULL DEFAULT 'measured'
    CHECK (state IN ('measured', 'validated', 'allocated', 'settled', 'cancelled')),
  notes                    TEXT,
  created_by               TEXT NOT NULL,
  validated_by             TEXT,
  validated_at             TIMESTAMPTZ,
  updated_by               TEXT,
  updated_at               TIMESTAMPTZ,
  created_at               TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT credits_period_valid
    CHECK (generation_period_start <= generation_period_end),
  CONSTRAINT credits_surplus_non_negative
    CHECK (kwh_net_surplus >= 0),
  CONSTRAINT credits_surplus_lte_generated
    CHECK (kwh_net_surplus <= kwh_generated)
);

CREATE INDEX IF NOT EXISTS idx_credits_cooperative_state
  ON credits (cooperative_id, state);

-- New table: credit_allocations — per-member allocation rows with share provenance
CREATE TABLE IF NOT EXISTS credit_allocations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_id        UUID NOT NULL REFERENCES credits(id) ON DELETE CASCADE,
  member_id        UUID NOT NULL REFERENCES prosumers(id),
  cooperative_id   UUID NOT NULL REFERENCES cooperatives(id),
  -- Issue #5 — which share version governed this allocation
  share_version_id UUID NOT NULL REFERENCES member_shares(id),
  share_percentage NUMERIC(6,2) NOT NULL,
  allocated_kwh    NUMERIC(12,3) NOT NULL,
  allocation_date  DATE NOT NULL,
  state            TEXT NOT NULL DEFAULT 'allocated'
    CHECK (state IN ('measured', 'validated', 'allocated', 'settled', 'cancelled')),
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_credit_allocations_credit
  ON credit_allocations (credit_id);

CREATE INDEX IF NOT EXISTS idx_credit_allocations_member
  ON credit_allocations (member_id, allocation_date);

-- Remove buyer-purpose semantics from new workflows.
-- The retirements table is kept intact for historical audit.
-- A view exposes legacy retirements with the new lifecycle label.
CREATE OR REPLACE VIEW legacy_retirements AS
  SELECT
    r.*,
    'settled'::text AS credit_state,
    c.generation_period_start,
    c.generation_period_end,
    c.total_kwh,
    c.technology,
    c.cooperative_id
  FROM retirements r
  JOIN certificates c ON c.id = r.certificate_id;
`

async function main() {
  console.log("Running migration for issues #5, #6, #7, #8 …")
  const { error } = await supabase.rpc("exec_sql", { query: SQL })

  if (error) {
    console.error("Could not execute SQL via RPC:", error.message)
    console.log("\nRun the following SQL directly in the Supabase SQL Editor:\n")
    console.log(SQL)
    process.exit(1)
  }

  console.log("Migration completed successfully.")
}

main()

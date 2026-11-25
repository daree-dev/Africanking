-- ============================================================================
-- Soroban event index (additive, idempotent)
--
-- Adds a replayable index of contract events for cooperative generation and
-- allocation history. Only creates new tables/indexes: existing tables and data
-- (events, mint_log, certificates, readings, ...) are untouched.
-- Safe to run more than once.
-- ============================================================================

-- Indexed contract events. (network, event_id) is the idempotency key: the RPC
-- event id is a TOID-derived, zero-padded identifier that is unique per network
-- and sorts in chain order.
CREATE TABLE IF NOT EXISTS chain_events (
  id BIGSERIAL PRIMARY KEY,
  network TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  ledger BIGINT NOT NULL,
  ledger_closed_at TIMESTAMPTZ,
  tx_hash TEXT NOT NULL,
  transaction_index INTEGER,
  operation_index INTEGER,
  event_type TEXT NOT NULL,
  topics JSONB NOT NULL DEFAULT '[]',
  value JSONB,
  topics_xdr TEXT[] NOT NULL,
  value_xdr TEXT NOT NULL,
  in_successful_contract_call BOOLEAN NOT NULL DEFAULT true,
  cooperative_id UUID REFERENCES cooperatives(id),
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chain_events_network_event_id_key UNIQUE (network, event_id)
);

CREATE INDEX IF NOT EXISTS chain_events_coop_event_idx
  ON chain_events (cooperative_id, network, event_id DESC);
CREATE INDEX IF NOT EXISTS chain_events_contract_ledger_idx
  ON chain_events (network, contract_id, ledger);
CREATE INDEX IF NOT EXISTS chain_events_tx_hash_idx
  ON chain_events (tx_hash);

-- Durable ingestion cursor, one row per stream (stream = network + contract set).
CREATE TABLE IF NOT EXISTS chain_event_cursors (
  stream TEXT PRIMARY KEY,
  network TEXT NOT NULL,
  cursor TEXT,
  last_ledger BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Detected ledger ranges that could not be ingested (e.g. pruned by RPC retention).
CREATE TABLE IF NOT EXISTS chain_event_gaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream TEXT NOT NULL,
  network TEXT NOT NULL,
  from_ledger BIGINT NOT NULL,
  to_ledger BIGINT NOT NULL,
  reason TEXT NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  CONSTRAINT chain_event_gaps_range_check CHECK (to_ledger >= from_ledger),
  CONSTRAINT chain_event_gaps_unique_range UNIQUE (stream, from_ledger, to_ledger)
);

-- Server-only tables: RLS on with no anon/authenticated policies. The API reads
-- them with the service role and enforces cooperative membership itself.
ALTER TABLE chain_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE chain_event_cursors ENABLE ROW LEVEL SECURITY;
ALTER TABLE chain_event_gaps ENABLE ROW LEVEL SECURITY;

/**
 * Orchestrates reconciliation: load DB rows, gather evidence, apply rules,
 * and (only when explicitly requested) apply safe repairs with an audit trail.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { reconcileRecord } from "./rules"
import type { MintRecord, ReconciliationResult, RepairPatch, TransactionEvidence } from "./types"

export type EvidenceFetcher = (hash: string) => Promise<TransactionEvidence>

export interface RunOptions {
  supabase: SupabaseClient
  fetchEvidence: EvidenceFetcher
  defaultContract: string
  /** false (default) = dry-run: report only, no writes. */
  apply?: boolean
  /** Identifier recorded in audit_log.actor */
  actor?: string
  kinds?: MintRecord["kind"][]
  limit?: number
}

export type RepairOutcome =
  | { state: "dry_run" }
  | { state: "applied" }
  | { state: "skipped_stale"; detail: string }
  | { state: "error"; detail: string }

export interface OperationReport extends ReconciliationResult {
  outcome: RepairOutcome | null
}

export interface RunReport {
  mode: "dry-run" | "apply"
  operations: OperationReport[]
  summary: Record<string, number>
}

function mintableKwh(r: {
  kwh_injected?: number | null
  kwh_generated?: number | null
  kwh_self_consumed?: number | null
}): number | null {
  if (r.kwh_injected != null) return r.kwh_injected
  if (r.kwh_generated == null || r.kwh_self_consumed == null) return null
  return Math.max(0, r.kwh_generated - r.kwh_self_consumed)
}

export async function loadMintRecords(
  supabase: SupabaseClient,
  defaultContract: string,
  kinds: MintRecord["kind"][] = ["certificate", "reading"],
  limit = 500
): Promise<MintRecord[]> {
  const records: MintRecord[] = []

  // mint_log holds the recipient actually used at mint time (custodial minter
  // for certificates, prosumer for readings). It is the best expected recipient.
  const { data: logs, error: logError } = await supabase
    .from("mint_log")
    .select("tx_hash, prosumer_address")
  if (logError) throw new Error(`failed to load mint_log: ${logError.message}`)
  const recipientByHash = new Map<string, string>(
    (logs ?? []).map((l: { tx_hash: string; prosumer_address: string }) => [l.tx_hash, l.prosumer_address])
  )

  if (kinds.includes("certificate")) {
    const { data, error } = await supabase
      .from("certificates")
      .select("id, cooperative_id, status, mint_tx_hash, total_kwh, token_amount, cooperatives(token_contract_address)")
      .or("mint_tx_hash.not.is.null,status.neq.pending")
      .order("created_at", { ascending: true })
      .limit(limit)
    if (error) throw new Error(`failed to load certificates: ${error.message}`)

    for (const c of data ?? []) {
      const coop = (c as { cooperatives?: { token_contract_address?: string | null } | null }).cooperatives
      records.push({
        kind: "certificate",
        id: c.id,
        cooperative_id: c.cooperative_id,
        status: c.status,
        tx_hash: c.mint_tx_hash,
        expected_kwh: c.total_kwh,
        expected_contract: coop?.token_contract_address || defaultContract,
        expected_recipient: c.mint_tx_hash ? recipientByHash.get(c.mint_tx_hash) ?? null : null,
        token_amount: c.token_amount,
      })
    }
  }

  if (kinds.includes("reading")) {
    const { data, error } = await supabase
      .from("readings")
      .select("id, cooperative_id, status, tx_hash, kwh_injected, kwh_generated, kwh_self_consumed, prosumers(stellar_address)")
      .or("tx_hash.not.is.null,status.eq.minted")
      .order("created_at", { ascending: true })
      .limit(limit)
    if (error) throw new Error(`failed to load readings: ${error.message}`)

    for (const r of data ?? []) {
      const prosumer = (r as { prosumers?: { stellar_address?: string | null } | null }).prosumers
      records.push({
        kind: "reading",
        id: r.id,
        cooperative_id: r.cooperative_id,
        status: r.status,
        tx_hash: r.tx_hash,
        expected_kwh: mintableKwh(r),
        expected_contract: defaultContract,
        expected_recipient:
          (r.tx_hash ? recipientByHash.get(r.tx_hash) : undefined) ?? prosumer?.stellar_address ?? null,
        token_amount: null,
      })
    }
  }

  return records
}

/**
 * Apply one repair. The prior values are written to audit_log *before* the
 * update; if the audit insert fails the repair is not attempted. The update is
 * conditioned on the reconciled values so concurrent changes are never
 * overwritten.
 */
async function applyRepair(
  supabase: SupabaseClient,
  op: ReconciliationResult,
  repair: RepairPatch,
  actor: string
): Promise<RepairOutcome> {
  const before: Record<string, unknown> = { ...repair.expect }
  if (op.record.kind === "certificate") before.token_amount = op.record.token_amount

  const { error: auditError } = await supabase.from("audit_log").insert({
    action: "reconcile",
    actor,
    resource_type: repair.table,
    resource_id: repair.id,
    details: {
      verdict: op.verdict,
      reasons: op.reasons,
      before,
      after: repair.set,
    },
  })
  if (auditError) {
    return { state: "error", detail: `audit log write failed, repair not applied: ${auditError.message}` }
  }

  let query = supabase.from(repair.table).update(repair.set).eq("id", repair.id)
  for (const [col, value] of Object.entries(repair.expect)) {
    query = value === null ? query.is(col, null) : query.eq(col, value as string)
  }
  const { data, error } = await query.select("id")

  if (error) return { state: "error", detail: error.message }
  if (!data || data.length === 0) {
    return { state: "skipped_stale", detail: "row changed since it was read; re-run reconciliation" }
  }
  return { state: "applied" }
}

export async function runReconciliation(opts: RunOptions): Promise<RunReport> {
  const apply = opts.apply ?? false
  const actor = opts.actor ?? "reconciliation"
  const records = await loadMintRecords(opts.supabase, opts.defaultContract, opts.kinds, opts.limit)
  const evidenceCache = new Map<string, TransactionEvidence>()
  const operations: OperationReport[] = []

  for (const record of records) {
    let evidence: TransactionEvidence | null = null
    if (record.tx_hash) {
      evidence = evidenceCache.get(record.tx_hash) ?? null
      if (!evidence) {
        evidence = await opts.fetchEvidence(record.tx_hash)
        evidenceCache.set(record.tx_hash, evidence)
      }
    }

    const op = reconcileRecord(record, evidence)
    let outcome: RepairOutcome | null = null
    if (op.repair) {
      outcome = apply ? await applyRepair(opts.supabase, op, op.repair, actor) : { state: "dry_run" }
    }
    operations.push({ ...op, outcome })
  }

  const summary: Record<string, number> = {}
  for (const op of operations) summary[op.verdict] = (summary[op.verdict] ?? 0) + 1

  return { mode: apply ? "apply" : "dry-run", operations, summary }
}

/** Render a per-operation, operator-friendly line. */
export function formatOperation(op: OperationReport): string {
  const r = op.record
  const head = `[${op.verdict}] ${r.kind} ${r.id} status=${r.status} tx=${r.tx_hash ?? "-"}`
  const lines = [head, ...op.reasons.map((reason) => `    - ${reason}`)]
  if (op.repair) {
    lines.push(`    repair: ${op.repair.table} ${JSON.stringify(op.repair.expect)} -> ${JSON.stringify(op.repair.set)}`)
  }
  if (op.outcome) {
    lines.push(`    outcome: ${op.outcome.state}${"detail" in op.outcome ? ` (${op.outcome.detail})` : ""}`)
  }
  if (op.needs_manual_review) lines.push(`    ACTION: manual review required — no automatic change`)
  return lines.join("\n")
}

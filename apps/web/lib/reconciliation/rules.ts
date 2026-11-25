/**
 * Pure reconciliation rules. No I/O — given a DB row and the finalized
 * evidence for its transaction hash, decide whether they agree and, if not,
 * whether a *safe derived-state* correction exists.
 *
 * Safe corrections only move a row along the mint lifecycle to the state the
 * chain proves (pending → available/minted on SUCCESS, available/minted →
 * pending/failed on FAILED). Anything that would touch downstream business
 * state (sold/retired certificates), or that relies on ambiguous evidence
 * (NOT_FOUND, amount/recipient/contract conflicts), is reported for manual
 * review and never changed automatically.
 */

import type {
  MintEvent,
  MintRecord,
  ReconciliationResult,
  RepairPatch,
  TransactionEvidence,
  Verdict,
} from "./types"

const STROOPS_PER_UNIT = BigInt(10_000_000)

/** Convert a kWh value (REAL column) to the i128 stroop amount the mint route sends. */
export function kwhToStroops(kwh: number): bigint {
  // Mirrors apps/api/app/api/mint/route.ts: BigInt(Math.round(amountKwh * 1e7))
  return BigInt(Math.round(kwh * Number(STROOPS_PER_UNIT)))
}

const COMPLETED_STATUSES: Record<MintRecord["kind"], readonly string[]> = {
  certificate: ["available", "sold", "retired"],
  reading: ["minted"],
}

/** Certificate states that carry downstream business meaning beyond the mint itself. */
const DOWNSTREAM_CERT_STATUSES = ["sold", "retired"]

function isCompleted(record: MintRecord): boolean {
  return COMPLETED_STATUSES[record.kind].includes(record.status)
}

function result(
  record: MintRecord,
  verdict: Verdict,
  reasons: string[],
  repair: RepairPatch | null = null,
  needsManualReview = false
): ReconciliationResult {
  return { record, verdict, reasons, repair, needs_manual_review: needsManualReview }
}

function tableFor(record: MintRecord): RepairPatch["table"] {
  return record.kind === "certificate" ? "certificates" : "readings"
}

function hashColumn(record: MintRecord): "mint_tx_hash" | "tx_hash" {
  return record.kind === "certificate" ? "mint_tx_hash" : "tx_hash"
}

function patch(record: MintRecord, set: Record<string, unknown>): RepairPatch {
  return {
    table: tableFor(record),
    id: record.id,
    // Condition the update on the exact values we reconciled against so a
    // concurrent mint/retire cannot be overwritten by a stale decision.
    expect: { status: record.status, [hashColumn(record)]: record.tx_hash },
    set,
  }
}

/**
 * Check that a SUCCESS transaction actually contains the mint this row
 * describes. Returns a list of conflicts (empty = evidence matches).
 */
export function checkMintEvents(record: MintRecord, events: MintEvent[]): string[] {
  const conflicts: string[] = []
  const fromContract = events.filter((e) => e.contract_id === record.expected_contract)

  if (fromContract.length === 0) {
    const seen = [...new Set(events.map((e) => e.contract_id))]
    conflicts.push(
      seen.length === 0
        ? `transaction succeeded but emitted no mint event`
        : `no mint event from expected contract ${record.expected_contract} (saw: ${seen.join(", ")})`
    )
    return conflicts
  }

  const relevant = record.expected_recipient
    ? fromContract.filter((e) => e.to === record.expected_recipient)
    : fromContract

  if (record.expected_recipient && relevant.length === 0) {
    const seen = [...new Set(fromContract.map((e) => e.to))]
    conflicts.push(
      `mint recipient mismatch: expected ${record.expected_recipient}, chain minted to ${seen.join(", ")}`
    )
    return conflicts
  }

  if (record.expected_kwh != null) {
    const expected = kwhToStroops(record.expected_kwh)
    const actual = relevant.reduce((sum, e) => sum + BigInt(e.amount), BigInt(0))
    if (actual !== expected) {
      conflicts.push(`mint amount mismatch: expected ${expected} stroops, chain minted ${actual} stroops`)
    }
  }

  return conflicts
}

/** Evidence is final only when the reported ledger has closed. */
function isFinal(evidence: TransactionEvidence): boolean {
  if (evidence.status === "NOT_FOUND") return false
  return evidence.ledger != null && evidence.ledger <= evidence.latest_ledger
}

export function reconcileRecord(
  record: MintRecord,
  evidence: TransactionEvidence | null
): ReconciliationResult {
  const completed = isCompleted(record)

  // ---- No hash stored ------------------------------------------------------
  if (!record.tx_hash) {
    if (completed) {
      return result(
        record,
        "completed_without_hash",
        [`row is '${record.status}' but has no transaction hash to verify`],
        null,
        true
      )
    }
    return result(record, "not_submitted", ["no transaction submitted yet"])
  }

  // ---- Missing / non-final evidence ---------------------------------------
  if (!evidence || !isFinal(evidence)) {
    const reasons = [`no finalized transaction found for ${record.tx_hash}`]
    if (evidence?.oldest_ledger != null) {
      reasons.push(
        `RPC retains ledgers ${evidence.oldest_ledger}–${evidence.latest_ledger}; ` +
          `an older transaction cannot be confirmed from this endpoint — check an archive/Horizon before acting`
      )
    }
    return result(record, "missing_evidence", reasons, null, true)
  }

  if (evidence.hash !== record.tx_hash) {
    return result(
      record,
      "conflicting_evidence",
      [`evidence hash ${evidence.hash} does not match stored hash ${record.tx_hash}`],
      null,
      true
    )
  }

  // ---- Finalized FAILED -----------------------------------------------------
  if (evidence.status === "FAILED") {
    const reasons = [`transaction ${record.tx_hash} finalized as FAILED in ledger ${evidence.ledger}`]

    if (record.kind === "certificate") {
      if (DOWNSTREAM_CERT_STATUSES.includes(record.status)) {
        reasons.push(`certificate is '${record.status}'; downstream state must be reviewed manually`)
        return result(record, "conflicting_evidence", reasons, null, true)
      }
      if (record.status === "available") {
        reasons.push("revert to 'pending' and clear the failed hash so the mint can be retried")
        return result(
          record,
          "completed_but_failed",
          reasons,
          patch(record, { status: "pending", mint_tx_hash: null, token_amount: null })
        )
      }
      if (record.status === "pending") {
        reasons.push("clear the failed hash so the mint is no longer blocked as 'already submitted'")
        return result(record, "pending_but_failed", reasons, patch(record, { mint_tx_hash: null }))
      }
    } else {
      if (record.status === "failed") {
        return result(record, "consistent", reasons)
      }
      if (record.status === "minted" || record.status === "pending") {
        reasons.push("mark reading as 'failed'; the failed hash is kept as evidence")
        return result(
          record,
          record.status === "minted" ? "completed_but_failed" : "pending_but_failed",
          reasons,
          patch(record, { status: "failed" })
        )
      }
    }

    reasons.push(`unrecognised status '${record.status}'`)
    return result(record, "conflicting_evidence", reasons, null, true)
  }

  // ---- Finalized SUCCESS ----------------------------------------------------
  const conflicts = checkMintEvents(record, evidence.mint_events)
  if (conflicts.length > 0) {
    return result(record, "conflicting_evidence", conflicts, null, true)
  }

  const reasons = [`transaction ${record.tx_hash} finalized as SUCCESS in ledger ${evidence.ledger}`]

  if (completed) {
    return result(record, "consistent", reasons)
  }

  if (record.kind === "certificate" && record.status === "pending") {
    reasons.push("mark certificate 'available' with the confirmed token amount")
    return result(
      record,
      "pending_but_confirmed",
      reasons,
      patch(record, { status: "available", token_amount: record.expected_kwh })
    )
  }

  if (record.kind === "reading" && (record.status === "pending" || record.status === "failed")) {
    reasons.push("mark reading 'minted'")
    return result(record, "pending_but_confirmed", reasons, patch(record, { status: "minted" }))
  }

  reasons.push(`unrecognised status '${record.status}'`)
  return result(record, "conflicting_evidence", reasons, null, true)
}

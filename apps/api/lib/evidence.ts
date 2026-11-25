import { createHash } from "crypto"

export const EVIDENCE_VERSION = 1

export type EvidenceFields = {
  cooperative_id: string
  period_start: string
  period_end: string
  operation_id: string
  evidence_hash: string
  evidence_version: number
  evidence_ref: string
}

export function createEvidenceReference(input: {
  cooperativeId: string
  periodStart: string
  periodEnd: string
  operationId: string
  amountKwh: number
}): EvidenceFields {
  const periodStart = validateIsoDate(input.periodStart, "period_start")
  const periodEnd = validateIsoDate(input.periodEnd, "period_end")
  if (periodStart > periodEnd) {
    throw new Error("Evidence period_start must be before or equal to period_end")
  }

  // Deliberately hashes only the reviewed, non-personal operation summary.
  // Raw meter samples, member names, emails, addresses, and payloads are never included.
  const manifest = JSON.stringify({
    cooperative_id: input.cooperativeId,
    period_start: periodStart,
    period_end: periodEnd,
    operation_id: input.operationId,
    amount_kwh: input.amountKwh,
    evidence_version: EVIDENCE_VERSION,
  })
  const evidenceHash = createHash("sha256").update(manifest).digest("hex")
  const evidenceRef =
    `beenergy://evidence/v1/${encodeURIComponent(input.cooperativeId)}/` +
    `${periodStart}/${periodEnd}/${encodeURIComponent(input.operationId)}#sha256=${evidenceHash}`

  return {
    cooperative_id: input.cooperativeId,
    period_start: periodStart,
    period_end: periodEnd,
    operation_id: input.operationId,
    evidence_hash: evidenceHash,
    evidence_version: EVIDENCE_VERSION,
    evidence_ref: evidenceRef,
  }
}

function validateIsoDate(value: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Evidence ${field} must use YYYY-MM-DD`)
  }
  return value
}

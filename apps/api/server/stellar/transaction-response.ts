import { NextResponse } from "next/server"
import { auditLog, type AuditAction } from "@/lib/audit"
import { httpStatusForTxError, type StellarTransactionError } from "./transaction-service"

/**
 * Persist a structured failure reason (with tx hash when known) to audit_log for
 * reconciliation, and return a consistent JSON error response.
 */
export function transactionErrorResponse(
  err: StellarTransactionError,
  ctx: { action: AuditAction; actor: string; resourceType: string; resourceId: string }
): NextResponse {
  const failure = err.toFailureReason()

  console.error(`[stellar-tx] ${ctx.action} ${ctx.resourceType}/${ctx.resourceId} failed`, failure)

  auditLog({
    action: ctx.action,
    actor: ctx.actor,
    resource_type: ctx.resourceType,
    resource_id: ctx.resourceId,
    details: { outcome: "failed", failure },
  })

  return NextResponse.json(
    {
      error: failure.submitted
        ? `${failure.message} Check transaction ${failure.tx_hash} before retrying.`
        : failure.message,
      code: failure.code,
      tx_hash: failure.tx_hash,
      submitted: failure.submitted,
      retryable: failure.retryable,
    },
    { status: httpStatusForTxError(err) }
  )
}

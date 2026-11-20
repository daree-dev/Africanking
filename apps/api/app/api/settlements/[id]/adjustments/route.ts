import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"
import { requireAuth, isSession } from "@/lib/auth/middleware"
import { validateBody } from "@/lib/validation/validate"
import { createSettlementAdjustmentSchema } from "@/lib/validation/schemas"
import { safeDbError, safeCatchError } from "@/lib/errors/safe-error"

/**
 * POST /api/settlements/:id/adjustments
 *
 * Record a correction to a member's allocation inside a settlement period.
 * - Transitions the settlement to "corrected" and bumps allocation_version.
 * - Guards against double-counting: the previous_kwh snapshot is taken from
 *   the most recent allocation row so the correction trail is auditable.
 * - Closed settlements are immutable.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth()
    if (!isSession(session)) return session

    const { id: settlementId } = await params

    const body = await req.json()
    const v = validateBody(createSettlementAdjustmentSchema, body)
    if (!v.success) return v.response

    const { member_stellar_address, corrected_kwh, reason } = v.data

    // Load settlement
    const { data: period, error: periodError } = await supabase
      .from("settlement_periods")
      .select("cooperative_id, status, allocation_version")
      .eq("id", settlementId)
      .single()

    if (periodError || !period) {
      return NextResponse.json({ error: "Settlement not found" }, { status: 404 })
    }

    if (!session.admin_cooperative_ids.includes(period.cooperative_id) && !session.is_super_admin) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }

    if (period.status === "closed") {
      return NextResponse.json({ error: "Closed settlements cannot be adjusted" }, { status: 409 })
    }

    // Find the current allocation for this member (no-double-counting guard)
    const { data: currentAlloc } = await supabase
      .from("member_allocations")
      .select("id, allocated_kwh, allocation_version")
      .eq("settlement_id", settlementId)
      .eq("member_stellar_address", member_stellar_address)
      .order("allocation_version", { ascending: false })
      .limit(1)
      .single()

    const previousKwh = currentAlloc?.allocated_kwh ?? 0
    const newVersion = (period.allocation_version ?? 1) + 1

    // Insert adjustment record
    const { data: adjustment, error: adjError } = await supabase
      .from("settlement_adjustments")
      .insert({
        settlement_id: settlementId,
        member_stellar_address,
        previous_kwh: previousKwh,
        corrected_kwh,
        reason,
        applied_by: session.stellar_address,
        applied_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (adjError) return safeDbError(adjError)

    // Insert new versioned allocation row (keeps full history; no row is deleted)
    await supabase.from("member_allocations").insert({
      settlement_id: settlementId,
      member_stellar_address,
      allocation_version: newVersion,
      allocated_kwh: corrected_kwh,
      allocation_share: null, // recalculated by cooperative admin tooling
      adjustment_reference: adjustment.id,
      adjustment_reason: reason,
    })

    // Bump settlement to "corrected" and increment allocation_version
    await supabase
      .from("settlement_periods")
      .update({
        status: "corrected",
        allocation_version: newVersion,
        approved_by: session.stellar_address,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", settlementId)

    return NextResponse.json({ adjustment }, { status: 201 })
  } catch (err) {
    return safeCatchError(err)
  }
}

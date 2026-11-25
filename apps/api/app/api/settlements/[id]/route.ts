import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"
import { requireAuth, isSession } from "@/lib/auth/middleware"
import { validateBody } from "@/lib/validation/validate"
import { updateSettlementStatusSchema } from "@/lib/validation/schemas"
import { safeDbError, safeCatchError } from "@/lib/errors/safe-error"

/**
 * GET  /api/settlements/:id
 * Full detail: period metadata, source readings snapshot, member allocations,
 * energy credits, and adjustment trail.
 *
 * PATCH /api/settlements/:id
 * Transition settlement status (pending → approved, etc.) and record approver.
 * Settlement status is stored independently of on-chain credit status.
 */

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth()
    if (!isSession(session)) return session

    const { id } = await params

    const { data: period, error: periodError } = await supabase
      .from("settlement_periods")
      .select("*")
      .eq("id", id)
      .single()

    if (periodError || !period) {
      return NextResponse.json({ error: "Settlement not found" }, { status: 404 })
    }

    // Authorisation: member or admin of the cooperative
    const isMember = session.cooperative_ids.includes(period.cooperative_id)
    const isAdmin = session.admin_cooperative_ids.includes(period.cooperative_id)
    if (!isMember && !isAdmin && !session.is_super_admin) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }

    // Source readings snapshot
    const { data: sourceReadings } = await supabase
      .from("settlement_source_readings")
      .select("*")
      .eq("settlement_id", id)
      .order("source_timestamp", { ascending: true })

    // Member allocations (versioned)
    const { data: allocations } = await supabase
      .from("member_allocations")
      .select("*")
      .eq("settlement_id", id)
      .order("member_stellar_address")

    // Energy credits — explicitly not monetary invoice amounts
    const { data: energyCredits } = await supabase
      .from("energy_credits")
      .select("id, settlement_id, member_stellar_address, cooperative_id, credit_kwh, token_units, mint_tx_hash, onchain_status, credit_type, created_at")
      .eq("settlement_id", id)

    // Adjustment / correction trail
    const { data: adjustments } = await supabase
      .from("settlement_adjustments")
      .select("*")
      .eq("settlement_id", id)
      .order("applied_at", { ascending: true })

    return NextResponse.json({
      settlement: period,
      source_readings: sourceReadings ?? [],
      allocations: allocations ?? [],
      /**
       * energy_credits represent kWh assigned to members, NOT monetary amounts.
       * See EnergyCredit type in lib/types/settlement.ts.
       */
      energy_credits: energyCredits ?? [],
      adjustments: adjustments ?? [],
    })
  } catch (err) {
    return safeCatchError(err)
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth()
    if (!isSession(session)) return session

    const { id } = await params

    const body = await req.json()
    const v = validateBody(updateSettlementStatusSchema, body)
    if (!v.success) return v.response

    const { status, approved_by } = v.data

    const { data: period, error: fetchError } = await supabase
      .from("settlement_periods")
      .select("cooperative_id, status, allocation_version")
      .eq("id", id)
      .single()

    if (fetchError || !period) {
      return NextResponse.json({ error: "Settlement not found" }, { status: 404 })
    }

    if (!session.admin_cooperative_ids.includes(period.cooperative_id) && !session.is_super_admin) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }

    if (period.status === "closed") {
      return NextResponse.json({ error: "Closed settlements cannot be modified" }, { status: 409 })
    }

    // Bump allocation_version on correction
    const allocationVersion =
      status === "corrected"
        ? (period.allocation_version ?? 1) + 1
        : period.allocation_version

    const updatePayload: Record<string, unknown> = {
      status,
      allocation_version: allocationVersion,
      updated_at: new Date().toISOString(),
    }

    if (status === "approved" || status === "corrected") {
      updatePayload.approved_by = approved_by ?? null
      updatePayload.approved_at = new Date().toISOString()
    }

    const { data, error: updateError } = await supabase
      .from("settlement_periods")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .single()

    if (updateError) return safeDbError(updateError)

    return NextResponse.json({ settlement: data })
  } catch (err) {
    return safeCatchError(err)
  }
}

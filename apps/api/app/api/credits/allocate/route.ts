import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"
import { requireAuth, isSession } from "@/lib/auth/middleware"
import { validateBody } from "@/lib/validation/validate"
import { allocateCreditSchema } from "@/lib/validation/schemas"
import { safeDbError, safeCatchError } from "@/lib/errors/safe-error"
import { auditLog } from "@/lib/audit"
import { AllocationError, computeAllocation, deriveCreditStatus } from "@/lib/credits/domain"

/**
 * POST: cooperative admin — allocate an issued generation credit to the
 * cooperative's members by share. Internal workflow only: there is no buyer,
 * no purpose and no on-chain burn.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth()
    if (!isSession(session)) return session

    const body = await req.json()
    const v = validateBody(allocateCreditSchema, body)
    if (!v.success) return v.response
    const { certificate_id, basis } = v.data

    const { data: credit, error: creditError } = await supabase
      .from("certificates")
      .select("*")
      .eq("id", certificate_id)
      .single()

    if (creditError || !credit) {
      return NextResponse.json({ error: "Credit not found" }, { status: 404 })
    }

    if (!session.admin_cooperative_ids.includes(credit.cooperative_id)) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 })
    }

    // Strict read: an error here must not be mistaken for "not yet allocated".
    const { data: existing, error: existingError } = await supabase
      .from("credit_allocations")
      .select("id")
      .eq("certificate_id", certificate_id)
    if (existingError) return safeDbError(existingError)

    const status = deriveCreditStatus(credit, existing?.length ?? 0)
    if (status === "legacy") {
      return NextResponse.json({ error: "Legacy credits are read-only" }, { status: 409 })
    }
    if (status === "pending_issuance") {
      return NextResponse.json({ error: "Credit must be issued on-chain before allocation" }, { status: 409 })
    }
    if (status === "allocated") {
      return NextResponse.json({ error: "Credit is already allocated" }, { status: 409 })
    }

    const { data: members, error: membersError } = await supabase
      .from("prosumers")
      .select("id, stellar_address, name, panel_capacity_kw")
      .eq("cooperative_id", credit.cooperative_id)
    if (membersError) return safeDbError(membersError)

    let plan
    try {
      plan = computeAllocation(
        credit.token_amount ?? credit.total_kwh,
        (members ?? []).map((m) => ({ ...m, prosumer_id: m.id })),
        basis,
      )
    } catch (err) {
      if (err instanceof AllocationError) {
        return NextResponse.json({ error: err.message, details: err.details }, { status: 400 })
      }
      throw err
    }

    const { data: inserted, error: insertError } = await supabase
      .from("credit_allocations")
      .insert(
        plan.rows.map((row) => ({
          certificate_id,
          cooperative_id: credit.cooperative_id,
          member_stellar_address: row.stellar_address,
          prosumer_id: row.prosumer_id,
          basis: plan.basis,
          share_version: plan.share_version,
          share_percent: row.share_percent,
          kwh_allocated: row.kwh_allocated,
          allocated_by: session.sub,
        }))
      )
      .select()
    if (insertError) return safeDbError(insertError)

    auditLog({
      action: "allocate_credit",
      actor: session.sub,
      resource_type: "certificate",
      resource_id: certificate_id,
      details: { basis: plan.basis, share_version: plan.share_version, members: plan.rows.length, total_kwh: plan.total_kwh },
    })

    return NextResponse.json(
      {
        certificate_id,
        basis: plan.basis,
        share_version: plan.share_version,
        total_kwh: plan.total_kwh,
        allocations: inserted ?? [],
      },
      { status: 201 }
    )
  } catch (err) {
    return safeCatchError(err)
  }
}

import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"
import { requireAuth, isSession } from "@/lib/auth/middleware"
import { validateBody } from "@/lib/validation/validate"
import { createSettlementPeriodSchema } from "@/lib/validation/schemas"
import { safeDbError, safeCatchError } from "@/lib/errors/safe-error"

/**
 * GET  /api/settlements?cooperative_id=<uuid>
 * List settlement periods for a cooperative.
 *
 * POST /api/settlements
 * Open a new draft settlement period.
 */

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth()
    if (!isSession(session)) return session

    const cooperativeId = req.nextUrl.searchParams.get("cooperative_id")
    if (!cooperativeId) {
      return NextResponse.json({ error: "cooperative_id is required" }, { status: 400 })
    }

    const { data, error } = await supabase
      .from("settlement_periods")
      .select(`
        id,
        cooperative_id,
        period_start,
        period_end,
        allocation_version,
        status,
        approved_by,
        approved_at,
        created_at,
        updated_at
      `)
      .eq("cooperative_id", cooperativeId)
      .order("period_start", { ascending: false })

    if (error) return safeDbError(error)

    return NextResponse.json({ settlements: data })
  } catch (err) {
    return safeCatchError(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth()
    if (!isSession(session)) return session

    const body = await req.json()
    const v = validateBody(createSettlementPeriodSchema, body)
    if (!v.success) return v.response

    const { cooperative_id, period_start, period_end } = v.data

    // Only cooperative admins may open a settlement
    if (!session.admin_cooperative_ids.includes(cooperative_id)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }

    // Reject overlapping non-closed periods
    const { data: existing } = await supabase
      .from("settlement_periods")
      .select("id, status")
      .eq("cooperative_id", cooperative_id)
      .neq("status", "closed")
      .lte("period_start", period_end)
      .gte("period_end", period_start)
      .limit(1)

    if (existing && existing.length > 0) {
      return NextResponse.json(
        { error: "An open settlement period already overlaps this date range" },
        { status: 409 }
      )
    }

    const { data, error } = await supabase
      .from("settlement_periods")
      .insert({
        cooperative_id,
        period_start,
        period_end,
        allocation_version: 1,
        status: "draft",
        approved_by: null,
        approved_at: null,
      })
      .select()
      .single()

    if (error) return safeDbError(error)

    return NextResponse.json({ settlement: data }, { status: 201 })
  } catch (err) {
    return safeCatchError(err)
  }
}

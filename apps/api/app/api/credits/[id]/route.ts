/**
 * Issue #8 — Credit state transition endpoint.
 *
 * PATCH /api/credits/:id
 *   Advances a credit through its lifecycle.  Only permitted transitions
 *   are accepted.  Each transition requires cooperative admin access.
 *
 * GET /api/credits/:id
 *   Returns full credit detail including allocation provenance.
 */

import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"
import { requireAdmin, requireAuth, isSession } from "@/lib/auth/middleware"
import { validateBody } from "@/lib/validation/validate"
import { z } from "zod"
import { safeDbError, safeCatchError } from "@/lib/errors/safe-error"
import {
  assertValidCreditTransition,
  CreditLifecycleError,
  type CreditState,
} from "@/lib/domain/credit-lifecycle"

const transitionSchema = z.object({
  state: z.enum(["validated", "allocated", "settled", "cancelled"]),
  notes: z.string().max(1000).nullish(),
})

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const { data: credit, error } = await supabase
      .from("credits")
      .select("*, allocations:credit_allocations(*)")
      .eq("id", id)
      .single()

    if (error || !credit) {
      return NextResponse.json({ error: "Credit not found" }, { status: 404 })
    }

    return NextResponse.json(credit)
  } catch (err) {
    return safeCatchError(err)
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const body = await req.json()
    const v = validateBody(transitionSchema, body)
    if (!v.success) return v.response

    // Fetch current credit state
    const { data: credit, error: fetchError } = await supabase
      .from("credits")
      .select("id, cooperative_id, state")
      .eq("id", id)
      .single()

    if (fetchError || !credit) {
      return NextResponse.json({ error: "Credit not found" }, { status: 404 })
    }

    const session = await requireAdmin(credit.cooperative_id)
    if (!isSession(session)) return session

    // Validate the state transition
    try {
      assertValidCreditTransition(credit.state as CreditState, v.data.state)
    } catch (err) {
      if (err instanceof CreditLifecycleError) {
        return NextResponse.json({ error: err.message }, { status: 400 })
      }
      throw err
    }

    const updatePayload: Record<string, unknown> = {
      state: v.data.state,
      updated_by: session.sub,
      updated_at: new Date().toISOString(),
    }
    if (v.data.notes) {
      updatePayload.notes = v.data.notes
    }
    if (v.data.state === "validated") {
      updatePayload.validated_at = new Date().toISOString()
      updatePayload.validated_by = session.sub
    }

    const { data: updated, error: updateError } = await supabase
      .from("credits")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .single()

    if (updateError) return safeDbError(updateError)

    return NextResponse.json(updated)
  } catch (err) {
    return safeCatchError(err)
  }
}

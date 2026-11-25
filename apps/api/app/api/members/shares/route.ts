/**
 * Issue #5 — Member share version API.
 *
 * GET  /api/members/shares?member_id=…&cooperative_id=…
 *   Returns all share versions for a member, ordered by effective_from.
 *   Requires the caller to be a member of the cooperative.
 *
 * POST /api/members/shares
 *   Creates a new effective-dated share version for a member.
 *   Requires cooperative admin.  Validates that the total active shares across
 *   all members do not exceed 100 % before persisting.
 *   Automatically closes the previous open-ended version for the same member.
 */

import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"
import { requireAdmin, requireAuth, isSession } from "@/lib/auth/middleware"
import { validateBody } from "@/lib/validation/validate"
import { z } from "zod"
import { safeDbError, safeCatchError } from "@/lib/errors/safe-error"
import {
  validateShareTotal,
  computeEffectiveUntil,
  type MemberShareVersion,
} from "@/lib/domain/member-shares"

const createShareVersionSchema = z.object({
  member_id: z.string().uuid(),
  cooperative_id: z.string().uuid(),
  share_percentage: z
    .number()
    .gt(0, "share_percentage must be greater than 0")
    .lte(100, "share_percentage cannot exceed 100")
    .transform((v) => Math.round(v * 100) / 100),
  effective_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "effective_from must be YYYY-MM-DD"),
})

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth()
    if (!isSession(session)) return session

    const { searchParams } = new URL(req.url)
    const memberId = searchParams.get("member_id")
    const cooperativeId = searchParams.get("cooperative_id")

    if (!memberId || !cooperativeId) {
      return NextResponse.json(
        { error: "member_id and cooperative_id are required" },
        { status: 400 }
      )
    }

    if (!session.cooperative_ids.includes(cooperativeId)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }

    const { data, error } = await supabase
      .from("member_shares")
      .select("*")
      .eq("member_id", memberId)
      .eq("cooperative_id", cooperativeId)
      .order("effective_from", { ascending: true })

    if (error) return safeDbError(error)

    return NextResponse.json(data ?? [])
  } catch (err) {
    return safeCatchError(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const v = validateBody(createShareVersionSchema, body)
    if (!v.success) return v.response

    const { member_id, cooperative_id, share_percentage, effective_from } = v.data

    const session = await requireAdmin(cooperative_id)
    if (!isSession(session)) return session

    // Verify the member belongs to this cooperative
    const { data: member, error: memberError } = await supabase
      .from("prosumers")
      .select("id")
      .eq("id", member_id)
      .eq("cooperative_id", cooperative_id)
      .single()

    if (memberError || !member) {
      return NextResponse.json(
        { error: "Member not found in this cooperative" },
        { status: 404 }
      )
    }

    // Find the current open-ended version for this member (to close it)
    const { data: activeVersions, error: avErr } = await supabase
      .from("member_shares")
      .select("*")
      .eq("member_id", member_id)
      .eq("cooperative_id", cooperative_id)
      .is("effective_until", null)
      .order("effective_from", { ascending: false })
      .limit(1)

    if (avErr) return safeDbError(avErr)

    const previousActive = activeVersions?.[0] as MemberShareVersion | undefined

    // Validate that effective_from is not before the previous version's effective_from
    if (previousActive && effective_from <= previousActive.effective_from) {
      return NextResponse.json(
        {
          error: `New effective_from (${effective_from}) must be after the current version's effective_from (${previousActive.effective_from})`,
        },
        { status: 400 }
      )
    }

    // Fetch all other members' currently active shares to validate the total
    const { data: otherMemberShares, error: omsErr } = await supabase
      .from("member_shares")
      .select("member_id, share_percentage")
      .eq("cooperative_id", cooperative_id)
      .neq("member_id", member_id)
      .is("effective_until", null)

    if (omsErr) return safeDbError(omsErr)

    const allActiveShares = [
      ...(otherMemberShares ?? []),
      { member_id, share_percentage },
    ]

    const { valid, total, excess } = validateShareTotal(allActiveShares)
    if (!valid) {
      return NextResponse.json(
        {
          error: `Total active share percentage would be ${total.toFixed(2)} %, exceeding the 100 % cooperative cap by ${excess.toFixed(2)} %.`,
        },
        { status: 400 }
      )
    }

    // Close the previous open-ended version
    if (previousActive) {
      const { closeDate } = computeEffectiveUntil(previousActive, effective_from)
      const { error: closeErr } = await supabase
        .from("member_shares")
        .update({ effective_until: closeDate })
        .eq("id", previousActive.id)

      if (closeErr) return safeDbError(closeErr)
    }

    // Insert the new version
    const { data: newVersion, error: insertErr } = await supabase
      .from("member_shares")
      .insert({
        member_id,
        cooperative_id,
        share_percentage,
        effective_from,
        effective_until: null,
        created_by: session.sub,
      })
      .select()
      .single()

    if (insertErr) return safeDbError(insertErr)

    return NextResponse.json(newVersion, { status: 201 })
  } catch (err) {
    return safeCatchError(err)
  }
}

import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"
import { requireAuth, isSession } from "@/lib/auth/middleware"
import { safeCatchError } from "@/lib/errors/safe-error"
import { fetchAllocations } from "@/lib/credits/allocations-repo"

// GET: members of the credit's cooperative — per-member allocation rows.
export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth()
    if (!isSession(session)) return session

    const certificateId = new URL(req.url).searchParams.get("certificate_id")
    if (!certificateId) {
      return NextResponse.json({ error: "certificate_id required" }, { status: 400 })
    }

    const { data: credit } = await supabase
      .from("certificates")
      .select("id, cooperative_id")
      .eq("id", certificateId)
      .single()
    if (!credit) return NextResponse.json({ error: "Credit not found" }, { status: 404 })

    if (!session.cooperative_ids.includes(credit.cooperative_id)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }

    return NextResponse.json(await fetchAllocations({ certificateIds: [certificateId] }))
  } catch (err) {
    return safeCatchError(err)
  }
}

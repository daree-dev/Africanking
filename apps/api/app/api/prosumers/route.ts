import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"
import { requireAuth, requireAdmin, isSession } from "@/lib/auth/middleware"
import { validateBody } from "@/lib/validation/validate"
import { createMemberSchema } from "@/lib/validation/schemas"
import { safeDbError, safeCatchError } from "@/lib/errors/safe-error"

const DEPRECATION_HEADERS = {
  Deprecation: "true",
  Sunset: "Wed, 31 Dec 2026 23:59:59 GMT",
  Link: '</api/members>; rel="successor-version"',
  Warning: '299 - "The /api/prosumers endpoint is deprecated. Use /api/members instead."',
}

// GET: authenticated, scoped to caller's cooperatives (deprecated: use /api/members)
export async function GET(req: NextRequest) {
  const session = await requireAuth()
  if (!isSession(session)) return session

  const { searchParams } = new URL(req.url)
  const cooperativeId = searchParams.get("cooperative_id")

  let query = supabase
    .from("prosumers")
    .select("*")
    .order("created_at", { ascending: false })

  if (cooperativeId) {
    if (!session.cooperative_ids.includes(cooperativeId)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403, headers: DEPRECATION_HEADERS })
    }
    query = query.eq("cooperative_id", cooperativeId)
  } else {
    if (session.cooperative_ids.length > 0) {
      query = query.in("cooperative_id", session.cooperative_ids)
    } else {
      return NextResponse.json([], { headers: DEPRECATION_HEADERS })
    }
  }

  const { data, error } = await query
  if (error) return safeDbError(error)

  return NextResponse.json(data, { headers: DEPRECATION_HEADERS })
}

// POST: admin — adds member to cooperative (deprecated: use /api/members)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const v = validateBody(createMemberSchema, body)
    if (!v.success) return v.response

    const session = await requireAdmin(v.data.cooperative_id)
    if (!isSession(session)) return session

    const { data, error } = await supabase
      .from("prosumers")
      .insert({
        stellar_address: v.data.stellar_address,
        cooperative_id: v.data.cooperative_id,
        name: v.data.name ?? null,
        panel_capacity_kw: v.data.panel_capacity_kw ?? null,
        role: v.data.role,
      })
      .select()
      .single()

    if (error) return safeDbError(error)

    return NextResponse.json(data, { status: 201, headers: DEPRECATION_HEADERS })
  } catch (err) {
    return safeCatchError(err)
  }
}

import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"
import { requireMember, isSession } from "@/lib/auth/middleware"
import { safeCatchError } from "@/lib/errors/safe-error"
import { getStellarConfigReport } from "@/server/stellar/network-config"

const EVENT_ID_RE = /^[0-9]{1,30}-[0-9]{1,15}$/
const TYPE_RE = /^[a-z_]{1,32}$/

// GET: cooperative member — read-only indexed on-chain history for this cooperative
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const session = await requireMember(id)
    if (!isSession(session)) return session

    const { searchParams } = new URL(req.url)
    const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 50, 1), 200)
    const before = searchParams.get("before")
    const type = searchParams.get("type")

    if (before && !EVENT_ID_RE.test(before)) {
      return NextResponse.json({ error: "Invalid 'before' cursor" }, { status: 400 })
    }
    if (type && !TYPE_RE.test(type)) {
      return NextResponse.json({ error: "Invalid 'type' filter" }, { status: 400 })
    }

    const network = getStellarConfigReport().network ?? "TESTNET"

    let query = supabase
      .from("chain_events")
      .select(
        "event_id, network, contract_id, ledger, ledger_closed_at, tx_hash, event_type, topics, value, in_successful_contract_call"
      )
      .eq("cooperative_id", id)
      .eq("network", network)
      .order("event_id", { ascending: false })
      .limit(limit)

    if (before) query = query.lt("event_id", before)
    if (type) query = query.eq("event_type", type)

    const { data, error } = await query
    if (error) {
      return NextResponse.json({ error: "Failed to fetch events" }, { status: 500 })
    }

    const events = data ?? []
    return NextResponse.json({
      events,
      next_before: events.length === limit ? events[events.length - 1].event_id : null,
    })
  } catch (err) {
    return safeCatchError(err)
  }
}

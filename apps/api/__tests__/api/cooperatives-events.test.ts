import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const COOP_ID = "00000000-0000-0000-0000-000000000001"
const OTHER_COOP = "00000000-0000-0000-0000-000000000009"

const { mockFrom, calls, result } = vi.hoisted(() => {
  const calls: [string, ...unknown[]][] = []
  const result = { data: [] as unknown[], error: null as unknown }
  const builder: Record<string, unknown> = {}
  for (const m of ["select", "eq", "order", "limit", "lt"]) {
    builder[m] = (...args: unknown[]) => {
      calls.push([m, ...args])
      return builder
    }
  }
  builder.then = (resolve: (v: unknown) => void) => resolve(result)
  const mockFrom = vi.fn((table: string) => {
    calls.push(["from", table])
    return builder
  })
  return { mockFrom, calls, result }
})

vi.mock("@/lib/supabase", () => ({ supabase: { from: mockFrom } }))

vi.mock("@/lib/auth/middleware", () => ({
  requireMember: vi.fn(async (coopId: string) =>
    coopId === COOP_ID
      ? { sub: "GMEMBER", cooperative_ids: [COOP_ID], admin_cooperative_ids: [] }
      : NextResponse.json({ error: "Access denied" }, { status: 403 })
  ),
  isSession: (r: unknown) => !(r instanceof NextResponse),
}))

vi.mock("@/server/stellar/network-config", () => ({
  getStellarConfigReport: () => ({ network: "TESTNET" }),
}))

import { GET } from "@/app/api/cooperatives/[id]/events/route"

const call = (id: string, qs = "") =>
  GET(new NextRequest(`http://localhost/api/cooperatives/${id}/events${qs}`), { params: Promise.resolve({ id }) })

describe("GET /api/cooperatives/[id]/events", () => {
  beforeEach(() => {
    calls.length = 0
    result.data = []
    result.error = null
  })

  it("denies non-members → 403", async () => {
    const res = await call(OTHER_COOP)
    expect(res.status).toBe(403)
    expect(mockFrom).not.toHaveBeenCalledWith("chain_events")
  })

  it("returns cooperative- and network-scoped events with a pagination cursor", async () => {
    result.data = [{ event_id: "0000000000004096000-0000000002" }, { event_id: "0000000000004096000-0000000001" }]
    const res = await call(COOP_ID, "?limit=2&type=mint&before=0000000000008192000-0000000001")
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.events).toHaveLength(2)
    expect(json.next_before).toBe("0000000000004096000-0000000001")
    expect(calls).toContainEqual(["eq", "cooperative_id", COOP_ID])
    expect(calls).toContainEqual(["eq", "network", "TESTNET"])
    expect(calls).toContainEqual(["eq", "event_type", "mint"])
    expect(calls).toContainEqual(["lt", "event_id", "0000000000008192000-0000000001"])
  })

  it("rejects malformed cursors and filters → 400", async () => {
    expect((await call(COOP_ID, "?before=abc")).status).toBe(400)
    expect((await call(COOP_ID, "?type=DROP%20TABLE")).status).toBe(400)
  })
})

import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const { mockRun } = vi.hoisted(() => ({ mockRun: vi.fn() }))
vi.mock("@/server/stellar/run-indexer", () => ({ runConfiguredIndexer: mockRun }))

import { GET, POST } from "@/app/api/indexer/run/route"

const req = (auth?: string, qs = "") =>
  new NextRequest(`http://localhost/api/indexer/run${qs}`, {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
  })

describe("/api/indexer/run", () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv, INDEXER_CRON_SECRET: "test-cron-secret" }
    mockRun.mockResolvedValue({ inserted: 3, gapsDetected: [] })
  })

  it("rejects missing or wrong secrets → 401", async () => {
    expect((await POST(req())).status).toBe(401)
    expect((await POST(req("Bearer nope"))).status).toBe(401)
    expect(mockRun).not.toHaveBeenCalled()
  })

  it("is disabled when no secret is configured", async () => {
    delete process.env.INDEXER_CRON_SECRET
    delete process.env.CRON_SECRET
    expect((await GET(req("Bearer "))).status).toBe(401)
  })

  it("runs one bounded ingestion pass with the right secret", async () => {
    const res = await GET(req("Bearer test-cron-secret", "?backfill_gaps=true"))
    expect(res.status).toBe(200)
    expect(mockRun).toHaveBeenCalledWith({ backfillGaps: true })
  })
})

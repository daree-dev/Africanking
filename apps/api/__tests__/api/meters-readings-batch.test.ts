/**
 * Tests for issue #13 (per-item validation / partial batch outcomes)
 * and issue #14 (timestamp normalization and interval integrity).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const ADDR = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
const COOP_ID = "00000000-0000-0000-0000-000000000001"
const METER_ID = "00000000-0000-0000-0000-000000000004"

// ------------------------------------------------------------------ mocks ---

const mockSingle = vi.hoisted(() => vi.fn())
const mockSelectFn = vi.hoisted(() => vi.fn())
const mockInsertFn = vi.hoisted(() => vi.fn())
const mockFromFn = vi.hoisted(() => vi.fn())

vi.mock("@/lib/supabase", () => ({
  supabase: { from: mockFromFn },
}))

vi.mock("@/lib/auth/middleware", () => ({
  requireAuth: vi.fn(async () => ({
    sub: ADDR,
    cooperative_ids: [COOP_ID],
    admin_cooperative_ids: [COOP_ID],
  })),
  isSession: vi.fn(() => true),
}))

import { POST } from "@/app/api/meters/readings/route"

// ---------------------------------------------------------------- helpers ---

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/meters/readings", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

/** Meter stub that is active and belongs to COOP_ID */
const activeMeter = { id: METER_ID, cooperative_id: COOP_ID, status: "active" }

/** Set up mockFromFn so the first call (meter lookup) returns `meterData`,
 *  and subsequent calls (idempotency check + insert) are handled by their
 *  respective mocks passed in. */
function setupMocks(opts: {
  meterData: { data: unknown; error: unknown } | null
  /**
   * Array of [idempotencyResult, insertResult] pairs, one per accepted item.
   * Each is { data, error }.
   */
  perItem?: Array<[{ data: unknown; error: unknown }, { data: unknown; error: unknown }]>
}) {
  let callCount = 0

  mockFromFn.mockImplementation(() => {
    callCount++
    if (callCount === 1) {
      // Meter lookup
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue(opts.meterData),
          })),
        })),
      }
    }

    // Subsequent calls: alternate between idempotency check and insert
    const pairIndex = Math.floor((callCount - 2) / 2)
    const isIdempotencyCheck = (callCount - 2) % 2 === 0
    const pair = opts.perItem?.[pairIndex]

    if (!pair) {
      // Fallback: no duplicate, insert succeeds with generated id
      if (isIdempotencyCheck) {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({ data: null, error: null }),
              })),
            })),
          })),
        }
      }
      return {
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({ data: { id: `r-${pairIndex}` }, error: null }),
          })),
        })),
      }
    }

    if (isIdempotencyCheck) {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue(pair[0]),
            })),
          })),
        })),
      }
    }

    return {
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue(pair[1]),
        })),
      })),
    }
  })
}

// -----------------------------------------------------------------  tests ---

describe("POST /api/meters/readings — per-item validation (#13)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("rejects missing meter_id → 400", async () => {
    const res = await POST(makeRequest({ readings: [{ kwh_injected: 1 }] }))
    expect(res.status).toBe(400)
  })

  it("rejects empty readings array → 400", async () => {
    const res = await POST(makeRequest({ meter_id: METER_ID, readings: [] }))
    expect(res.status).toBe(400)
  })

  it("rejects meter not found → 404", async () => {
    setupMocks({ meterData: { data: null, error: { message: "not found" } } })
    const res = await POST(
      makeRequest({
        meter_id: METER_ID,
        readings: [{ kwh_injected: 1, reading_timestamp: "2025-01-01T12:00:00Z" }],
      })
    )
    expect(res.status).toBe(404)
  })

  it("rejects inactive meter → 400", async () => {
    setupMocks({
      meterData: {
        data: { id: METER_ID, cooperative_id: COOP_ID, status: "maintenance" },
        error: null,
      },
    })
    const res = await POST(
      makeRequest({
        meter_id: METER_ID,
        readings: [{ kwh_injected: 1, reading_timestamp: "2025-01-01T12:00:00Z" }],
      })
    )
    expect(res.status).toBe(400)
  })

  it("accepts valid batch entirely → 201 with accepted === 2, rejected === 0", async () => {
    setupMocks({
      meterData: { data: activeMeter, error: null },
      perItem: [
        [
          { data: null, error: null },
          { data: { id: "r-0", kwh_generated: 1.5 }, error: null },
        ],
        [
          { data: null, error: null },
          { data: { id: "r-1", kwh_generated: 2.0 }, error: null },
        ],
      ],
    })
    const res = await POST(
      makeRequest({
        meter_id: METER_ID,
        readings: [
          { kwh_injected: 1.5, reading_timestamp: "2025-01-01T12:00:00Z" },
          { kwh_injected: 2.0, reading_timestamp: "2025-01-01T12:15:00Z" },
        ],
      })
    )
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.accepted).toBe(2)
    expect(json.rejected).toBe(0)
    expect(json.partial).toBe(false)
    expect(json.items.accepted).toHaveLength(2)
    expect(json.items.rejected).toHaveLength(0)
  })

  it("partial batch: valid items accepted, invalid items rejected → 207", async () => {
    // Item 0: valid; Item 1: missing kwh (invalid); Item 2: valid
    setupMocks({
      meterData: { data: activeMeter, error: null },
      perItem: [
        [
          { data: null, error: null },
          { data: { id: "r-0", kwh_generated: 1.5 }, error: null },
        ],
        [
          { data: null, error: null },
          { data: { id: "r-2", kwh_generated: 3.0 }, error: null },
        ],
      ],
    })
    const res = await POST(
      makeRequest({
        meter_id: METER_ID,
        readings: [
          { kwh_injected: 1.5, reading_timestamp: "2025-01-01T12:00:00Z" },
          // Invalid: no kwh at all
          { reading_timestamp: "2025-01-01T12:15:00Z" },
          { kwh_injected: 3.0, reading_timestamp: "2025-01-01T12:30:00Z" },
        ],
      })
    )
    expect(res.status).toBe(207)
    const json = await res.json()
    expect(json.accepted).toBe(2)
    expect(json.rejected).toBe(1)
    expect(json.partial).toBe(true)
    // Rejected item must carry its index and an error message
    expect(json.items.rejected[0].index).toBe(1)
    expect(json.items.rejected[0].errors[0]).toMatch(/kwh_injected or kwh_generated required/)
    // Accepted items expose their ids
    expect(json.items.accepted[0].index).toBe(0)
    expect(json.items.accepted[1].index).toBe(2)
  })

  it("all-invalid batch → 422", async () => {
    setupMocks({ meterData: { data: activeMeter, error: null } })
    const res = await POST(
      makeRequest({
        meter_id: METER_ID,
        readings: [
          { reading_timestamp: "2025-01-01T12:00:00Z" }, // no kwh
          { reading_timestamp: "2025-01-01T12:15:00Z" }, // no kwh
        ],
      })
    )
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.accepted).toBe(0)
    expect(json.rejected).toBe(2)
  })

  it("idempotent duplicate returns accepted with existing id", async () => {
    setupMocks({
      meterData: { data: activeMeter, error: null },
      perItem: [
        // Idempotency check finds existing record
        [{ data: { id: "existing-r-0" }, error: null }, { data: null, error: null }],
      ],
    })
    const res = await POST(
      makeRequest({
        meter_id: METER_ID,
        readings: [{ kwh_injected: 1.5, reading_timestamp: "2025-01-01T12:00:00Z" }],
      })
    )
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.accepted).toBe(1)
    expect(json.items.accepted[0].id).toBe("existing-r-0")
  })
})

describe("POST /api/meters/readings — timestamp integrity (#14)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("rejects future timestamp per-item", async () => {
    setupMocks({ meterData: { data: activeMeter, error: null } })
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    const res = await POST(
      makeRequest({
        meter_id: METER_ID,
        readings: [{ kwh_injected: 1.5, reading_timestamp: future }],
      })
    )
    // All-invalid → 422
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.items.rejected[0].errors[0]).toMatch(/future/)
  })

  it("rejects duplicate timestamp within the same batch", async () => {
    setupMocks({
      meterData: { data: activeMeter, error: null },
      perItem: [
        [
          { data: null, error: null },
          { data: { id: "r-0" }, error: null },
        ],
      ],
    })
    const ts = "2025-03-10T10:00:00Z"
    const res = await POST(
      makeRequest({
        meter_id: METER_ID,
        readings: [
          { kwh_injected: 1.5, reading_timestamp: ts },
          { kwh_injected: 2.0, reading_timestamp: ts }, // duplicate
        ],
      })
    )
    expect(res.status).toBe(207)
    const json = await res.json()
    expect(json.accepted).toBe(1)
    expect(json.rejected).toBe(1)
    expect(json.items.rejected[0].errors[0]).toMatch(/Duplicate timestamp within batch/)
  })

  it("normalizes offset-aware timestamp to UTC", async () => {
    // -03:00 Buenos Aires time → UTC +3h
    const sourceTs = "2025-06-15T09:00:00-03:00"
    const expectedUtc = "2025-06-15T12:00:00.000Z"

    let capturedRow: Record<string, unknown> | null = null

    mockFromFn.mockImplementationOnce(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: activeMeter, error: null }),
        })),
      })),
    }))
    // Idempotency check
    mockFromFn.mockImplementationOnce(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          })),
        })),
      })),
    }))
    // Insert — capture the inserted row
    mockFromFn.mockImplementationOnce(() => ({
      insert: vi.fn((row: unknown) => {
        capturedRow = row as Record<string, unknown>
        return {
          select: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({ data: { id: "r-normalized", ...(row as object) }, error: null }),
          })),
        }
      }),
    }))

    const res = await POST(
      makeRequest({
        meter_id: METER_ID,
        readings: [{ kwh_injected: 1.5, reading_timestamp: sourceTs }],
      })
    )
    expect(res.status).toBe(201)
    expect(capturedRow).not.toBeNull()
    expect(capturedRow!.reading_timestamp).toBe(expectedUtc)
    expect(capturedRow!.reading_timestamp_source).toBe(sourceTs)
  })

  it("rejects invalid ISO timestamp per-item", async () => {
    setupMocks({ meterData: { data: activeMeter, error: null } })
    const res = await POST(
      makeRequest({
        meter_id: METER_ID,
        readings: [{ kwh_injected: 1.5, reading_timestamp: "not-a-date" }],
      })
    )
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.items.rejected[0].errors[0]).toMatch(/valid ISO 8601/)
  })
})

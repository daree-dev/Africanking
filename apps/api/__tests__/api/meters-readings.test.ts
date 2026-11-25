import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const ADDR = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
const COOP_ID = "00000000-0000-0000-0000-000000000001"
const METER_ID = "00000000-0000-0000-0000-000000000004"

const ACTIVE_METER = { id: METER_ID, cooperative_id: COOP_ID, status: "active" }

// ---------------------------------------------------------------------------
// Supabase mock
// ---------------------------------------------------------------------------
const { mockInsertSingle, mockMeterSingle, mockDedupQuery, mockFrom } = vi.hoisted(() => {
  const mockInsertSingle = vi.fn()
  const mockMeterSingle = vi.fn()
  // Returns existing rows for idempotency checks
  const mockDedupQuery = vi.fn(() => ({ data: [], error: null }))

  const mockFrom = vi.fn((table: string) => {
    if (table === "meters") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: mockMeterSingle,
          })),
        })),
      }
    }
    // "readings" table
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              limit: vi.fn(() => mockDedupQuery()),
            })),
            limit: vi.fn(() => mockDedupQuery()),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        select: vi.fn(() => ({ single: mockInsertSingle })),
      })),
    }
  })

  return { mockInsertSingle, mockMeterSingle, mockDedupQuery, mockFrom }
})

vi.mock("@/lib/supabase", () => ({
  supabase: { from: mockFrom },
}))

vi.mock("@/lib/auth/middleware", () => ({
  requireAuth: vi.fn(async () => ({
    sub: ADDR,
    stellar_address: ADDR,
    cooperative_ids: [COOP_ID],
    admin_cooperative_ids: [COOP_ID],
  })),
  isSession: vi.fn(() => true),
}))

import { POST } from "@/app/api/meters/readings/route"

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/meters/readings", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function setupActiveMeter() {
  mockMeterSingle.mockResolvedValue({ data: ACTIVE_METER, error: null })
}

function setupInsert(id = "r-new") {
  mockInsertSingle.mockResolvedValue({ data: { id }, error: null })
}

// ---------------------------------------------------------------------------
// Issue #11 — Versioned contract
// ---------------------------------------------------------------------------
describe("POST /api/meters/readings — versioned contract (issue #11)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("rejects unknown schema_version with machine-readable error → 400", async () => {
    const res = await POST(makeRequest({ schema_version: "v99", meter_id: METER_ID, readings: [] }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe("unsupported_schema_version")
    expect(json.supported_versions).toContain("v1")
    expect(json.supported_versions).toContain("v2")
  })

  it("accepts v1 schema without schema_version field (backward-compat) → 201", async () => {
    setupActiveMeter()
    setupInsert()
    mockDedupQuery.mockReturnValue({ data: [], error: null })

    const res = await POST(
      makeRequest({
        meter_id: METER_ID,
        readings: [{ kwh_injected: 1.5, reading_timestamp: "2025-01-01T12:00:00Z" }],
      })
    )
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.schema_version).toBe("v1")
  })

  it("accepts explicit schema_version v1 → 201", async () => {
    setupActiveMeter()
    setupInsert()
    mockDedupQuery.mockReturnValue({ data: [], error: null })

    const res = await POST(
      makeRequest({
        schema_version: "v1",
        meter_id: METER_ID,
        readings: [{ kwh_injected: 2.0, reading_timestamp: "2025-01-01T12:15:00Z" }],
      })
    )
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.schema_version).toBe("v1")
    expect(json.summary.created).toBe(1)
  })

  it("accepts schema_version v2 with source_event_id → 201", async () => {
    setupActiveMeter()
    setupInsert()
    mockDedupQuery.mockReturnValue({ data: [], error: null })

    const res = await POST(
      makeRequest({
        schema_version: "v2",
        meter_id: METER_ID,
        readings: [
          {
            kwh_injected: 3.0,
            reading_timestamp: "2025-01-01T12:30:00Z",
            source_event_id: "evt-abc-123",
            source_metadata: { firmware: "2.1.0", protocol: "DLMS" },
          },
        ],
      })
    )
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.schema_version).toBe("v2")
    expect(json.summary.created).toBe(1)
  })

  it("rejects v2 reading missing source_event_id → 400", async () => {
    const res = await POST(
      makeRequest({
        schema_version: "v2",
        meter_id: METER_ID,
        readings: [
          {
            kwh_injected: 3.0,
            reading_timestamp: "2025-01-01T12:30:00Z",
            // source_event_id omitted
          },
        ],
      })
    )
    expect(res.status).toBe(400)
  })

  it("returns per-reading outcomes, not a single batch status → 201", async () => {
    setupActiveMeter()
    setupInsert("r1")
    mockDedupQuery.mockReturnValue({ data: [], error: null })

    const res = await POST(
      makeRequest({
        schema_version: "v1",
        meter_id: METER_ID,
        readings: [
          { kwh_injected: 1.0, reading_timestamp: "2025-01-01T08:00:00Z" },
          { kwh_generated: 2.0, kwh_self_consumed: 0.5, reading_timestamp: "2025-01-01T08:15:00Z" },
        ],
      })
    )
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(Array.isArray(json.outcomes)).toBe(true)
    expect(json.outcomes).toHaveLength(2)
    expect(json.outcomes[0]).toHaveProperty("status")
    expect(json.outcomes[0]).toHaveProperty("index")
  })

  it("rejects missing meter_id in v1 → 400", async () => {
    const res = await POST(
      makeRequest({
        schema_version: "v1",
        readings: [{ kwh_injected: 1 }],
      })
    )
    expect(res.status).toBe(400)
  })

  it("rejects empty readings array → 400", async () => {
    const res = await POST(
      makeRequest({ schema_version: "v1", meter_id: METER_ID, readings: [] })
    )
    expect(res.status).toBe(400)
  })

  it("rejects meter not found → 404", async () => {
    mockMeterSingle.mockResolvedValue({ data: null, error: { message: "not found" } })

    const res = await POST(
      makeRequest({
        schema_version: "v1",
        meter_id: METER_ID,
        readings: [{ kwh_injected: 1, reading_timestamp: "2025-01-01T12:00:00Z" }],
      })
    )
    expect(res.status).toBe(404)
  })

  it("rejects inactive meter → 400", async () => {
    mockMeterSingle.mockResolvedValue({
      data: { ...ACTIVE_METER, status: "maintenance" },
      error: null,
    })

    const res = await POST(
      makeRequest({
        schema_version: "v1",
        meter_id: METER_ID,
        readings: [{ kwh_injected: 1, reading_timestamp: "2025-01-01T12:00:00Z" }],
      })
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/maintenance/)
  })
})

// ---------------------------------------------------------------------------
// Issue #12 — Idempotent bulk ingestion
// ---------------------------------------------------------------------------
describe("POST /api/meters/readings — idempotency (issue #12)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns duplicate status for safe replay (same kwh value, same source_event_id)", async () => {
    setupActiveMeter()
    // Simulate an existing row with the same value
    mockDedupQuery.mockReturnValue({
      data: [{ id: "r-existing", kwh_generated: 2.5 }],
      error: null,
    })

    const res = await POST(
      makeRequest({
        schema_version: "v2",
        meter_id: METER_ID,
        readings: [
          {
            kwh_injected: 2.5,
            reading_timestamp: "2025-01-01T10:00:00Z",
            source_event_id: "evt-dupe-001",
          },
        ],
      })
    )
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.summary.duplicates).toBe(1)
    expect(json.summary.created).toBe(0)
    expect(json.outcomes[0].status).toBe("duplicate")
    expect(json.outcomes[0].existing_id).toBe("r-existing")
    // No new row inserted
    expect(mockInsertSingle).not.toHaveBeenCalled()
  })

  it("returns conflict status when same key has different value", async () => {
    setupActiveMeter()
    // Existing row has 2.5, submission sends 3.0 → conflict
    mockDedupQuery.mockReturnValue({
      data: [{ id: "r-existing", kwh_generated: 2.5 }],
      error: null,
    })

    const res = await POST(
      makeRequest({
        schema_version: "v2",
        meter_id: METER_ID,
        readings: [
          {
            kwh_injected: 3.0,
            reading_timestamp: "2025-01-01T10:00:00Z",
            source_event_id: "evt-dupe-001",
          },
        ],
      })
    )
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.summary.conflicts).toBe(1)
    expect(json.outcomes[0].status).toBe("conflict")
    expect(json.outcomes[0].error).toMatch(/conflict/i)
    expect(mockInsertSingle).not.toHaveBeenCalled()
  })

  it("stores only one logical reading when two identical v2 readings are sent concurrently", async () => {
    setupActiveMeter()

    // First call: no existing row → insert
    // Second call: returns the just-inserted row → duplicate
    mockDedupQuery
      .mockReturnValueOnce({ data: [], error: null })
      .mockReturnValueOnce({ data: [{ id: "r-new", kwh_generated: 1.0 }], error: null })

    mockInsertSingle.mockResolvedValueOnce({ data: { id: "r-new" }, error: null })

    const reading = {
      kwh_injected: 1.0,
      reading_timestamp: "2025-01-01T14:00:00Z",
      source_event_id: "evt-concurrent-001",
    }

    // Sequential simulation of two concurrent requests
    const [res1, res2] = await Promise.all([
      POST(makeRequest({ schema_version: "v2", meter_id: METER_ID, readings: [reading] })),
      POST(makeRequest({ schema_version: "v2", meter_id: METER_ID, readings: [reading] })),
    ])

    const j1 = await res1.json()
    const j2 = await res2.json()

    // Combined: exactly 1 created + 1 duplicate = 1 logical reading stored
    const totalCreated = j1.summary.created + j2.summary.created
    const totalDuplicates = j1.summary.duplicates + j2.summary.duplicates
    expect(totalCreated).toBe(1)
    expect(totalDuplicates).toBe(1)
  })
})

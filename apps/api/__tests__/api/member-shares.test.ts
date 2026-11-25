/**
 * Tests for Issue #5 — member share versioning.
 * Covers: share version CRUD, allocation rule validation,
 * and resolution of the correct version on a given date.
 */
import { describe, it, expect } from "vitest"
import {
  resolveShareVersion,
  validateShareTotal,
  computeEffectiveUntil,
  type MemberShareVersion,
} from "@/lib/domain/member-shares"

function makeVersion(
  overrides: Partial<MemberShareVersion> = {}
): MemberShareVersion {
  return {
    id: "v1",
    member_id: "m1",
    cooperative_id: "c1",
    share_percentage: 25,
    effective_from: "2025-01-01",
    effective_until: null,
    created_by: "GADMIN",
    created_at: "2025-01-01T00:00:00Z",
    ...overrides,
  }
}

// ── resolveShareVersion ───────────────────────────────────────

describe("resolveShareVersion", () => {
  it("resolves the active open-ended version", () => {
    const versions = [
      makeVersion({ effective_from: "2025-01-01", effective_until: null }),
    ]
    const result = resolveShareVersion(versions, "2025-06-15")
    expect(result.effective_from).toBe("2025-01-01")
  })

  it("resolves the correct version when a newer one was added after the allocation date", () => {
    const versions = [
      makeVersion({ id: "v1", share_percentage: 20, effective_from: "2025-01-01", effective_until: "2025-05-31" }),
      makeVersion({ id: "v2", share_percentage: 30, effective_from: "2025-06-01", effective_until: null }),
    ]
    // Allocation on 2025-03-15 should use v1 (20%), not v2 (30%)
    const result = resolveShareVersion(versions, "2025-03-15")
    expect(result.id).toBe("v1")
    expect(result.share_percentage).toBe(20)
  })

  it("resolves the new version after the share change boundary", () => {
    const versions = [
      makeVersion({ id: "v1", share_percentage: 20, effective_from: "2025-01-01", effective_until: "2025-05-31" }),
      makeVersion({ id: "v2", share_percentage: 30, effective_from: "2025-06-01", effective_until: null }),
    ]
    const result = resolveShareVersion(versions, "2025-07-01")
    expect(result.id).toBe("v2")
    expect(result.share_percentage).toBe(30)
  })

  it("throws when no version covers the allocation date", () => {
    const versions = [
      makeVersion({ effective_from: "2025-06-01", effective_until: null }),
    ]
    expect(() => resolveShareVersion(versions, "2024-12-31")).toThrow(
      /No active share version found/
    )
  })

  it("handles allocation exactly on the effective_from boundary", () => {
    const versions = [makeVersion({ effective_from: "2025-06-01", effective_until: null })]
    const result = resolveShareVersion(versions, "2025-06-01")
    expect(result.effective_from).toBe("2025-06-01")
  })

  it("handles allocation exactly on the effective_until boundary (inclusive)", () => {
    const versions = [
      makeVersion({ id: "v1", effective_from: "2025-01-01", effective_until: "2025-05-31" }),
      makeVersion({ id: "v2", effective_from: "2025-06-01", effective_until: null }),
    ]
    const result = resolveShareVersion(versions, "2025-05-31")
    expect(result.id).toBe("v1")
  })
})

// ── validateShareTotal ────────────────────────────────────────

describe("validateShareTotal", () => {
  it("valid when total equals cap exactly", () => {
    const shares = [
      { member_id: "m1", share_percentage: 50 },
      { member_id: "m2", share_percentage: 50 },
    ]
    const { valid, total } = validateShareTotal(shares)
    expect(valid).toBe(true)
    expect(total).toBe(100)
  })

  it("valid when total is below cap", () => {
    const shares = [
      { member_id: "m1", share_percentage: 40 },
      { member_id: "m2", share_percentage: 30 },
    ]
    const { valid } = validateShareTotal(shares)
    expect(valid).toBe(true)
  })

  it("invalid when total exceeds cap", () => {
    const shares = [
      { member_id: "m1", share_percentage: 60 },
      { member_id: "m2", share_percentage: 50 },
    ]
    const { valid, total, excess } = validateShareTotal(shares)
    expect(valid).toBe(false)
    expect(total).toBe(110)
    expect(excess).toBe(10)
  })

  it("handles floating-point amounts without false overflow", () => {
    const shares = [
      { member_id: "m1", share_percentage: 33.33 },
      { member_id: "m2", share_percentage: 33.33 },
      { member_id: "m3", share_percentage: 33.34 },
    ]
    const { valid, total } = validateShareTotal(shares)
    expect(valid).toBe(true)
    expect(total).toBe(100)
  })

  it("supports custom allocation cap", () => {
    const shares = [{ member_id: "m1", share_percentage: 60 }]
    const { valid } = validateShareTotal(shares, 50)
    expect(valid).toBe(false)
  })
})

// ── computeEffectiveUntil ──────────────────────────────────────

describe("computeEffectiveUntil", () => {
  it("returns null when there is no existing active version", () => {
    const { closeDate } = computeEffectiveUntil(undefined, "2025-06-01")
    expect(closeDate).toBeNull()
  })

  it("sets effective_until to the day before the new effective_from", () => {
    const existing = makeVersion({ effective_from: "2025-01-01", effective_until: null })
    const { closeDate } = computeEffectiveUntil(existing, "2025-06-01")
    expect(closeDate).toBe("2025-05-31")
  })

  it("handles month boundaries correctly", () => {
    const existing = makeVersion({ effective_from: "2025-01-01", effective_until: null })
    const { closeDate } = computeEffectiveUntil(existing, "2025-03-01")
    expect(closeDate).toBe("2025-02-28")
  })
})

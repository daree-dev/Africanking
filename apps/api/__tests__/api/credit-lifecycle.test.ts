/**
 * Tests for Issue #8 — internal credit lifecycle.
 * Covers: state machine transitions, legacy status mapping,
 * allocation computation with share provenance.
 */
import { describe, it, expect } from "vitest"
import {
  assertValidCreditTransition,
  computeAllocations,
  mapLegacyStatusToCreditState,
  CreditLifecycleError,
  type CreditState,
  type LegacyCertificateState,
} from "@/lib/domain/credit-lifecycle"

// ── assertValidCreditTransition ───────────────────────────────

describe("assertValidCreditTransition", () => {
  const permitted: Array<[CreditState, CreditState]> = [
    ["measured",  "validated"],
    ["measured",  "cancelled"],
    ["validated", "allocated"],
    ["validated", "cancelled"],
    ["allocated", "settled"],
    ["allocated", "cancelled"],
  ]

  for (const [from, to] of permitted) {
    it(`${from} → ${to} is permitted`, () => {
      expect(() => assertValidCreditTransition(from, to)).not.toThrow()
    })
  }

  const forbidden: Array<[CreditState, CreditState]> = [
    ["measured",  "allocated"],
    ["measured",  "settled"],
    ["validated", "measured"],
    ["allocated", "measured"],
    ["allocated", "validated"],
    ["settled",   "measured"],
    ["settled",   "validated"],
    ["cancelled", "measured"],
  ]

  for (const [from, to] of forbidden) {
    it(`${from} → ${to} is rejected`, () => {
      expect(() => assertValidCreditTransition(from, to)).toThrow(CreditLifecycleError)
    })
  }
})

// ── mapLegacyStatusToCreditState ──────────────────────────────

describe("mapLegacyStatusToCreditState", () => {
  const mapping: Array<[LegacyCertificateState, CreditState]> = [
    ["pending",   "measured"],
    ["available", "validated"],
    ["sold",      "allocated"],
    ["retired",   "settled"],
  ]

  for (const [legacy, creditState] of mapping) {
    it(`legacy "${legacy}" maps to credit state "${creditState}"`, () => {
      expect(mapLegacyStatusToCreditState(legacy)).toBe(creditState)
    })
  }
})

// ── computeAllocations ────────────────────────────────────────

describe("computeAllocations", () => {
  it("distributes kWh proportionally to share percentages", () => {
    const allocs = computeAllocations({
      credit_id: "cred-1",
      cooperative_id: "coop-1",
      total_kwh: 100,
      allocation_date: "2025-06-01",
      memberShares: [
        { member_id: "m1", share_percentage: 60, share_version_id: "sv1" },
        { member_id: "m2", share_percentage: 40, share_version_id: "sv2" },
      ],
    })

    expect(allocs).toHaveLength(2)
    expect(allocs[0]!.allocated_kwh).toBe(60)
    expect(allocs[1]!.allocated_kwh).toBe(40)
    // Sum equals total
    const sum = allocs.reduce((s, a) => s + a.allocated_kwh, 0)
    expect(Math.round(sum * 1000) / 1000).toBe(100)
  })

  it("last member absorbs rounding remainder so sum equals total", () => {
    const allocs = computeAllocations({
      credit_id: "cred-2",
      cooperative_id: "coop-1",
      total_kwh: 100,
      allocation_date: "2025-06-01",
      memberShares: [
        { member_id: "m1", share_percentage: 33.33, share_version_id: "sv1" },
        { member_id: "m2", share_percentage: 33.33, share_version_id: "sv2" },
        { member_id: "m3", share_percentage: 33.34, share_version_id: "sv3" },
      ],
    })

    const sum = allocs.reduce((s, a) => s + a.allocated_kwh, 0)
    // Allow ±1 Wh rounding
    expect(Math.abs(sum - 100)).toBeLessThanOrEqual(0.001)
  })

  it("stores share_version_id for provenance on each allocation", () => {
    const allocs = computeAllocations({
      credit_id: "cred-3",
      cooperative_id: "coop-1",
      total_kwh: 50,
      allocation_date: "2025-06-01",
      memberShares: [
        { member_id: "m1", share_percentage: 50, share_version_id: "sv-abc" },
        { member_id: "m2", share_percentage: 50, share_version_id: "sv-def" },
      ],
    })

    expect(allocs[0]!.share_version_id).toBe("sv-abc")
    expect(allocs[1]!.share_version_id).toBe("sv-def")
  })

  it("throws when no member shares are provided", () => {
    expect(() =>
      computeAllocations({
        credit_id: "cred-4",
        cooperative_id: "coop-1",
        total_kwh: 100,
        allocation_date: "2025-06-01",
        memberShares: [],
      })
    ).toThrow(CreditLifecycleError)
  })

  it("all allocations carry state='allocated'", () => {
    const allocs = computeAllocations({
      credit_id: "cred-5",
      cooperative_id: "coop-1",
      total_kwh: 10,
      allocation_date: "2025-06-01",
      memberShares: [{ member_id: "m1", share_percentage: 100, share_version_id: "sv1" }],
    })
    expect(allocs[0]!.state).toBe("allocated")
  })
})

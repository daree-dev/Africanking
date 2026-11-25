/**
 * Tests for Issue #7 — reading source and verification provenance.
 * Validates that unverified operational data cannot enter crediting workflows,
 * and that state transitions are enforced.
 */
import { describe, it, expect } from "vitest"
import {
  isAuthoritativeSource,
  isVerifiedForCrediting,
  assertVerifiedForCrediting,
  assertValidStateTransition,
  ProvenanceError,
  type ReadingSourceType,
  type VerificationState,
} from "@/lib/domain/reading-provenance"

// ── isAuthoritativeSource ─────────────────────────────────────

describe("isAuthoritativeSource", () => {
  const cases: Array<[ReadingSourceType, boolean]> = [
    ["distributor_meter", true],
    ["inverter", false],
    ["scada", false],
    ["manual", false],
  ]

  for (const [sourceType, expected] of cases) {
    it(`${sourceType} → ${expected}`, () => {
      expect(isAuthoritativeSource(sourceType)).toBe(expected)
    })
  }
})

// ── isVerifiedForCrediting ────────────────────────────────────

describe("isVerifiedForCrediting", () => {
  const cases: Array<[ReadingSourceType, VerificationState, boolean]> = [
    ["distributor_meter", "pending",   false],
    ["distributor_meter", "verified",  true],
    ["distributor_meter", "rejected",  false],
    ["distributor_meter", "corrected", false],
    ["inverter",          "pending",   false],
    ["inverter",          "verified",  true],
    ["scada",             "pending",   false],
    ["scada",             "verified",  true],
    ["manual",            "pending",   false],
    ["manual",            "verified",  true],
  ]

  for (const [sourceType, state, expected] of cases) {
    it(`source_type=${sourceType}, state=${state} → ${expected}`, () => {
      expect(isVerifiedForCrediting({ source_type: sourceType, verification_state: state })).toBe(expected)
    })
  }
})

// ── assertVerifiedForCrediting ────────────────────────────────

describe("assertVerifiedForCrediting", () => {
  it("does not throw for verified readings", () => {
    expect(() =>
      assertVerifiedForCrediting({ source_type: "distributor_meter", verification_state: "verified" })
    ).not.toThrow()
  })

  it("throws for pending inverter readings", () => {
    expect(() =>
      assertVerifiedForCrediting({ source_type: "inverter", verification_state: "pending", id: "r-1" })
    ).toThrow(ProvenanceError)
  })

  it("throws for pending distributor_meter readings (not yet verified)", () => {
    expect(() =>
      assertVerifiedForCrediting({ source_type: "distributor_meter", verification_state: "pending" })
    ).toThrow(/Only verified readings may enter crediting workflows/)
  })

  it("throws for rejected readings", () => {
    expect(() =>
      assertVerifiedForCrediting({ source_type: "manual", verification_state: "rejected" })
    ).toThrow(ProvenanceError)
  })

  it("includes the reading id in the error message when provided", () => {
    expect(() =>
      assertVerifiedForCrediting({ source_type: "scada", verification_state: "pending", id: "reading-xyz" })
    ).toThrow(/reading-xyz/)
  })
})

// ── assertValidStateTransition ────────────────────────────────

describe("assertValidStateTransition", () => {
  const validTransitions: Array<[VerificationState, VerificationState]> = [
    ["pending",  "verified"],
    ["pending",  "rejected"],
    ["verified", "corrected"],
  ]

  for (const [from, to] of validTransitions) {
    it(`${from} → ${to} is permitted`, () => {
      expect(() => assertValidStateTransition(from, to)).not.toThrow()
    })
  }

  const invalidTransitions: Array<[VerificationState, VerificationState]> = [
    ["verified",  "pending"],
    ["rejected",  "verified"],
    ["corrected", "pending"],
    ["corrected", "verified"],
    ["pending",   "corrected"],
    ["rejected",  "corrected"],
  ]

  for (const [from, to] of invalidTransitions) {
    it(`${from} → ${to} is rejected`, () => {
      expect(() => assertValidStateTransition(from, to)).toThrow(ProvenanceError)
    })
  }
})

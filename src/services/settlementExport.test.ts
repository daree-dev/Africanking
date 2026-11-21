import { describe, it, expect } from "vitest";
import {
  SETTLEMENT_EXPORT_SCHEMA_VERSION,
  buildSettlementExport,
  computeExportIdentity,
  previewSettlementExport,
  type SettlementExportInput,
} from "./settlementExport";

function baseInput(): SettlementExportInput {
  return {
    cooperativeId: "coop-1",
    period: {
      start: "2024-01-01T00:00:00+09:00",
      end: "2024-02-01T00:00:00+09:00",
      timezone: "Asia/Tokyo",
    },
    members: [
      {
        memberId: "m-1",
        displayName: "Member One",
        energyAllocations: [
          { meterId: "meter-1", quantity: 120.5, unit: "kWh" },
        ],
        adjustments: [
          { reason: "meter correction", quantity: -2.5, unit: "kWh" },
        ],
        billing: {
          currency: "JPY",
          subtotal: 12000,
          taxRate: 0.1,
          taxAmount: 1200,
          total: 13200,
          taxTreatment: "standard",
        },
      },
    ],
    provenance: {
      source: "meter-import",
      generatedAt: "2024-02-01T00:00:00+09:00",
      generator: "settlement-export@1",
    },
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("settlement export schema", () => {
  it("emits a versioned schema with period, member, energy, adjustments, and provenance", () => {
    const payload = buildSettlementExport(baseInput());
    expect(payload.schemaVersion).toBe(SETTLEMENT_EXPORT_SCHEMA_VERSION);
    expect(payload.period.timezone).toBe("Asia/Tokyo");
    expect(payload.members).toHaveLength(1);
    const member = payload.members[0];
    expect(member.energyAllocations[0]).toEqual({
      meterId: "meter-1",
      quantity: 120.5,
      unit: "kWh",
    });
    expect(member.adjustments[0].quantity).toBe(-2.5);
    expect(payload.provenance.source).toBe("meter-import");
  });

  it("keeps energy quantities separate from currency amounts and tax treatment", () => {
    const payload = buildSettlementExport(baseInput());
    const member = payload.members[0];
    expect(member.energyAllocations[0].unit).toBe("kWh");
    expect(member.billing.currency).toBe("JPY");
    expect(member.billing.taxTreatment).toBe("standard");
    expect(member.billing.taxAmount).toBe(1200);
    // energy quantities must not carry currency fields
    expect("currency" in member.energyAllocations[0]).toBe(false);
  });

  it("is schema-compatible across repeated builds", () => {
    const a = buildSettlementExport(baseInput());
    const b = buildSettlementExport(baseInput());
    expect(a.schemaVersion).toBe(b.schemaVersion);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("produces a dry-run preview without external writes", () => {
    const preview = previewSettlementExport(baseInput());
    expect(preview.dryRun).toBe(true);
    expect(preview.written).toBe(false);
    expect(preview.payload.schemaVersion).toBe(SETTLEMENT_EXPORT_SCHEMA_VERSION);
    expect(preview.exportId).toBe(computeExportIdentity(baseInput()));
  });

  it("computes a deterministic idempotent export identity", () => {
    const id1 = computeExportIdentity(baseInput());
    const id2 = computeExportIdentity(baseInput());
    expect(id1).toBe(id2);

    const changed = clone(baseInput());
    changed.members[0].energyAllocations[0].quantity = 121;
    expect(computeExportIdentity(changed)).not.toBe(id1);
  });

  it("detects duplicate exports via identity", () => {
    const input = baseInput();
    const first = buildSettlementExport(input);
    const second = buildSettlementExport(input);
    expect(first.exportId).toBe(second.exportId);
  });

  it("normalizes period boundaries by timezone", () => {
    const input = baseInput();
    input.period.start = "2024-01-01T00:00:00Z";
    input.period.end = "2024-02-01T00:00:00Z";
    const payload = buildSettlementExport(input);
    expect(payload.period.timezone).toBe("Asia/Tokyo");
    expect(payload.period.start).toBe("2024-01-01T00:00:00Z");
    expect(payload.period.end).toBe("2024-02-01T00:00:00Z");
  });

  it("supports correction exports with a distinct identity", () => {
    const original = buildSettlementExport(baseInput());
    const correctionInput = baseInput();
    correctionInput.correctionOf = original.exportId;
    correctionInput.members[0].adjustments.push({
      reason: "late meter read",
      quantity: 3,
      unit: "kWh",
    });
    const correction = buildSettlementExport(correctionInput);
    expect(correction.correctionOf).toBe(original.exportId);
    expect(correction.exportId).not.toBe(original.exportId);
  });
});

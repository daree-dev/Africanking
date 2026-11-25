# Settlement Export Boundary

This document defines the stable boundary between the cooperative-management
product and existing cooperative billing systems. Settlement data may flow into
those systems, but on-chain tokens are **not** treated as currency or invoices.
Generation credits are assigned to cooperative members; this is not an external
certificate marketplace and makes no I-REC/ESG certification claim.

## Versioned export schema

Every export carries a `schemaVersion`. Consumers must reject unknown major
versions and may ignore unknown fields within a known major version.

```jsonc
{
  "schemaVersion": "1.0",
  "exportId": "<deterministic id, see below>",
  "period": {
    "start": "2024-01-01T00:00:00Z",   // ISO-8601, UTC
    "end": "2024-02-01T00:00:00Z",     // exclusive
    "timezone": "Europe/Berlin"        // period was computed in this zone
  },
  "member": {
    "memberId": "m-123",
    "displayName": "Example Member"
  },
  "energy": {
    "unit": "kWh",
    "allocated": 1200.0,
    "adjustments": [
      { "reason": "meter-correction", "quantity": -50.0, "unit": "kWh" }
    ],
    "net": 1150.0
  },
  "billing": {
    "currency": "EUR",
    "amounts": [
      { "label": "energy", "amount": 230.0 },
      { "label": "adjustment", "amount": -10.0 }
    ],
    "tax": {
      "treatment": "standard",
      "rate": 0.19,
      "amount": 41.8
    }
  },
  "provenance": {
    "source": "meter-import",
    "generatedAt": "2024-02-01T00:00:00Z",
    "generator": "settlement-export@1.0"
  }
}
```

### Separation of concerns

- **Energy quantities** live under `energy` and always carry a `unit` (kWh).
  They are physical quantities, never currency.
- **Local-currency amounts** live under `billing.amounts` and always carry a
  `currency`.
- **Tax treatment** lives under `billing.tax` and is expressed separately from
  both energy and amounts. Tax is a local-currency concern only.

## Dry-run preview

A dry run produces the full export payload (including `exportId`) **without
writing to any external system**. It is the default mode; a real write must be
requested explicitly. The preview is byte-identical to what a real export would
send, so consumers can validate it before committing.

## Idempotent export identity

`exportId` is deterministic and derived from stable inputs only:

- `schemaVersion`
- `period.start`, `period.end`, `period.timezone`
- `member.memberId`
- the ordered energy allocation and adjustments

It must **not** depend on `generatedAt` or any wall-clock value. Re-running an
export for the same period and member yields the same `exportId`; a duplicate
export is detected and not re-written to the external system.

## Timezone periods

Periods are computed in the cooperative's local timezone and serialized as
UTC instants with an exclusive `end`. A correction export for the same period
reuses the same `period` and `member`, so its `exportId` differs only when the
underlying energy or adjustments change.

## Corrections

Corrections are expressed as `energy.adjustments` entries with a `reason` and a
signed `quantity`. A correction export is a new payload with a new `exportId`
(because the adjustments changed); the original export is never mutated.

## Migration and rollout

- Existing settlement data is preserved; this boundary is additive.
- Consumers should key on `schemaVersion` and `exportId`.
- Roll out in dry-run mode first, validate payloads, then enable writes.
- Bump the major `schemaVersion` only for breaking changes; additive fields
  stay within the current major version.

## Validation checklist

- Schema compatibility: unknown major versions rejected, unknown fields ignored.
- Duplicate export: same inputs produce the same `exportId` and are not re-written.
- Timezone period: periods computed in local zone serialize to correct UTC bounds.
- Correction export: adjustments produce a new `exportId` without mutating the original.

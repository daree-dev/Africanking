# Bulk Reading API — Validation and Partial Acceptance

## Endpoint

```
POST /api/meters/readings
```

## Semantics

The bulk reading endpoint uses **partial acceptance**: each item in the `readings` array is validated independently. Valid items are committed; invalid items are rejected with a reason. A bad item does not block other items in the same request.

This contrasts with an all-or-nothing approach: in an all-or-nothing design, a single invalid item would leave callers uncertain which measurements were persisted. The partial model gives callers a stable index-based identity for every outcome.

### Acceptance

An item is accepted when:

1. It passes schema validation (required fields present, values in range, timestamp rules satisfied).
2. Its UTC-normalized timestamp does not duplicate another item in the same batch.
3. It does not violate the `(meter_id, reading_timestamp)` uniqueness constraint.

Accepted items are committed **atomically** with the idempotency record: either the row is inserted and the response lists the new ID, or the row already exists and the existing ID is returned. No partial writes occur for a single item.

### Rejection

An item is rejected when it fails any validation or overlap check. Rejected items are reported with:
- their zero-based index in the `readings` array
- one or more human-readable error messages
- the original submitted item (for easy correction and resubmission)

Rejected items are never persisted.

### Idempotency

Re-submitting an item with the same `(meter_id, reading_timestamp)` is safe. The API detects the existing record before inserting and returns the existing ID as an accepted outcome, marked `_idempotent: true` internally. This allows meters to retry on network failure without creating duplicate rows.

## Response shape

```jsonc
{
  "accepted": 2,
  "rejected": 1,
  "partial": true,
  "items": {
    "accepted": [
      { "index": 0, "id": "uuid-of-inserted-or-existing-row" },
      { "index": 2, "id": "uuid-of-inserted-or-existing-row" }
    ],
    "rejected": [
      {
        "index": 1,
        "errors": ["kwh_injected or kwh_generated required"],
        "item": { "reading_timestamp": "2025-01-01T12:15:00Z" }
      }
    ]
  }
}
```

## HTTP status codes

| Code | Meaning |
|---|---|
| `201` | All items accepted |
| `207` | Partial — some items accepted, some rejected |
| `422` | No items accepted (all rejected by validation) |
| `400` | Request-level error (missing `meter_id`, empty array, invalid UUID) |
| `404` | Meter not found |
| `403` | Access denied (caller not a member of the meter's cooperative) |

## All-or-nothing alternative

If a caller requires all-or-nothing semantics (e.g. for an atomic time-series block), it should:

1. Pre-validate all items client-side using the same schema rules.
2. Only submit when all items are expected to pass.
3. Treat a `207` response as a signal to investigate and resubmit the rejected subset.

The API does not expose an explicit `mode=atomic` flag; the per-item model is the default and the recommended pattern for meter telemetry.

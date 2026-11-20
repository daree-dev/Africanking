# Measurement Timestamp Integrity

## Timestamp normalization (issue #14)

All timestamps submitted to the reading APIs are normalized to **UTC** before storage. The original source value — which may carry a named or numeric timezone offset — is preserved alongside the normalized value for traceability.

### Field mapping

| Stored column | Content |
|---|---|
| `reading_timestamp` | Normalized UTC ISO 8601 string (e.g. `2025-06-15T12:00:00.000Z`) |
| `reading_timestamp_source` | Original value as submitted (e.g. `2025-06-15T09:00:00-03:00`) |
| `reading_date` | Calendar date in `YYYY-MM-DD` (UTC), for daily summaries |

### Daylight-saving transitions

Because timestamps are always normalized to UTC, DST transitions do not create ambiguity in the stored data. A reading submitted as `2025-10-05T02:30:00-03:00` (a wall-clock time that may occur twice during an Argentinian DST transition) is stored as the unambiguous UTC equivalent. If disambiguation matters, the submitter should include the numeric offset in `reading_timestamp` (e.g. `-02:00` vs `-03:00`) rather than a timezone name.

## Validation rules

The validation layer (`singleMeterReading` schema) enforces:

| Rule | Error |
|---|---|
| `reading_timestamp` must be a parseable ISO 8601 datetime | `reading_timestamp is not a valid ISO 8601 datetime` |
| `reading_timestamp` must not be in the future | `reading_timestamp must not be in the future` |
| `reading_date` must match `YYYY-MM-DD` | `reading_date must be YYYY-MM-DD` |

These rules apply to both single readings (`POST /api/readings`) and bulk batch items (`POST /api/meters/readings`).

## Interval overlap behavior

For bulk batch submissions, timestamps within a single request must be unique after UTC normalization. Duplicate timestamps in the same batch are rejected per-item with the error `Duplicate timestamp within batch: <utc_ts>`.

For cross-request idempotency, the API checks for an existing reading with the same `(meter_id, reading_timestamp)` before inserting. A duplicate is treated as an idempotent re-submission: the existing record ID is returned as accepted without creating a second row.

A database-level unique constraint on `(meter_id, reading_timestamp)` enforces this at the persistence layer. If a constraint violation reaches the database despite the application check (e.g. concurrent submissions), the error is surfaced as a per-item rejection with the reason `Duplicate reading (unique constraint)`.

## Out-of-window timestamps

Future timestamps are rejected at validation time (before any database call). There is no configurable future window — any timestamp with `ts > Date.now()` at request time is rejected.

Historical backdating (past timestamps) is accepted. Cooperative administrators can review and reject suspicious historical readings through the standard `PATCH /api/readings` status update flow.

## Quarantine behavior

Readings rejected by timestamp validation are returned in the `rejected[]` array of the batch response with their zero-based index, the rejection reason, and the original submitted item. They are never persisted. Cooperative administrators see per-item rejection reasons in the response and can correct and resubmit the affected items.

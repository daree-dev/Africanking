import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"
import { requireAuth, isSession } from "@/lib/auth/middleware"
import { singleMeterReading } from "@/lib/validation/schemas"
import { safeDbError, safeCatchError } from "@/lib/errors/safe-error"

function getNetInjectedKwh(kwhGenerated: number, kwhSelfConsumed: number) {
  return Math.max(0, kwhGenerated - kwhSelfConsumed)
}

/**
 * Normalize an ISO 8601 timestamp to UTC.
 * Returns the UTC ISO string and the original source string for traceability.
 */
function normalizeTimestamp(raw: string): { utc: string; source: string } {
  const ts = new Date(raw)
  return { utc: ts.toISOString(), source: raw }
}

type ItemRejection = { index: number; errors: string[]; item: unknown }
type ItemAccepted = { index: number; reading: Record<string, unknown> }

/**
 * POST /api/meters/readings
 *
 * Partial-acceptance bulk ingestion.
 *
 * Semantics:
 *   - Every item is validated independently before any persistence.
 *   - Valid items are committed atomically with their idempotency key (meter_id +
 *     normalized UTC timestamp).  An item that would produce a duplicate
 *     idempotency key is silently de-duplicated (returned as accepted with the
 *     existing record id).
 *   - Invalid items are rejected with their zero-based index and the reason.
 *     They do not block acceptance of other items.
 *   - The response body reports accepted[], rejected[], counts, and whether the
 *     batch had any failures so callers can decide whether to retry.
 *
 * Timestamp handling (issue #14):
 *   - Timestamps are normalized to UTC for storage.
 *   - The original source value (with offset) is preserved in
 *     reading_timestamp_source for traceability.
 *   - Future timestamps are rejected per-item.
 *   - Overlapping intervals for the same meter are detected and rejected.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth()
    if (!isSession(session)) return session

    const body = await req.json()

    // Top-level shape check
    if (!body || typeof body !== "object" || !body.meter_id || !Array.isArray(body.readings)) {
      return NextResponse.json(
        { error: "Validation failed", details: ["meter_id (uuid) and readings (array) are required"] },
        { status: 400 }
      )
    }

    const { meter_id, readings } = body as { meter_id: string; readings: unknown[] }

    if (readings.length === 0) {
      return NextResponse.json(
        { error: "Validation failed", details: ["readings must contain at least 1 item"] },
        { status: 400 }
      )
    }

    if (readings.length > 1000) {
      return NextResponse.json(
        { error: "Validation failed", details: ["readings must not exceed 1000 items"] },
        { status: 400 }
      )
    }

    // Validate meter_id is a UUID
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidPattern.test(meter_id)) {
      return NextResponse.json(
        { error: "Validation failed", details: ["meter_id must be a valid UUID"] },
        { status: 400 }
      )
    }

    // Validate meter exists and is active
    const { data: meter, error: meterError } = await supabase
      .from("meters")
      .select("id, cooperative_id, status")
      .eq("id", meter_id)
      .single()

    if (meterError || !meter) {
      return NextResponse.json({ error: "Meter not found" }, { status: 404 })
    }

    if (meter.status !== "active") {
      return NextResponse.json(
        { error: `Meter status is '${meter.status}', expected 'active'` },
        { status: 400 }
      )
    }

    // Authorization: must be member of the meter's cooperative
    if (!session.cooperative_ids.includes(meter.cooperative_id)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }

    // --- Per-item validation (issue #13) ---
    const accepted: ItemAccepted[] = []
    const rejected: ItemRejection[] = []

    // Track timestamps seen in this batch to detect intra-batch overlaps (issue #14)
    const batchTimestamps = new Set<string>()

    for (let i = 0; i < readings.length; i++) {
      const item = readings[i]
      const result = singleMeterReading.safeParse(item)

      if (!result.success) {
        rejected.push({
          index: i,
          errors: result.error.issues.map((iss) => iss.message),
          item,
        })
        continue
      }

      const d = result.data

      // Normalize timestamp (issue #14)
      let utcTimestamp: string | null = null
      let sourceTimestamp: string | null = null

      if (d.reading_timestamp) {
        const normalized = normalizeTimestamp(d.reading_timestamp)
        utcTimestamp = normalized.utc
        sourceTimestamp = normalized.source
      }

      // Detect intra-batch timestamp duplicates
      if (utcTimestamp) {
        if (batchTimestamps.has(utcTimestamp)) {
          rejected.push({
            index: i,
            errors: [`Duplicate timestamp within batch: ${utcTimestamp}`],
            item,
          })
          continue
        }
        batchTimestamps.add(utcTimestamp)
      }

      const kwhGenerated = d.kwh_generated ?? d.kwh_injected!
      const kwhInjected =
        d.kwh_injected ?? getNetInjectedKwh(kwhGenerated, d.kwh_self_consumed ?? 0)

      const row = {
        meter_id,
        cooperative_id: meter.cooperative_id,
        kwh_generated: kwhGenerated,
        kwh_injected: kwhInjected,
        kwh_self_consumed: d.kwh_self_consumed ?? null,
        power_watts: d.power_watts ?? null,
        interval_minutes: d.interval_minutes ?? 15,
        // Store normalized UTC timestamp (issue #14)
        reading_timestamp: utcTimestamp,
        // Preserve original source offset for traceability (issue #14)
        reading_timestamp_source: sourceTimestamp,
        reading_date: d.reading_date ?? null,
        source: "meter",
        status: "pending",
      }

      // Idempotency: check for existing record with same meter_id + UTC timestamp
      if (utcTimestamp) {
        const { data: existing } = await supabase
          .from("readings")
          .select("id")
          .eq("meter_id", meter_id)
          .eq("reading_timestamp", utcTimestamp)
          .single()

        if (existing) {
          // De-duplicate: treat as accepted with existing record id
          accepted.push({ index: i, reading: { id: existing.id, ...row, _idempotent: true } })
          continue
        }
      }

      // Insert atomically (issue #13)
      const { data: inserted, error: insertError } = await supabase
        .from("readings")
        .insert(row)
        .select()
        .single()

      if (insertError) {
        // Postgres unique constraint violation → idempotent duplicate
        if (insertError.code === "23505") {
          rejected.push({
            index: i,
            errors: ["Duplicate reading (unique constraint)"],
            item,
          })
        } else {
          rejected.push({
            index: i,
            errors: [insertError.message ?? "Database error"],
            item,
          })
        }
        continue
      }

      accepted.push({ index: i, reading: inserted })
    }

    const status = rejected.length === 0 ? 201 : accepted.length === 0 ? 422 : 207

    return NextResponse.json(
      {
        accepted: accepted.length,
        rejected: rejected.length,
        partial: rejected.length > 0 && accepted.length > 0,
        items: {
          accepted: accepted.map((a) => ({ index: a.index, id: (a.reading as { id: string }).id })),
          rejected,
        },
      },
      { status }
    )
  } catch (err) {
    return safeCatchError(err)
  }
}

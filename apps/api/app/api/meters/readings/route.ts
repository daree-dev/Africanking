import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"
import { requireAuth, isSession } from "@/lib/auth/middleware"
import { validateBody } from "@/lib/validation/validate"
import {
  versionedBulkMeterReadingsSchema,
  SUPPORTED_METER_INGESTION_VERSIONS,
  type MeterIngestionVersion,
} from "@/lib/validation/schemas"
import { safeDbError, safeCatchError } from "@/lib/errors/safe-error"

/**
 * POST /api/meters/readings
 *
 * Versioned bulk meter ingestion (issues #11 + #12).
 *
 * Contract:
 * - schema_version is required. Unknown versions → 400 with machine-readable error.
 * - v1: original schema (backward-compatible, no source_event_id).
 * - v2: adds source_event_id per reading + optional source_metadata.
 *       source_event_id enables idempotent replay: a retry with the same
 *       (meter_id, source_event_id, interval_minutes, reading_timestamp) is
 *       treated as a safe replay and returns the original stored result.
 *
 * Response: per-reading outcomes array — never an ambiguous whole-batch status.
 */

type ReadingOutcomeStatus = "created" | "duplicate" | "conflict"

interface ReadingOutcome {
  index: number
  status: ReadingOutcomeStatus
  reading_id: string | null
  /** Present for duplicate/conflict; shows the first stored row */
  existing_id?: string
  error?: string
}

function getNetInjectedKwh(kwhGenerated: number, kwhSelfConsumed: number) {
  return Math.max(0, kwhGenerated - kwhSelfConsumed)
}

/** Build the idempotency key fields from a reading + meter context */
function idempotencyKey(meterId: string, r: {
  source_event_id?: string
  reading_timestamp?: string
  interval_minutes?: number
}) {
  return {
    meter_id: meterId,
    source_event_id: r.source_event_id ?? null,
    reading_timestamp: r.reading_timestamp ?? null,
    interval_minutes: r.interval_minutes ?? 15,
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth()
    if (!isSession(session)) return session

    const body = await req.json()

    // Reject unsupported versions with a machine-readable error (issue #11)
    const rawVersion = body?.schema_version
    if (rawVersion && !SUPPORTED_METER_INGESTION_VERSIONS.includes(rawVersion as MeterIngestionVersion)) {
      return NextResponse.json(
        {
          error: "unsupported_schema_version",
          message: `Schema version '${rawVersion}' is not supported.`,
          supported_versions: SUPPORTED_METER_INGESTION_VERSIONS,
        },
        { status: 400 }
      )
    }

    // Default to v1 when schema_version is omitted (backward-compat)
    if (!body.schema_version) {
      body.schema_version = "v1"
    }

    const v = validateBody(versionedBulkMeterReadingsSchema, body)
    if (!v.success) return v.response

    const data = v.data as {
      schema_version: MeterIngestionVersion
      meter_id?: string
      serial_number?: string
      cooperative_id?: string
      readings: Array<{
        kwh_injected?: number
        kwh_generated?: number
        reading_timestamp?: string
        reading_date?: string
        power_watts?: number
        interval_minutes?: number
        kwh_self_consumed?: number
        source_event_id?: string
        source_metadata?: Record<string, unknown>
      }>
    }

    // Resolve meter_id (v2 may supply serial_number + cooperative_id instead)
    let meterId = data.meter_id ?? ""
    if (!meterId && data.serial_number && data.cooperative_id) {
      const { data: found } = await supabase
        .from("meters")
        .select("id")
        .eq("serial_number", data.serial_number)
        .eq("cooperative_id", data.cooperative_id)
        .single()
      if (!found) {
        return NextResponse.json(
          { error: "Meter not found by serial_number + cooperative_id" },
          { status: 404 }
        )
      }
      meterId = found.id
    }

    // Validate meter exists and is active
    const { data: meter, error: meterError } = await supabase
      .from("meters")
      .select("id, cooperative_id, status")
      .eq("id", meterId)
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

    if (!session.cooperative_ids.includes(meter.cooperative_id)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }

    // Process readings one by one to produce per-reading outcomes (issue #11)
    // and enforce idempotency (issue #12).
    const outcomes: ReadingOutcome[] = []

    for (let i = 0; i < data.readings.length; i++) {
      const r = data.readings[i]!
      const kwhGenerated = r.kwh_generated ?? r.kwh_injected!
      const kwhInjected =
        r.kwh_injected ?? getNetInjectedKwh(kwhGenerated, r.kwh_self_consumed ?? 0)

      // Idempotency check: (meter_id, source_event_id, interval_minutes, reading_timestamp)
      // For v1 without source_event_id we still check (meter_id, reading_timestamp, interval)
      // to prevent naive duplicates.
      const ikey = idempotencyKey(meterId, r)
      let existingQuery = supabase
        .from("readings")
        .select("id, kwh_generated")
        .eq("meter_id", meterId)
        .eq("interval_minutes", ikey.interval_minutes ?? 15)

      if (ikey.source_event_id) {
        existingQuery = existingQuery.eq("source_event_id", ikey.source_event_id)
      } else if (ikey.reading_timestamp) {
        existingQuery = existingQuery.eq("reading_timestamp", ikey.reading_timestamp)
      } else {
        // No stable key — cannot deduplicate; insert fresh
        outcomes.push(await insertReading(meterId, meter.cooperative_id, r, kwhGenerated, kwhInjected, data.schema_version))
        continue
      }

      const { data: existing } = await existingQuery.limit(2)

      if (existing && existing.length > 0) {
        const first = existing[0]!
        // Idempotent replay: same value → return original
        if (Math.abs(first.kwh_generated - kwhGenerated) < 0.0001) {
          outcomes.push({ index: i, status: "duplicate", reading_id: first.id, existing_id: first.id })
        } else {
          // Conflicting correction — different value with same key
          outcomes.push({
            index: i,
            status: "conflict",
            reading_id: null,
            existing_id: first.id,
            error: `Value conflict: stored=${first.kwh_generated}, submitted=${kwhGenerated}. Submit a correction through the readings API.`,
          })
        }
        continue
      }

      outcomes.push(await insertReading(meterId, meter.cooperative_id, r, kwhGenerated, kwhInjected, data.schema_version, i))
    }

    const created = outcomes.filter((o) => o.status === "created").length
    const duplicates = outcomes.filter((o) => o.status === "duplicate").length
    const conflicts = outcomes.filter((o) => o.status === "conflict").length

    return NextResponse.json(
      {
        schema_version: data.schema_version,
        summary: { total: outcomes.length, created, duplicates, conflicts },
        outcomes,
      },
      { status: 201 }
    )
  } catch (err) {
    return safeCatchError(err)
  }
}

async function insertReading(
  meterId: string,
  cooperativeId: string,
  r: {
    kwh_generated?: number
    kwh_injected?: number
    kwh_self_consumed?: number
    power_watts?: number
    interval_minutes?: number
    reading_timestamp?: string
    reading_date?: string
    source_event_id?: string
    source_metadata?: Record<string, unknown>
  },
  kwhGenerated: number,
  kwhInjected: number,
  schemaVersion: string,
  index = 0
): Promise<ReadingOutcome> {
  const row: Record<string, unknown> = {
    meter_id: meterId,
    cooperative_id: cooperativeId,
    kwh_generated: kwhGenerated,
    kwh_injected: kwhInjected,
    kwh_self_consumed: r.kwh_self_consumed ?? null,
    power_watts: r.power_watts ?? null,
    interval_minutes: r.interval_minutes ?? 15,
    reading_timestamp: r.reading_timestamp ?? null,
    reading_date: r.reading_date ?? null,
    source: "meter",
    status: "pending",
    schema_version: schemaVersion,
  }

  // v2-only fields
  if (r.source_event_id) row.source_event_id = r.source_event_id
  if (r.source_metadata) row.source_metadata = r.source_metadata

  const { data, error } = await supabase.from("readings").insert(row).select("id").single()

  if (error) {
    return { index, status: "conflict", reading_id: null, error: error.message }
  }

  return { index, status: "created", reading_id: data.id }
}

import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"
import { requireAuth, requireAdmin, isSession } from "@/lib/auth/middleware"
import { validateBody } from "@/lib/validation/validate"
import { createReadingSchema, updateReadingSchema } from "@/lib/validation/schemas"
import { safeDbError, safeCatchError } from "@/lib/errors/safe-error"
// Issue #6 — energy calculation domain
import { computeEnergyQuantities, EnergyCalculationError } from "@/lib/domain/energy-calculations"
// Issue #7 — provenance state transitions
import { assertValidStateTransition, ProvenanceError } from "@/lib/domain/reading-provenance"

function getNetInjectedKwh(kwhGenerated: number, kwhSelfConsumed: number) {
  return Math.max(0, kwhGenerated - kwhSelfConsumed)
}

// GET: authenticated — scoped to caller's cooperatives
export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth()
    if (!isSession(session)) return session

    const { searchParams } = new URL(req.url)
    const cooperativeId = searchParams.get("cooperative_id")
    const stellarAddress = searchParams.get("stellar_address")
    const startDate = searchParams.get("start_date")
    const endDate = searchParams.get("end_date")
    const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 50, 1), 100)

    if (startDate && isNaN(Date.parse(startDate))) {
      return NextResponse.json({ error: "Invalid start_date format" }, { status: 400 })
    }
    if (endDate && isNaN(Date.parse(endDate))) {
      return NextResponse.json({ error: "Invalid end_date format" }, { status: 400 })
    }
    if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
      return NextResponse.json({ error: "start_date must be before or equal to end_date" }, { status: 400 })
    }

    let query = supabase
      .from("readings")
      .select("*, prosumers(name, stellar_address)")
      .order("created_at", { ascending: false })
      .limit(limit)

    if (startDate) {
      query = query.gte("created_at", new Date(startDate).toISOString())
    }
    if (endDate) {
      query = query.lte("created_at", new Date(endDate).toISOString())
    }

    if (cooperativeId) {
      if (!session.cooperative_ids.includes(cooperativeId)) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 })
      }
      query = query.eq("cooperative_id", cooperativeId)
    } else if (session.cooperative_ids.length > 0) {
      query = query.in("cooperative_id", session.cooperative_ids)
    } else {
      return NextResponse.json([])
    }

    if (stellarAddress) {
      const { data: prosumer } = await supabase
        .from("prosumers")
        .select("id")
        .eq("stellar_address", stellarAddress)
        .single()

      if (prosumer) {
        query = query.eq("prosumer_id", prosumer.id)
      } else {
        return NextResponse.json([])
      }
    }

    const { data, error } = await query
    if (error) return safeDbError(error)

    return NextResponse.json(data ?? [])
  } catch (err) {
    return safeCatchError(err)
  }
}

// POST: authenticated — member or admin of the cooperative
export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth()
    if (!isSession(session)) return session

    const body = await req.json()
    const v = validateBody(createReadingSchema, body)
    if (!v.success) return v.response

    const { stellar_address, meter_id, kwh_generated, kwh_injected, kwh_self_consumed, kwh_consumed,
            reading_date, reading_timestamp, power_watts, interval_minutes, cooperative_id } = v.data

    const kwhGen = kwh_generated ?? kwh_injected
    const kwhSelf = kwh_self_consumed ?? kwh_consumed

    // Issue #6 — compute canonical energy quantities to validate the input
    // and derive net surplus.  Throws EnergyCalculationError for impossible inputs.
    let energyResult
    try {
      energyResult = computeEnergyQuantities({
        kwh_generated: kwhGen!,
        kwh_self_consumed: kwhSelf ?? null,
        kwh_net_surplus_override: kwh_injected ?? null,
        quality: "measured",
      })
    } catch (err) {
      if (err instanceof EnergyCalculationError) {
        return NextResponse.json({ error: err.message }, { status: 400 })
      }
      throw err
    }

    const kwhInjected = energyResult.kwh_net_surplus

    let prosumerId: string | null = null
    let coopId: string | null = cooperative_id ?? null

    if (stellar_address) {
      const { data: prosumer, error: prosumerError } = await supabase
        .from("prosumers")
        .select("id, cooperative_id")
        .eq("stellar_address", stellar_address)
        .single()

      if (prosumerError || !prosumer) {
        return NextResponse.json(
          { error: "Prosumer not found for this stellar_address" },
          { status: 404 }
        )
      }

      prosumerId = prosumer.id
      if (!coopId) coopId = prosumer.cooperative_id
    }

    if (meter_id) {
      const { data: meter } = await supabase
        .from("meters")
        .select("cooperative_id, member_stellar_address, device_type")
        .eq("id", meter_id)
        .single()

      if (meter) {
        if (!coopId) coopId = meter.cooperative_id
        if (!prosumerId && meter.member_stellar_address) {
          let { data: prosumer } = await supabase
            .from("prosumers")
            .select("id")
            .eq("stellar_address", meter.member_stellar_address)
            .single()
          if (!prosumer) {
            const { data: created } = await supabase
              .from("prosumers")
              .insert({
                stellar_address: meter.member_stellar_address,
                cooperative_id: coopId,
                role: "prosumer",
              })
              .select("id")
              .single()
            prosumer = created
          }
          if (prosumer) prosumerId = prosumer.id
        }
      }
    }

    // Authorization: must be member of the cooperative
    if (coopId && !session.cooperative_ids.includes(coopId)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }

    // Check for duplicate reading on the same date
    if (prosumerId && reading_date) {
      const { data: existing } = await supabase
        .from("readings")
        .select("id")
        .eq("prosumer_id", prosumerId)
        .eq("reading_date", reading_date)
        .single()

      if (existing) {
        return NextResponse.json(
          { error: "A reading already exists for this prosumer on this date" },
          { status: 409 }
        )
      }
    }

    // Issue #7 — determine source_type from meter device type for provenance.
    // We fetch the meter once above; if meter_id was provided we already have device_type.
    let sourceType = "manual"
    if (meter_id) {
      const { data: meterForSource } = await supabase
        .from("meters")
        .select("device_type")
        .eq("id", meter_id)
        .single()

      if (meterForSource?.device_type === "bidirectional_meter") {
        sourceType = "distributor_meter"
      } else if (meterForSource?.device_type === "inverter") {
        sourceType = "inverter"
      } else if (meterForSource?.device_type === "smart_meter") {
        sourceType = "scada"
      }
    }

    const { data: reading, error: insertError } = await supabase
      .from("readings")
      .insert({
        prosumer_id: prosumerId,
        meter_id: meter_id ?? null,
        cooperative_id: coopId,
        kwh_generated: energyResult.kwh_generated,
        kwh_injected: kwhInjected,
        kwh_self_consumed: energyResult.kwh_self_consumed ?? null,
        kwh_net_surplus: kwhInjected,
        power_watts: power_watts ?? null,
        interval_minutes: interval_minutes ?? 15,
        reading_date: reading_date ?? null,
        reading_timestamp: reading_timestamp ?? null,
        // Issue #7 — provenance fields
        source: sourceType,
        source_type: sourceType,
        source_id: meter_id ?? (stellar_address ?? null),
        ingestion_time: new Date().toISOString(),
        measurement_time: reading_timestamp ?? reading_date ?? new Date().toISOString(),
        verification_state: "pending",
        status: "pending",
      })
      .select()
      .single()

    if (insertError) return safeDbError(insertError)

    return NextResponse.json(reading, { status: 201 })
  } catch (err) {
    return safeCatchError(err)
  }
}

// PATCH: admin — update reading status (verify/reject)
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const v = validateBody(updateReadingSchema, body)
    if (!v.success) return v.response

    // Get the reading to check cooperative_id and current verification state
    const { data: reading } = await supabase
      .from("readings")
      .select("cooperative_id, verification_state, status")
      .eq("id", v.data.reading_id)
      .single()

    if (!reading) {
      return NextResponse.json({ error: "Reading not found" }, { status: 404 })
    }

    // Require admin of the cooperative
    const session = await requireAdmin(reading.cooperative_id)
    if (!isSession(session)) return session

    // Issue #7 — validate the verification state transition
    const currentState = reading.verification_state ?? reading.status
    try {
      assertValidStateTransition(
        currentState as "pending" | "verified" | "rejected" | "corrected",
        v.data.status as "pending" | "verified" | "rejected" | "corrected"
      )
    } catch (err) {
      if (err instanceof ProvenanceError) {
        return NextResponse.json({ error: err.message }, { status: 400 })
      }
      throw err
    }

    const updatePayload: Record<string, unknown> = {
      status: v.data.status,
      verification_state: v.data.status,
    }
    if (v.data.status === "verified") {
      updatePayload.verified_by = session.sub
      updatePayload.verified_at = new Date().toISOString()
    }

    // Update reading status
    const { data: updated, error } = await supabase
      .from("readings")
      .update(updatePayload)
      .eq("id", v.data.reading_id)
      .select()
      .single()

    if (error) return safeDbError(error)

    return NextResponse.json(updated)
  } catch (err) {
    return safeCatchError(err)
  }
}

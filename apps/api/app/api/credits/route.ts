/**
 * Issue #8 — Internal credit lifecycle API.
 *
 * GET  /api/credits?cooperative_id=…&state=…
 *   Returns internal credits for a cooperative.  Translates legacy certificate
 *   rows into the new credit state model for backward-compatible reads.
 *
 * POST /api/credits
 *   Creates a new "measured" credit from a verified reading.
 *   Blocks creation if the reading is not verified — prevents unverified
 *   operational data from entering the crediting workflow.
 */

import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"
import { requireAdmin, requireAuth, isSession } from "@/lib/auth/middleware"
import { validateBody } from "@/lib/validation/validate"
import { z } from "zod"
import { safeDbError, safeCatchError } from "@/lib/errors/safe-error"
import {
  mapLegacyStatusToCreditState,
  type CreditState,
  type LegacyCertificateState,
} from "@/lib/domain/credit-lifecycle"
import { assertVerifiedForCrediting } from "@/lib/domain/reading-provenance"

const createCreditSchema = z.object({
  cooperative_id: z.string().uuid(),
  reading_id: z.string().uuid(),
  generation_period_start: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "generation_period_start must be YYYY-MM-DD"),
  generation_period_end: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "generation_period_end must be YYYY-MM-DD"),
  notes: z.string().max(1000).nullish(),
}).refine(
  (d) => d.generation_period_start <= d.generation_period_end,
  { message: "generation_period_start must be before or equal to generation_period_end" }
)

const CREDIT_STATES: CreditState[] = ["measured", "validated", "allocated", "settled", "cancelled"]

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth()
    if (!isSession(session)) return session

    const { searchParams } = new URL(req.url)
    const cooperativeId = searchParams.get("cooperative_id")
    const stateFilter = searchParams.get("state") as CreditState | null

    if (!cooperativeId) {
      return NextResponse.json({ error: "cooperative_id is required" }, { status: 400 })
    }

    if (!session.cooperative_ids.includes(cooperativeId)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }

    if (stateFilter && !CREDIT_STATES.includes(stateFilter)) {
      return NextResponse.json(
        { error: `Invalid state filter. Valid states: ${CREDIT_STATES.join(", ")}` },
        { status: 400 }
      )
    }

    // Fetch new-style credits
    let creditQuery = supabase
      .from("credits")
      .select("*")
      .eq("cooperative_id", cooperativeId)
      .order("created_at", { ascending: false })

    if (stateFilter) {
      creditQuery = creditQuery.eq("state", stateFilter)
    }

    const { data: credits, error: creditsError } = await creditQuery

    // Fetch legacy certificates and translate them into the credit state model
    let legacyQuery = supabase
      .from("certificates")
      .select("id, cooperative_id, generation_period_start, generation_period_end, total_kwh, technology, status, created_at")
      .eq("cooperative_id", cooperativeId)
      .order("created_at", { ascending: false })

    const { data: legacyCerts } = await legacyQuery

    const translatedLegacy = (legacyCerts ?? []).map((cert) => ({
      id: cert.id,
      cooperative_id: cert.cooperative_id,
      generation_period_start: cert.generation_period_start,
      generation_period_end: cert.generation_period_end,
      total_kwh: cert.total_kwh,
      technology: cert.technology,
      state: mapLegacyStatusToCreditState(cert.status as LegacyCertificateState),
      _source: "legacy_certificate" as const,
      created_at: cert.created_at,
    }))

    // Filter translated legacy by state if requested
    const filteredLegacy = stateFilter
      ? translatedLegacy.filter((c) => c.state === stateFilter)
      : translatedLegacy

    if (creditsError) return safeDbError(creditsError)

    return NextResponse.json({
      credits: credits ?? [],
      legacy_credits: filteredLegacy,
    })
  } catch (err) {
    return safeCatchError(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const v = validateBody(createCreditSchema, body)
    if (!v.success) return v.response

    const { cooperative_id, reading_id, generation_period_start, generation_period_end, notes } = v.data

    const session = await requireAdmin(cooperative_id)
    if (!isSession(session)) return session

    // Fetch the reading and check provenance
    const { data: reading, error: readingError } = await supabase
      .from("readings")
      .select("id, cooperative_id, kwh_generated, kwh_self_consumed, status, source_type, verification_state")
      .eq("id", reading_id)
      .single()

    if (readingError || !reading) {
      return NextResponse.json({ error: "Reading not found" }, { status: 404 })
    }

    if (reading.cooperative_id !== cooperative_id) {
      return NextResponse.json(
        { error: "Reading does not belong to this cooperative" },
        { status: 400 }
      )
    }

    // Block unverified readings — Issue #7 guard
    try {
      assertVerifiedForCrediting({
        source_type: reading.source_type ?? "manual",
        verification_state: reading.verification_state ?? reading.status,
        id: reading.id,
      })
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Reading not verified" },
        { status: 422 }
      )
    }

    // Compute net surplus as the creditable kWh (Issue #6 guard)
    const kwhGenerated: number = reading.kwh_generated ?? 0
    const kwhSelfConsumed: number = reading.kwh_self_consumed ?? 0
    const kwhNetSurplus = Math.max(0, kwhGenerated - kwhSelfConsumed)

    if (kwhNetSurplus <= 0) {
      return NextResponse.json(
        {
          error: `Net surplus is ${kwhNetSurplus} kWh (generated=${kwhGenerated}, self_consumed=${kwhSelfConsumed}). No energy to credit.`,
        },
        { status: 400 }
      )
    }

    const { data: credit, error: insertError } = await supabase
      .from("credits")
      .insert({
        cooperative_id,
        reading_id,
        generation_period_start,
        generation_period_end,
        kwh_net_surplus: kwhNetSurplus,
        kwh_generated: kwhGenerated,
        kwh_self_consumed: kwhSelfConsumed,
        state: "measured",
        notes: notes ?? null,
        created_by: session.sub,
      })
      .select()
      .single()

    if (insertError) return safeDbError(insertError)

    return NextResponse.json(credit, { status: 201 })
  } catch (err) {
    return safeCatchError(err)
  }
}

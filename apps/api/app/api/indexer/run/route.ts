import { NextRequest, NextResponse } from "next/server"
import { timingSafeEqual } from "node:crypto"
import { runConfiguredIndexer } from "@/server/stellar/run-indexer"

export const dynamic = "force-dynamic"

function authorized(req: NextRequest): boolean {
  const secret = process.env.INDEXER_CRON_SECRET || process.env.CRON_SECRET
  if (!secret) return false
  const header = req.headers.get("authorization") ?? ""
  const expected = Buffer.from(`Bearer ${secret}`)
  const given = Buffer.from(header)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const backfillGaps = new URL(req.url).searchParams.get("backfill_gaps") === "true"

  try {
    const summary = await runConfiguredIndexer({ backfillGaps })
    if (summary.gapsDetected.length > 0) {
      console.warn("[indexer] gaps detected", summary.gapsDetected)
    }
    return NextResponse.json(summary)
  } catch (err) {
    console.error("[indexer] run failed", err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "Indexer run failed" }, { status: 500 })
  }
}

// GET for scheduled cron invocations, POST for manual runs. Both require the cron secret.
export const GET = handle
export const POST = handle

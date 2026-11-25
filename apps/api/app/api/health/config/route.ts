import { NextResponse } from "next/server"
import { getStellarConfigReport, publicConfigSummary } from "@/server/stellar/network-config"

export const dynamic = "force-dynamic"

// GET: public — secret-free Stellar configuration fingerprint for deploy verification
export async function GET() {
  const summary = publicConfigSummary(getStellarConfigReport())
  return NextResponse.json(summary, {
    status: summary.errors.length === 0 ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  })
}

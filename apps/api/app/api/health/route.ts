import { NextResponse } from "next/server"

export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoints: {
      liveness: "/api/health/live",
      readiness: "/api/health/ready",
    },
    timestamp: new Date().toISOString(),
  })
}

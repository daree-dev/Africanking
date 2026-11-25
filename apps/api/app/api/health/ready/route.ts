import { NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"

const TIMEOUT_MS = 5000

export async function GET() {
  const timeoutPromise = new Promise<{ ok: false; error: string }>((resolve) =>
    setTimeout(() => resolve({ ok: false, error: "Database timeout" }), TIMEOUT_MS)
  )

  const dbPromise = (async () => {
    try {
      const { error } = await supabase.from("cooperatives").select("id").limit(1)
      if (error) return { ok: false, error: "Database query error" }
      return { ok: true }
    } catch {
      return { ok: false, error: "Database connection failed" }
    }
  })()

  const dbResult = await Promise.race([dbPromise, timeoutPromise])

  if (!dbResult.ok) {
    return NextResponse.json(
      {
        status: "unhealthy",
        dependencies: {
          database: "down",
        },
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    )
  }

  return NextResponse.json({
    status: "ready",
    dependencies: {
      database: "healthy",
    },
    timestamp: new Date().toISOString(),
  })
}

import { NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"

interface RateLimitConfig {
  maxRequests: number
  windowMs: number
}

/**
 * Route-specific rate limits for authentication and write endpoints.
 * Keys are matched against the `route` argument passed to checkRateLimit.
 */
const RATE_LIMITS: Record<string, RateLimitConfig> = {
  // Authentication
  "auth/challenge": { maxRequests: 10, windowMs: 60_000 },
  "auth/verify": { maxRequests: 5, windowMs: 60_000 },
  "auth/email": { maxRequests: 5, windowMs: 60_000 },
  // Profile
  "profile/update": { maxRequests: 10, windowMs: 60_000 },
  // Ingestion
  "meters/readings": { maxRequests: 10, windowMs: 60_000 },
  readings: { maxRequests: 60, windowMs: 60_000 },
  // Review
  "review/submit": { maxRequests: 20, windowMs: 60_000 },
  // Mint / retire (write actions)
  mint: { maxRequests: 10, windowMs: 3_600_000 },
  retire: { maxRequests: 10, windowMs: 3_600_000 },
  // Defaults
  post_default: { maxRequests: 30, windowMs: 60_000 },
  get_default: { maxRequests: 120, windowMs: 60_000 },
}

function getWindowStart(windowMs: number): string {
  const now = Date.now()
  const windowStart = now - (now % windowMs)
  return new Date(windowStart).toISOString()
}

function getRetryAfterSeconds(windowMs: number): number {
  const now = Date.now()
  const windowStart = now - (now % windowMs)
  const windowEnd = windowStart + windowMs
  return Math.max(1, Math.ceil((windowEnd - now) / 1000))
}

/**
 * Atomically increments the counter for the given key/window and returns the
 * resulting count. The `increment_rate_limit` RPC must perform an atomic
 * upsert/increment so concurrent serverless instances share the same window.
 */
async function incrementCounter(
  key: string,
  windowStart: string
): Promise<number> {
  const { data, error } = await supabase.rpc("increment_rate_limit", {
    p_key: key,
    p_window_start: windowStart,
  })

  if (error) throw error

  const count = (data as { count: number } | null)?.count
  if (typeof count !== "number") {
    throw new Error("increment_rate_limit returned no count")
  }
  return count
}

export async function checkRateLimit(
  identifier: string,
  route: string
): Promise<NextResponse | null> {
  const config = RATE_LIMITS[route] ?? RATE_LIMITS.post_default

  const key = `${route}:${identifier}`
  const windowStart = getWindowStart(config.windowMs)

  let count: number
  try {
    count = await incrementCounter(key, windowStart)
  } catch {
    // Safe degradation: if the limiter is unavailable, allow the request but
    // emit a threshold event so operators can alert. Never log identifiers or
    // secrets here.
    console.error("[Rate Limit] Limiter unavailable, allowing request", {
      route,
      event: "rate_limit_unavailable",
    })
    return null
  }

  if (count > config.maxRequests) {
    const retryAfter = getRetryAfterSeconds(config.windowMs)
    console.warn("[Rate Limit] Threshold exceeded", {
      route,
      event: "rate_limit_exceeded",
      count,
      maxRequests: config.maxRequests,
    })
    return NextResponse.json(
      { error: "Too many requests", retryAfter },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfter) },
      }
    )
  }

  return null
}

/**
 * Extract a stable client identifier from the request.
 *
 * Prefers platform-provided headers that are set by the trusted edge/proxy
 * (e.g. Vercel's `x-real-ip`). `x-forwarded-for` is only used as a fallback
 * and its left-most entry is taken, since it can be spoofed by clients when
 * the deployment does not strip/overwrite it. Callers should prefer passing a
 * verified user id when available.
 */
export function getClientIp(req: Request): string {
  const realIp = req.headers.get("x-real-ip")
  if (realIp) return realIp.trim()

  const forwarded = req.headers.get("x-forwarded-for")
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim()
    if (first) return first
  }

  return "unknown"
}

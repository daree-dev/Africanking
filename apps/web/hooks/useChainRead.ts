"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ChainReadCache,
  computeBackoffDelay,
  freshnessOf,
  readThroughCache,
  type ChainOperation,
  type ChainReadResult,
  type FreshnessStatus,
} from "@/lib/stellar/resilience"

/** Background refresh attempts after an outage before giving up (manual retry remains). */
export const BACKGROUND_RETRY_LIMIT = 5
const BACKGROUND_RETRY_BASE_MS = 5_000
const BACKGROUND_RETRY_MAX_MS = 60_000

export interface ChainReadState<T> {
  value: T | null
  status: FreshnessStatus
  fetchedAt: number | null
  error: string | null
  /** Background retry schedule while stale/unavailable; null when not retrying. */
  retry: { attempt: number; maxAttempts: number; nextRetryAt: number } | null
  isRefreshing: boolean
  refetch: () => void
}

const sharedCache = typeof window !== "undefined" ? new ChainReadCache() : undefined

/**
 * Read chain-derived data with freshness tracking.
 *
 * - `live`: fetched successfully just now.
 * - `stale`: RPC/Horizon unreachable; showing the last good cached value.
 * - `unavailable`: unreachable and nothing (recent enough) cached — callers
 *   must render "unavailable", never a default like 0.
 *
 * While stale/unavailable for a transient reason, retries in the background
 * with bounded exponential backoff and exposes the schedule.
 */
export function useChainRead<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  operation: ChainOperation,
  options: { cache?: ChainReadCache } = {},
): ChainReadState<T> {
  const cache = options.cache ?? sharedCache
  const [result, setResult] = useState<ChainReadResult<T> | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [retry, setRetry] = useState<ChainReadState<T>["retry"]>(null)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  const attemptRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const runIdRef = useRef(0)

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
  }

  const run = useCallback(async (isBackground: boolean) => {
    if (!key) return
    const runId = ++runIdRef.current
    clearTimer()
    if (!isBackground) attemptRef.current = 0
    setIsRefreshing(true)

    // Seed with cache immediately so the UI never flashes empty while loading.
    if (!isBackground && cache) {
      const cached = cache.get<T>(key)
      if (cached) {
        setResult((prev) => prev ?? { value: cached.value, fetchedAt: cached.fetchedAt, source: "cache", stale: true, error: null, retryable: false })
      }
    }

    const next = await readThroughCache(key, () => fetcherRef.current(), { operation, cache })
    if (runId !== runIdRef.current) return
    setResult(next)
    setIsRefreshing(false)

    if (next.source !== "live" && next.retryable && attemptRef.current < BACKGROUND_RETRY_LIMIT) {
      attemptRef.current += 1
      const delay = computeBackoffDelay(attemptRef.current, {
        baseDelayMs: BACKGROUND_RETRY_BASE_MS,
        maxDelayMs: BACKGROUND_RETRY_MAX_MS,
        jitter: true,
      })
      setRetry({ attempt: attemptRef.current, maxAttempts: BACKGROUND_RETRY_LIMIT, nextRetryAt: Date.now() + delay })
      timerRef.current = setTimeout(() => void run(true), delay)
    } else {
      setRetry(null)
    }
  }, [key, operation, cache])

  useEffect(() => {
    setResult(null)
    void run(false)
    return () => {
      runIdRef.current++
      clearTimer()
    }
  }, [run])

  const refetch = useCallback(() => void run(false), [run])

  return useMemo(
    () => ({
      value: result?.value ?? null,
      status: freshnessOf(result),
      fetchedAt: result?.fetchedAt ?? null,
      error: result?.error ?? null,
      retry,
      isRefreshing,
      refetch,
    }),
    [result, retry, isRefreshing, refetch],
  )
}

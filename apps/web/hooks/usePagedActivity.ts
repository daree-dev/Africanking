"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { FetchErrorKind, PageResult } from "@/lib/activity/types"

export type PagedStatus = "idle" | "loading" | "ready" | "account_not_found" | "unsupported" | "error"

export interface PagedActivityState<T> {
  records: T[]
  status: PagedStatus
  isLoading: boolean
  isLoadingMore: boolean
  hasMore: boolean
  error: string | null
  errorKind: FetchErrorKind | null
  unsupportedReason: string | null
  refetch: () => void
  loadMore: () => void
}

/**
 * Shared paging state machine for activity sources. `key` identifies the
 * query (address + network + endpoint); when it changes, in-flight responses
 * for the old key are discarded so switching networks or accounts can never
 * show stale rows.
 */
export function usePagedActivity<T>(
  key: string | null,
  fetchPage: (cursor: string | null) => Promise<PageResult<T>>
): PagedActivityState<T> {
  const [records, setRecords] = useState<T[]>([])
  const [status, setStatus] = useState<PagedStatus>("idle")
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorKind, setErrorKind] = useState<FetchErrorKind | null>(null)
  const [unsupportedReason, setUnsupportedReason] = useState<string | null>(null)
  const generation = useRef(0)
  const fetchRef = useRef(fetchPage)
  fetchRef.current = fetchPage

  const apply = useCallback((result: PageResult<T>, append: boolean) => {
    switch (result.status) {
      case "ok":
        setRecords((prev) => (append ? [...prev, ...result.records] : result.records))
        setCursor(result.nextCursor)
        setHasMore(result.hasMore)
        setStatus("ready")
        return
      case "account_not_found":
        setRecords([])
        setHasMore(false)
        setStatus("account_not_found")
        return
      case "unsupported":
        if (!append) setRecords([])
        setHasMore(false)
        setUnsupportedReason(result.reason)
        setStatus(append ? "ready" : "unsupported")
        return
      case "error":
        if (!append) setRecords([])
        setError(result.message)
        setErrorKind(result.kind)
        setStatus(append ? "ready" : "error")
        return
    }
  }, [])

  const load = useCallback(async () => {
    const gen = ++generation.current
    setError(null)
    setErrorKind(null)
    setUnsupportedReason(null)
    setCursor(null)
    setHasMore(false)
    if (!key) {
      setRecords([])
      setStatus("idle")
      return
    }
    setStatus("loading")
    const result = await fetchRef.current(null)
    if (gen === generation.current) apply(result, false)
  }, [key, apply])

  const loadMore = useCallback(async () => {
    if (!key || !cursor || !hasMore || isLoadingMore) return
    const gen = generation.current
    setIsLoadingMore(true)
    setError(null)
    setErrorKind(null)
    try {
      const result = await fetchRef.current(cursor)
      if (gen === generation.current) apply(result, true)
    } finally {
      if (gen === generation.current) setIsLoadingMore(false)
    }
  }, [key, cursor, hasMore, isLoadingMore, apply])

  useEffect(() => {
    void load()
  }, [load])

  return {
    records,
    status,
    isLoading: status === "loading",
    isLoadingMore,
    hasMore,
    error,
    errorKind,
    unsupportedReason,
    refetch: () => void load(),
    loadMore: () => void loadMore(),
  }
}

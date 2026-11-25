"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, CheckCircle2, CloudOff, RefreshCw } from "lucide-react"
import { useI18n } from "@/lib/i18n-context"
import { cn } from "@/lib/utils"
import type { FreshnessStatus } from "@/lib/stellar/resilience"

export function formatAge(fetchedAt: number, now: number, t: (key: string) => string): string {
  const minutes = Math.floor(Math.max(0, now - fetchedAt) / 60_000)
  if (minutes < 1) return t("chain.age.now")
  if (minutes < 60) return t("chain.age.minutes").replace("{n}", String(minutes))
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t("chain.age.hours").replace("{n}", String(hours))
  return t("chain.age.days").replace("{n}", String(Math.floor(hours / 24)))
}

interface ChainFreshnessIndicatorProps {
  status: FreshnessStatus
  fetchedAt: number | null
  retry?: { attempt: number; maxAttempts: number; nextRetryAt: number } | null
  onRetry?: () => void
  /** Injected for deterministic rendering in tests. */
  now?: number
  className?: string
}

/**
 * Small status line that tells the user whether chain-derived numbers are
 * live, cached (stale) or unavailable, and when the next retry happens.
 */
export function ChainFreshnessIndicator({ status, fetchedAt, retry, onRetry, now, className }: ChainFreshnessIndicatorProps) {
  const { t } = useI18n()
  const [tick, setTick] = useState(() => now ?? Date.now())

  useEffect(() => {
    if (now !== undefined) return
    const id = setInterval(() => setTick(Date.now()), 1_000)
    return () => clearInterval(id)
  }, [now])

  const current = now ?? tick
  const age = fetchedAt ? formatAge(fetchedAt, current, t) : ""

  let label: string
  let Icon = CheckCircle2
  let tone = "text-muted-foreground"
  switch (status) {
    case "loading":
      label = t("chain.freshness.loading")
      Icon = RefreshCw
      break
    case "live":
      label = t("chain.freshness.live").replace("{age}", age)
      tone = "text-energy-green"
      break
    case "stale":
      label = t("chain.freshness.stale").replace("{age}", age)
      Icon = AlertTriangle
      tone = "text-solar-orange"
      break
    default:
      label = t("chain.freshness.unavailable")
      Icon = CloudOff
      tone = "text-destructive"
  }

  const retryText =
    retry && (status === "stale" || status === "unavailable")
      ? t("chain.freshness.retrying")
          .replace("{attempt}", String(retry.attempt))
          .replace("{max}", String(retry.maxAttempts))
          .replace("{seconds}", String(Math.max(0, Math.ceil((retry.nextRetryAt - current) / 1000))))
      : null

  return (
    <div
      role="status"
      aria-live="polite"
      data-freshness={status}
      className={cn("flex flex-wrap items-center gap-2 text-xs", tone, className)}
    >
      <Icon className={cn("w-3.5 h-3.5 shrink-0", status === "loading" && "animate-spin")} aria-hidden="true" />
      <span>{label}</span>
      {retryText && <span className="text-muted-foreground">· {retryText}</span>}
      {onRetry && (status === "stale" || status === "unavailable") && (
        <button type="button" onClick={onRetry} className="underline underline-offset-2 hover:text-foreground">
          {t("chain.freshness.retryNow")}
        </button>
      )}
    </div>
  )
}

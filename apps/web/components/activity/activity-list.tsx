"use client"

import { ArrowDownLeft, ArrowUpRight, Coins, ExternalLink, Flame, Info, AlertTriangle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useI18n } from "@/lib/i18n-context"
import type { ActivityDisplayItem, ActivitySource, ActivitySourceKind, FetchErrorKind } from "@/lib/activity/types"
import type { PagedStatus } from "@/hooks/usePagedActivity"

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
}

const SOURCE_KEYS: Record<ActivitySourceKind, string> = {
  horizon: "activity.source.horizon",
  "soroban-rpc": "activity.source.sorobanRpc",
  "cooperative-records": "activity.source.cooperativeRecords",
}

export function ActivityRow({ item }: { item: ActivityDisplayItem }) {
  const { t } = useI18n()
  let icon = <ArrowUpRight className="w-5 h-5 text-primary" />
  let color = "text-primary"
  let prefix = ""

  if (item.icon === "mint") {
    icon = <Coins className="w-5 h-5 text-success" />
    color = "text-success"
    prefix = "+"
  } else if (item.icon === "burn") {
    icon = <Flame className="w-5 h-5 text-destructive" />
    color = "text-destructive"
    prefix = "-"
  } else if (item.direction === "in") {
    icon = <ArrowDownLeft className="w-5 h-5 text-success" />
    color = "text-success"
    prefix = "+"
  } else if (item.direction === "out") {
    prefix = "-"
  }

  return (
    <div className="flex items-center gap-3 p-4 rounded-lg hover:bg-muted transition-colors border border-border">
      <div className="flex-shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium text-sm md:text-base capitalize">{item.label}</p>
          <Badge variant="outline" className="text-[10px] font-normal">
            {t(SOURCE_KEYS[item.source])}
          </Badge>
          {item.explorerUrl && (
            <a
              href={item.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-primary transition-colors"
              aria-label="View on Stellar Expert"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
        </div>
        <p className="text-xs md:text-sm text-muted-foreground">
          {formatDate(item.createdAt)} · {formatTime(item.createdAt)}
        </p>
      </div>
      <div className={`flex-shrink-0 font-semibold text-sm md:text-base ${color}`}>
        {item.amount ? prefix : ""}
        {item.amount ?? "–"} {item.asset}
      </div>
    </div>
  )
}

export function DataSourceLine({ sources }: { sources: ActivitySource[] }) {
  const { t } = useI18n()
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <Info className="w-3.5 h-3.5" />
      <span>{t("activity.dataSources")}:</span>
      {sources.map((s) => (
        <Badge key={s.kind} variant="secondary" className="font-normal">
          {t(SOURCE_KEYS[s.kind])} · {s.network} · {s.endpoint}
        </Badge>
      ))}
    </div>
  )
}

const ERROR_KEYS: Record<FetchErrorKind, string> = {
  outage: "activity.error.outage",
  rate_limited: "activity.error.rateLimited",
  network: "activity.error.network",
  bad_response: "activity.error.badResponse",
}

/** Inline notice describing a source that could not provide data. */
export function SourceNotice({
  sourceKind,
  status,
  errorKind,
  unsupportedReason,
  onRetry,
}: {
  sourceKind: ActivitySourceKind
  status: PagedStatus
  errorKind: FetchErrorKind | null
  unsupportedReason?: string | null
  onRetry?: () => void
}) {
  const { t } = useI18n()
  let message: string | null = null
  let tone: "warn" | "info" = "warn"

  if (status === "error") message = t(ERROR_KEYS[errorKind ?? "network"])
  else if (status === "account_not_found") {
    message = t("activity.accountNotFound")
    tone = "info"
  } else if (status === "unsupported") {
    message = `${t("activity.eventsUnsupported")}${unsupportedReason ? ` (${unsupportedReason})` : ""}`
    tone = "info"
  }
  if (!message) return null

  return (
    <div
      role={tone === "warn" ? "alert" : "status"}
      className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
        tone === "warn" ? "border-destructive/40 text-destructive" : "border-border text-muted-foreground"
      }`}
    >
      {tone === "warn" ? <AlertTriangle className="w-4 h-4 mt-0.5" /> : <Info className="w-4 h-4 mt-0.5" />}
      <div className="flex-1">
        <span className="font-medium">{t(SOURCE_KEYS[sourceKind])}:</span> {message}
      </div>
      {tone === "warn" && onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t("activity.retry")}
        </Button>
      )}
    </div>
  )
}

export function LoadMoreButton({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  const { t } = useI18n()
  return (
    <div className="flex justify-center pt-2">
      <Button variant="outline" size="sm" onClick={onClick} disabled={loading}>
        {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        {loading ? t("activity.loadingMore") : t("activity.loadMore")}
      </Button>
    </div>
  )
}

/** Shown when the connected wallet or app config disagree with the data network. */
export function NetworkNotice({ walletMismatch, configIssues }: { walletMismatch: string | null; configIssues: string[] }) {
  const { t } = useI18n()
  if (!walletMismatch && configIssues.length === 0) return null
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
      <AlertTriangle className="w-4 h-4 mt-0.5 text-warning" />
      <div className="space-y-1">
        {walletMismatch && (
          <p>
            {t("activity.networkMismatch")} {walletMismatch}
          </p>
        )}
        {configIssues.map((issue) => (
          <p key={issue}>
            {t("activity.configInvalid")} {issue}
          </p>
        ))}
      </div>
    </div>
  )
}

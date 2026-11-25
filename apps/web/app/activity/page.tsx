"use client"

import { useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import { useWallet } from "@/lib/wallet-context"
import { useAuth } from "@/lib/auth-context"
import { useI18n } from "@/lib/i18n-context"
import { useHorizonPayments } from "@/hooks/useHorizonPayments"
import { useContractEvents } from "@/hooks/useContractEvents"
import { useEvents } from "@/hooks/useEvents"
import { Sidebar } from "@/components/sidebar"
import { DashboardHeader } from "@/components/dashboard-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowLeft, ArrowDownLeft, ArrowUpRight, Loader2 } from "lucide-react"
import Link from "next/link"
import { APP_NETWORK } from "@/lib/stellar-network"
import {
  contractEventToDisplay,
  mergeActivity,
  paymentToDisplay,
  recordedEventToActivity,
} from "@/lib/activity/display"
import type { ActivitySource } from "@/lib/activity/types"
import {
  ActivityRow,
  DataSourceLine,
  LoadMoreButton,
  NetworkNotice,
  SourceNotice,
} from "@/components/activity/activity-list"

export default function ActivityPage() {
  const { isConnected, address, networkMismatch: walletMismatch } = useWallet()
  const { session, isLoading: authLoading } = useAuth()
  const { t } = useI18n()
  const router = useRouter()
  const payments = useHorizonPayments(address)
  const contractEvents = useContractEvents(address)
  const recorded = useEvents(address)

  const isInitialLoading =
    (payments.isLoading || contractEvents.isLoading || recorded.isLoading) &&
    payments.records.length === 0 &&
    contractEvents.records.length === 0 &&
    recorded.events.length === 0


  const sources = useMemo<ActivitySource[]>(
    () => [
      payments.source,
      contractEvents.source,
      { kind: "cooperative-records", network: APP_NETWORK.network, endpoint: "Africanking API" },
    ],
    [payments.source, contractEvents.source]
  )

  const items = useMemo(() => {
    if (!address) return []
    return mergeActivity([
      payments.records.map((p) => paymentToDisplay(p, address, APP_NETWORK)),
      contractEvents.records.map((e) => contractEventToDisplay(e, address, APP_NETWORK, "soroban-rpc")),
      recorded.events.map((e) =>
        contractEventToDisplay(recordedEventToActivity(e), address, APP_NETWORK, "cooperative-records")
      ),
    ])
  }, [address, payments.records, contractEvents.records, recorded.events])

  const refetchAll = () => {
    payments.refetch()
    contractEvents.refetch()
    recorded.refetch()
  }

  const loadMore = () => {
    if (payments.hasMore) payments.loadMore()
    if (contractEvents.hasMore) contractEvents.loadMore()
  }

  useEffect(() => {
    if (!authLoading && !isConnected && !session) {
      router.push("/")
    }
  }, [isConnected, session, authLoading, router])

  if (!isConnected && !session) {
    return null
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />

      <main className="md:ml-64">
        <DashboardHeader />

        <div className="p-4 md:p-6 space-y-6">
          <Button onClick={() => router.push("/dashboard")} variant="ghost" className="mb-2 hover:bg-muted">
            <ArrowLeft className="w-4 h-4 mr-2" />
            {t("common.back")}
          </Button>

          <NetworkNotice walletMismatch={walletMismatch} configIssues={APP_NETWORK.issues} />

          {/* Navigation cards */}
          <div className="grid gap-6 md:grid-cols-2">
            <Link href="/activity/purchases">
              <Card className="hover:bg-muted/50 transition-all cursor-pointer h-full group border-2 hover:border-primary">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-lg bg-success/10 group-hover:bg-success/20 transition-colors">
                      <ArrowDownLeft className="w-6 h-6 text-success" />
                    </div>
                    <div>
                      <CardTitle className="text-xl">{t("activity.received")}</CardTitle>
                      <CardDescription>{t("activity.receivedDescription")}</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{t("activity.lastTwoMonths")}</p>
                </CardContent>
              </Card>
            </Link>

            <Link href="/activity/sales">
              <Card className="hover:bg-muted/50 transition-all cursor-pointer h-full group border-2 hover:border-primary">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
                      <ArrowUpRight className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-xl">{t("activity.sent")}</CardTitle>
                      <CardDescription>{t("activity.sentDescription")}</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{t("activity.lastTwoMonths")}</p>
                </CardContent>
              </Card>
            </Link>
          </div>

          {/* Recent activity: Horizon payments + Soroban contract events + cooperative records */}
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">{t("activity.recentPayments")}</CardTitle>
              <CardDescription>{t("activity.recentPaymentsDescription")}</CardDescription>
              <DataSourceLine sources={sources} />
            </CardHeader>
            <CardContent className="space-y-3">
              <SourceNotice
                sourceKind="horizon"
                status={payments.status}
                errorKind={payments.errorKind}
                onRetry={payments.refetch}
              />
              <SourceNotice
                sourceKind="soroban-rpc"
                status={contractEvents.status}
                errorKind={contractEvents.errorKind}
                unsupportedReason={contractEvents.unsupportedReason}
                onRetry={contractEvents.refetch}
              />
              {recorded.error && (
                <SourceNotice
                  sourceKind="cooperative-records"
                  status="error"
                  errorKind="network"
                  onRetry={recorded.refetch}
                />
              )}

              {isInitialLoading ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  {t("activity.loading")}
                </div>
              ) : items.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-8 text-muted-foreground">
                  <span>{t("activity.noTransactions")}</span>
                  <Button variant="outline" size="sm" onClick={refetchAll}>
                    {t("activity.retry")}
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {items.map((item) => (
                    <ActivityRow key={item.id} item={item} />
                  ))}
                </div>
              )}

              {(payments.hasMore || contractEvents.hasMore) && (
                <LoadMoreButton
                  onClick={loadMore}
                  loading={payments.isLoadingMore || contractEvents.isLoadingMore}
                />
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}

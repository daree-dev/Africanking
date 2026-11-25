"use client"

import { useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import { useWallet } from "@/lib/wallet-context"
import { useAuth } from "@/lib/auth-context"
import { useI18n } from "@/lib/i18n-context"
import { useHorizonPayments } from "@/hooks/useHorizonPayments"
import { Sidebar } from "@/components/sidebar"
import { DashboardHeader } from "@/components/dashboard-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowLeft, ArrowDownLeft, ArrowUpRight, Loader2 } from "lucide-react"
import { APP_NETWORK } from "@/lib/stellar-network"
import { paymentToDisplay } from "@/lib/activity/display"
import { ActivityRow, DataSourceLine, LoadMoreButton, NetworkNotice, SourceNotice } from "./activity-list"

/**
 * Received ("in") or sent ("out") classic payments over the last two months.
 * Horizon payments only — Soroban token events are shown on /activity.
 */
export function PaymentDirectionView({ direction }: { direction: "in" | "out" }) {
  const { isConnected, address, networkMismatch: walletMismatch } = useWallet()
  const { session, isLoading: authLoading } = useAuth()
  const { t } = useI18n()
  const router = useRouter()
  const payments = useHorizonPayments(address)

  useEffect(() => {
    if (!authLoading && !isConnected && !session) {
      router.push("/")
    }
  }, [isConnected, session, authLoading, router])

  const since = useMemo(() => {
    const d = new Date()
    d.setMonth(d.getMonth() - 2)
    return d
  }, [])

  const items = useMemo(() => {
    if (!address) return []
    return payments.records
      .map((p) => paymentToDisplay(p, address, APP_NETWORK))
      .filter((item) => item.direction === direction && new Date(item.createdAt) >= since)
  }, [payments.records, address, direction, since])

  // Records are newest-first; only offer more pages while the oldest loaded
  // record is still inside the two-month window.
  const oldest = payments.records[payments.records.length - 1]
  const canLoadMore = payments.hasMore && !!oldest && new Date(oldest.createdAt) >= since

  if (!isConnected && !session) {
    return null
  }

  const isIncoming = direction === "in"
  const Icon = isIncoming ? ArrowDownLeft : ArrowUpRight

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />

      <main className="md:ml-64">
        <DashboardHeader />

        <div className="p-4 md:p-6 space-y-4">
          <Button onClick={() => router.push("/activity")} variant="ghost" className="hover:bg-muted">
            <ArrowLeft className="w-4 h-4 mr-2" />
            {t("common.back")}
          </Button>

          <NetworkNotice walletMismatch={walletMismatch} configIssues={APP_NETWORK.issues} />

          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className={`p-3 rounded-lg ${isIncoming ? "bg-success/10" : "bg-primary/10"}`}>
                  <Icon className={`w-6 h-6 ${isIncoming ? "text-success" : "text-primary"}`} />
                </div>
                <div>
                  <CardTitle className="text-xl md:text-2xl">
                    {t(isIncoming ? "activity.received" : "activity.sent")}
                  </CardTitle>
                  <CardDescription>
                    {t(isIncoming ? "activity.receivedDescription" : "activity.sentDescription")}
                  </CardDescription>
                </div>
              </div>
              <DataSourceLine sources={[payments.source]} />
            </CardHeader>
            <CardContent className="space-y-3">
              <SourceNotice
                sourceKind="horizon"
                status={payments.status}
                errorKind={payments.errorKind}
                onRetry={payments.refetch}
              />

              {payments.isLoading ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  {t("activity.loading")}
                </div>
              ) : payments.status === "ready" && items.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  {t(isIncoming ? "activity.noReceived" : "activity.noSent")}
                </div>
              ) : (
                <div className="space-y-3">
                  {items.map((item) => (
                    <ActivityRow key={item.id} item={item} />
                  ))}
                </div>
              )}

              {canLoadMore && <LoadMoreButton onClick={payments.loadMore} loading={payments.isLoadingMore} />}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}

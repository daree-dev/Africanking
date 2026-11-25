"use client"

/**
 * MemberSettlementPanel (issue #9)
 *
 * Shows a member's energy credit allocations from cooperative settlement periods.
 *
 * Design rules enforced here:
 * - Labels say "kWh credited" and "energy credit" — never "payment", "invoice",
 *   "purchase", or any monetary term.
 * - On-chain token status (mint_tx_hash / onchain_status) is shown separately
 *   from the settlement approval status so members can distinguish the two.
 * - No I-REC / ESG retirement language appears in this cooperative-member view.
 */

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { InfoTooltip } from "@/components/shared/info-tooltip"
import { ReceiptText, Zap, ExternalLink, CheckCircle2, Clock, AlertCircle } from "lucide-react"
import type { EnergyCredit, SettlementPeriod, MemberAllocation } from "@/lib/types/settlement"
import { getStellarExpertUrl } from "@/lib/utils"

interface SettlementRow {
  settlement: SettlementPeriod
  allocation: MemberAllocation | null
  credit: EnergyCredit | null
}

interface MemberSettlementPanelProps {
  memberAddress: string
  cooperativeIds: string[]
}

function periodLabel(start: string, end: string) {
  const fmt = (d: string) =>
    new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
  return `${fmt(start)} – ${fmt(end)}`
}

function SettlementStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    draft: "bg-muted text-muted-foreground",
    pending: "bg-solar-yellow/10 text-solar-yellow border border-solar-yellow/20",
    approved: "bg-energy-green/10 text-energy-green border border-energy-green/20",
    corrected: "bg-blue-500/10 text-blue-500 border border-blue-500/20",
    closed: "bg-muted text-foreground border border-border",
  }
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${styles[status] ?? "bg-muted text-muted-foreground"}`}>
      {status}
    </span>
  )
}

function OnchainStatusBadge({ status }: { status: string }) {
  if (status === "minted")
    return (
      <span className="inline-flex items-center gap-1 text-xs text-energy-green">
        <CheckCircle2 className="w-3 h-3" /> Token minted
      </span>
    )
  if (status === "mint_failed")
    return (
      <span className="inline-flex items-center gap-1 text-xs text-destructive">
        <AlertCircle className="w-3 h-3" /> Mint failed
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Clock className="w-3 h-3" /> Pending mint
    </span>
  )
}

export function MemberSettlementPanel({ memberAddress, cooperativeIds }: MemberSettlementPanelProps) {
  const [rows, setRows] = useState<SettlementRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!cooperativeIds.length) return

    setLoading(true)
    setError(null)

    Promise.all(
      cooperativeIds.map((coopId) =>
        fetch(`/api/settlements?cooperative_id=${coopId}`)
          .then((r) => r.json())
          .then((d) => (d.settlements ?? []) as SettlementPeriod[])
          .catch(() => [] as SettlementPeriod[])
      )
    )
      .then((arrays) => arrays.flat())
      .then(async (settlements) => {
        const detailedRows = await Promise.all(
          settlements.map(async (s) => {
            try {
              const r = await fetch(`/api/settlements/${s.id}`)
              const d = await r.json()
              const alloc: MemberAllocation | null =
                (d.allocations as MemberAllocation[])?.find(
                  (a) => a.member_stellar_address === memberAddress
                ) ?? null
              const credit: EnergyCredit | null =
                (d.energy_credits as EnergyCredit[])?.find(
                  (c) => c.member_stellar_address === memberAddress
                ) ?? null
              return { settlement: s, allocation: alloc, credit }
            } catch {
              return { settlement: s, allocation: null, credit: null }
            }
          })
        )
        setRows(
          detailedRows.sort(
            (a, b) =>
              new Date(b.settlement.period_start).getTime() -
              new Date(a.settlement.period_start).getTime()
          )
        )
      })
      .catch(() => setError("Could not load settlement data"))
      .finally(() => setLoading(false))
  }, [memberAddress, cooperativeIds.join(",")])

  if (!cooperativeIds.length) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <ReceiptText className="w-5 h-5 text-energy-green" />
          Energy Credit Settlements
          <InfoTooltip text="Your kWh allocation from each cooperative generation period. This is an energy credit — it shows how much renewable generation was assigned to your account, not a monetary invoice or I-REC certificate." />
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading && (
          <div className="flex justify-center py-8">
            <Spinner className="size-5" />
          </div>
        )}
        {error && (
          <p className="text-sm text-destructive py-4">{error}</p>
        )}
        {!loading && !error && rows.length === 0 && (
          <p className="text-sm text-muted-foreground py-4">No settlement periods found for your cooperatives.</p>
        )}
        {!loading && !error && rows.length > 0 && (
          <div className="space-y-3">
            {rows.map(({ settlement, allocation, credit }) => (
              <div
                key={settlement.id}
                className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-lg border border-border bg-muted/40"
              >
                {/* Period + settlement status */}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="text-sm font-medium">
                      {periodLabel(settlement.period_start, settlement.period_end)}
                    </span>
                    <SettlementStatusBadge status={settlement.status} />
                    <InfoTooltip text="Settlement status is managed by your cooperative admin and is independent of the on-chain token status below." />
                  </div>
                  {settlement.approved_by && (
                    <p className="text-xs text-muted-foreground">
                      Approved by: {settlement.approved_by.slice(0, 6)}…{settlement.approved_by.slice(-4)}
                      {settlement.approved_at &&
                        ` · ${new Date(settlement.approved_at).toLocaleDateString()}`}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Allocation v{settlement.allocation_version}
                  </p>
                </div>

                {/* kWh credit (energy credit — not a monetary amount) */}
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {allocation ? (
                    <div className="flex items-center gap-1 text-energy-green font-semibold">
                      <Zap className="w-4 h-4" />
                      {allocation.allocated_kwh.toLocaleString(undefined, { maximumFractionDigits: 2 })} kWh credited
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">No allocation for this period</span>
                  )}

                  {/* On-chain token status — shown separately from settlement status */}
                  {credit ? (
                    <div className="flex items-center gap-1.5">
                      <OnchainStatusBadge status={credit.onchain_status} />
                      {credit.mint_tx_hash && (
                        <a
                          href={getStellarExpertUrl(credit.mint_tx_hash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-primary transition-colors"
                          title="View mint transaction on Stellar Expert"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">Token not yet issued</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Explicit disclaimer: energy credits ≠ monetary invoices */}
        <p className="mt-4 text-xs text-muted-foreground border-t border-border pt-3">
          Energy credits reflect your share of cooperative generation in kWh. They are not monetary invoices
          and do not constitute I-REC or ESG retirement certificates.
        </p>
      </CardContent>
    </Card>
  )
}

"use client"

import { useCallback, useEffect, useState } from "react"
import { Clock, ExternalLink } from "lucide-react"
import { useI18n } from "@/lib/i18n-context"
import { getStellarExpertUrl } from "@/lib/utils"
import { getRpcServer } from "@/lib/stellar/contract-client"
import {
  PendingWriteStore,
  reconcileChainWrite,
  type PendingChainWrite,
} from "@/lib/stellar/resilience"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

const RECONCILE_INTERVAL_MS = 30_000

export function PendingChainWritesList({
  writes,
  onCheck,
  checking,
}: {
  writes: PendingChainWrite[]
  onCheck?: () => void
  checking?: boolean
}) {
  const { t } = useI18n()
  if (writes.length === 0) return null

  return (
    <Card className="mb-4 md:mb-6 border-solar-orange/30 bg-solar-orange/5" role="region" aria-label={t("chain.pending.title")}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-medium flex items-center gap-2">
              <Clock className="w-4 h-4 text-solar-orange" aria-hidden="true" />
              {t("chain.pending.title")}
            </p>
            <p className="text-xs text-muted-foreground mt-1">{t("chain.pending.description")}</p>
          </div>
          {onCheck && (
            <Button size="sm" variant="outline" onClick={onCheck} disabled={checking}>
              {t("chain.pending.check")}
            </Button>
          )}
        </div>
        <ul className="space-y-1">
          {writes.map((w) => (
            <li key={w.hash} className="flex items-center justify-between gap-2 text-xs">
              <span>{w.description ?? w.operation}</span>
              <a
                href={getStellarExpertUrl(w.hash)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono inline-flex items-center gap-1 text-web3-purple hover:underline"
              >
                {w.hash.slice(0, 10)}…
                <ExternalLink className="w-3 h-3" aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

/**
 * Lists writes that were submitted without a verdict and periodically asks
 * the RPC for one. Entries leave the list only on SUCCESS / FAILED / proven
 * expiry — never because the RPC is unreachable.
 */
export function PendingChainWritesNotice() {
  const [writes, setWrites] = useState<PendingChainWrite[]>([])
  const [checking, setChecking] = useState(false)

  const reconcile = useCallback(async () => {
    const store = new PendingWriteStore()
    const pending = store.list()
    setWrites(pending)
    if (pending.length === 0) return
    setChecking(true)
    const server = getRpcServer()
    for (const w of pending) {
      try {
        const outcome = await reconcileChainWrite(server, w)
        if (outcome.status !== "pending") store.remove(w.hash)
      } catch (err) {
        console.error("Error reconciling pending write", w.hash, err)
      }
    }
    setWrites(store.list())
    setChecking(false)
  }, [])

  useEffect(() => {
    void reconcile()
    const id = setInterval(() => void reconcile(), RECONCILE_INTERVAL_MS)
    return () => clearInterval(id)
  }, [reconcile])

  return <PendingChainWritesList writes={writes} onCheck={reconcile} checking={checking} />
}

"use client"

import type React from "react"
import { createContext, useCallback, useContext, useRef, useState } from "react"
import { AlertTriangle, ShieldCheck } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/lib/i18n-context"
import type { WriteIntent } from "@/lib/wallet/contract-write"

type ConfirmIntent = (intent: WriteIntent) => Promise<boolean>

const TransactionIntentContext = createContext<ConfirmIntent | undefined>(undefined)

function short(value: string): string {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value
}

/**
 * Renders the pre-signature review dialog for every guarded contract write.
 * Write hooks call `confirmIntent`; the wallet is only asked to sign after the
 * user approves exactly what is displayed here.
 */
export function TransactionIntentProvider({ children }: { children: React.ReactNode }) {
  const { t } = useI18n()
  const [intent, setIntent] = useState<WriteIntent | null>(null)
  const resolver = useRef<((ok: boolean) => void) | null>(null)

  const confirmIntent = useCallback<ConfirmIntent>((next) => {
    // A new request supersedes any unanswered one.
    resolver.current?.(false)
    setIntent(next)
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  const settle = (ok: boolean) => {
    resolver.current?.(ok)
    resolver.current = null
    setIntent(null)
  }

  const rows: [string, React.ReactNode][] = intent
    ? [
        [t("intent.cooperative"), intent.cooperative.name],
        [t("intent.operation"), t(`intent.op.${intent.operation}`)],
        [t("intent.amount"), `${intent.amountKwh.toLocaleString(undefined, { maximumFractionDigits: 7 })} kWh (HDROP)`],
        [t("intent.contract"), <code key="c" className="font-mono text-xs" title={intent.contractId}>{short(intent.contractId)}</code>],
        [t("intent.method"), <code key="m" className="font-mono text-xs">{intent.method}</code>],
        ...(intent.recipient
          ? ([[t("intent.recipient"), <code key="r" className="font-mono text-xs" title={intent.recipient}>{short(intent.recipient)}</code>]] as [string, React.ReactNode][])
          : []),
        [t("intent.signer"), <code key="s" className="font-mono text-xs" title={intent.signer}>{short(intent.signer)}</code>],
        [t("intent.network"), intent.network],
      ]
    : []

  return (
    <TransactionIntentContext.Provider value={confirmIntent}>
      {children}
      <Dialog open={intent !== null} onOpenChange={(open) => !open && settle(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-primary" />
              {t("intent.title")}
            </DialogTitle>
            <DialogDescription>{t("intent.description")}</DialogDescription>
          </DialogHeader>

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {rows.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-medium break-all">{value}</dd>
              </div>
            ))}
          </dl>

          {intent?.networkUnverified && (
            <div role="alert" className="flex items-start gap-2 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
              <AlertTriangle className="w-4 h-4 mt-0.5 text-warning" />
              <span>{t("intent.networkUnverified")}</span>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => settle(false)}>
              {t("intent.cancel")}
            </Button>
            <Button onClick={() => settle(true)}>{t("intent.confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TransactionIntentContext.Provider>
  )
}

export function useTransactionIntent(): ConfirmIntent {
  const ctx = useContext(TransactionIntentContext)
  if (!ctx) throw new Error("useTransactionIntent must be used within a TransactionIntentProvider")
  return ctx
}

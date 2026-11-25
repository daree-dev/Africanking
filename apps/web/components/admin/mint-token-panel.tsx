"use client"

import { useState, useEffect, type FormEvent } from "react"
import { useWallet } from "@/lib/wallet-context"
import { useEnergyToken } from "@/hooks/useEnergyToken"
import { useCooperatives } from "@/hooks/useCooperatives"
import { useAuth } from "@/lib/auth-context"
import { WalletWriteError } from "@/lib/wallet/contract-write"
import { useToast } from "@/hooks/use-toast"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { LockKeyhole, ShieldAlert, Zap } from "lucide-react"
import { ChainUnavailableError, ChainWritePendingError } from "@/lib/stellar/resilience"

export function MintTokenPanel() {
  const { address, networkMismatch } = useWallet()
  const { session } = useAuth()
  const { cooperatives } = useCooperatives()
  const { mintEnergy, checkIsMinter, isLoading } = useEnergyToken()
  const { toast } = useToast()

  const [cooperativeId, setCooperativeId] = useState("")
  const [recipient, setRecipient] = useState("")
  const [amount, setAmount] = useState("")
  const [hasMinterRole, setHasMinterRole] = useState<boolean | null>(null)
  const [isCheckingRole, setIsCheckingRole] = useState(false)

  // Verify minter role whenever the connected wallet changes.
  // checkIsMinter is a simulation call — it never touches the hook's isLoading,
  // so we track its own loading state locally.
  useEffect(() => {
    if (!address) {
      setHasMinterRole(null)
      return
    }

    let cancelled = false
    setIsCheckingRole(true)
    checkIsMinter(address)
      .then((result) => { if (!cancelled) setHasMinterRole(result) })
      .finally(() => { if (!cancelled) setIsCheckingRole(false) })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address])

  // Only cooperatives this account administers can be selected (all for super admins).
  const selectableCoops = cooperatives.filter(
    (c) => session?.is_super_admin || session?.admin_cooperative_ids.includes(c.id)
  )
  const selectedCoop = selectableCoops.find((c) => c.id === cooperativeId) ?? null

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()

    const parsedAmount = parseFloat(amount)
    if (!selectedCoop || !recipient.trim() || isNaN(parsedAmount) || parsedAmount <= 0) {
      toast({
        title: "Invalid input",
        description: "Select a cooperative and provide a valid member address and a positive kWh amount.",
        variant: "destructive",
      })
      return
    }

    try {
      const txHash = await mintEnergy(recipient.trim(), parsedAmount, {
        id: selectedCoop.id,
        name: selectedCoop.name,
      })
      toast({
        title: "Tokens minted",
        description: `${parsedAmount} HDROP → ${recipient.slice(0, 8)}… | Tx: ${txHash.slice(0, 10)}…${txHash.slice(-6)}`,
      })
      setRecipient("")
      setAmount("")
    } catch (err) {
      if (err instanceof ChainWritePendingError) {
        // Submitted without a verdict: neither success nor failure is known yet.
        toast({
          title: "Mint submitted — awaiting confirmation",
          description: `Tx ${err.hash.slice(0, 10)}… was sent. Do not resubmit; the dashboard will update once the network confirms it.`,
        })
        setRecipient("")
        setAmount("")
        return
      }
      if (err instanceof ChainUnavailableError) {
        toast({
          title: "Stellar network unavailable",
          description: "No transaction was submitted. You can safely retry later.",
          variant: "destructive",
        })
        return
      }
      toast({
        title: "Minting failed",
        description: err instanceof Error ? err.message : "Unknown error occurred.",
        variant: "destructive",
      })
    }
  }

  const isFormDisabled = isLoading || hasMinterRole !== true || !!networkMismatch
  const isSubmitDisabled = isFormDisabled || !selectedCoop || !recipient.trim() || !amount

  return (
    <Card className="max-w-lg glass-card border-2 border-primary/20">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg gradient-primary flex items-center justify-center flex-shrink-0">
            <Zap className="w-4 h-4 text-white" />
          </div>
          <CardTitle>Mint HDROP Tokens</CardTitle>
        </div>
        <CardDescription>
          Assign generation credits to a cooperative member. You will review the
          cooperative, amount and contract before signing. The connected wallet must
          hold the on-chain{" "}
          <code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">
            minter
          </code>{" "}
          role.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Role verification feedback */}
        {isCheckingRole && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-3" />
            Verifying minter role on-chain…
          </div>
        )}

        {/* Unauthorized alert — only shown once role check is complete */}
        {!isCheckingRole && hasMinterRole === false && (
          <Alert
            variant="destructive"
            className="bg-destructive/5 border-destructive/30"
          >
            <ShieldAlert />
            <AlertDescription>
              <p>
                Unauthorized: You need the &apos;minter&apos; role to issue
                tokens. Please contact the administrator.
              </p>
            </AlertDescription>
          </Alert>
        )}

        {networkMismatch && (
          <Alert variant="destructive" className="bg-destructive/5 border-destructive/30">
            <ShieldAlert />
            <AlertDescription>
              <p>{networkMismatch}. Switch your wallet network to continue.</p>
            </AlertDescription>
          </Alert>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cooperative">Cooperative</Label>
            <select
              id="cooperative"
              className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm"
              value={cooperativeId}
              onChange={(e) => setCooperativeId(e.target.value)}
              disabled={isFormDisabled}
            >
              <option value="">Select a cooperative…</option>
              {selectableCoops.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="recipient">Member Address</Label>
            <Input
              id="recipient"
              type="text"
              placeholder="G…"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              disabled={isFormDisabled}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="amount">Amount (kWh)</Label>
            <Input
              id="amount"
              type="number"
              min="0.0000001"
              step="any"
              placeholder="e.g. 100"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={isFormDisabled}
            />
          </div>

          <Button
            type="submit"
            size="lg"
            className="w-full gradient-primary text-white font-semibold"
            disabled={isSubmitDisabled}
          >
            {isLoading ? (
              <>
                <Spinner />
                Minting…
              </>
            ) : hasMinterRole !== true ? (
              <>
                <LockKeyhole />
                Locked
              </>
            ) : (
              <>
                <Zap />
                Mint Tokens
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

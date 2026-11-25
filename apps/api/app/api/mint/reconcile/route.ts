import { NextRequest, NextResponse } from "next/server"
import * as StellarSdk from "@stellar/stellar-sdk"
import { supabase } from "@/lib/supabase"
import { STELLAR_CONFIG } from "@/lib/contracts-config"
import { requireAuth, isSession } from "@/lib/auth/middleware"
import { validateBody } from "@/lib/validation/validate"
import { mintSchema } from "@/lib/validation/schemas"
import { safeCatchError } from "@/lib/errors/safe-error"
import { finalizeCertificateMint, finalizeReadingMint, getMintableKwh } from "@/lib/mint/finalize"
import { reconcileChainWrite, withBackoff, type RpcWriteClient } from "@/lib/stellar/resilience"

/**
 * POST: admin — ask the RPC for the verdict of a previously submitted mint.
 * Only SUCCESS / FAILED change stored state; NOT_FOUND or an outage keeps the
 * record pending (202) so nobody re-mints on a guess.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth()
    if (!isSession(session)) return session

    const body = await req.json()
    const v = validateBody(mintSchema, body)
    if (!v.success) return v.response

    const server = new StellarSdk.rpc.Server(STELLAR_CONFIG.RPC_URL) as unknown as RpcWriteClient
    const check = (hash: string) => withBackoff(() => reconcileChainWrite(server, { hash }))

    if (v.data.certificate_id) {
      const certificateId = v.data.certificate_id
      const { data: cert } = await supabase
        .from("certificates")
        .select("*")
        .eq("id", certificateId)
        .single()

      if (!cert) return NextResponse.json({ error: "Certificate not found" }, { status: 404 })
      if (!session.admin_cooperative_ids.includes(cert.cooperative_id)) {
        return NextResponse.json({ error: "Admin access required" }, { status: 403 })
      }
      if (cert.status !== "pending") {
        return NextResponse.json({ status: "confirmed", tx_hash: cert.mint_tx_hash })
      }
      if (!cert.mint_tx_hash) {
        return NextResponse.json({ error: "No submitted mint to reconcile" }, { status: 400 })
      }

      const outcome = await check(cert.mint_tx_hash)
      if (outcome.status === "pending") {
        return NextResponse.json({ status: "pending_confirmation", tx_hash: outcome.hash, reason: outcome.reason }, { status: 202 })
      }
      if (outcome.status === "failed") {
        await supabase.from("certificates").update({ mint_tx_hash: null }).eq("id", certificateId)
        return NextResponse.json({ status: "failed", tx_hash: outcome.hash, reason: outcome.reason })
      }

      const minterSecret = process.env.MINTER_SECRET_KEY
      if (!minterSecret) {
        return NextResponse.json({ error: "Server configuration error: missing minter key" }, { status: 500 })
      }
      await finalizeCertificateMint({
        certificateId,
        cooperativeId: cert.cooperative_id,
        totalKwh: cert.total_kwh,
        mintTo: StellarSdk.Keypair.fromSecret(minterSecret).publicKey(),
        txHash: outcome.hash,
      })
      return NextResponse.json({ status: "confirmed", tx_hash: outcome.hash })
    }

    const readingId = v.data.reading_id!
    const { data: reading } = await supabase
      .from("readings")
      .select("*, prosumers(stellar_address)")
      .eq("id", readingId)
      .single()

    if (!reading) return NextResponse.json({ error: "Reading not found" }, { status: 404 })
    if (!session.admin_cooperative_ids.includes(reading.cooperative_id)) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 })
    }
    if (reading.status === "minted") {
      return NextResponse.json({ status: "confirmed", tx_hash: reading.tx_hash })
    }
    if (!reading.tx_hash) {
      return NextResponse.json({ error: "No submitted mint to reconcile" }, { status: 400 })
    }

    const outcome = await check(reading.tx_hash)
    if (outcome.status === "pending") {
      return NextResponse.json({ status: "pending_confirmation", tx_hash: outcome.hash, reason: outcome.reason }, { status: 202 })
    }
    if (outcome.status === "failed") {
      await supabase.from("readings").update({ status: "failed" }).eq("id", readingId)
      return NextResponse.json({ status: "failed", tx_hash: outcome.hash, reason: outcome.reason })
    }

    await finalizeReadingMint({
      readingId,
      cooperativeId: reading.cooperative_id,
      prosumerAddress: reading.prosumers.stellar_address,
      kwhAmount: getMintableKwh(reading),
      txHash: outcome.hash,
    })
    return NextResponse.json({ status: "confirmed", tx_hash: outcome.hash })
  } catch (err) {
    return safeCatchError(err)
  }
}

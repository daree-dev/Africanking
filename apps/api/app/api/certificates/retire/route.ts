import { NextRequest, NextResponse } from "next/server"
import * as StellarSdk from "@stellar/stellar-sdk"
import { supabase } from "@/lib/supabase"
import { CONTRACTS } from "@/lib/contracts-config"
import { auditLog } from "@/lib/audit"
import { requireAuth, isSession } from "@/lib/auth/middleware"
import { validateBody } from "@/lib/validation/validate"
import { retireSchema } from "@/lib/validation/schemas"
import { getStellarConfigReport } from "@/server/stellar/network-config"
import { getTransactionService, isStellarTransactionError } from "@/server/stellar/transaction-service"
import { transactionErrorResponse } from "@/server/stellar/transaction-response"
import { safeDbError, safeCatchError } from "@/lib/errors/safe-error"

// POST: authenticated — buyer retires certificate
export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth()
    if (!isSession(session)) return session

    const body = await req.json()
    const v = validateBody(retireSchema, body)
    if (!v.success) return v.response

    const { certificate_id, buyer_address, buyer_name, buyer_purpose } = v.data

    // Fetch certificate
    const { data: cert, error: certError } = await supabase
      .from("certificates")
      .select("*")
      .eq("id", certificate_id)
      .single()

    if (certError || !cert) {
      return NextResponse.json({ error: "Certificate not found" }, { status: 404 })
    }

    if (cert.status !== "available") {
      return NextResponse.json(
        { error: `Certificate status is '${cert.status}', expected 'available'` },
        { status: 400 }
      )
    }

    const minterSecret = process.env.MINTER_SECRET_KEY
    if (!minterSecret) {
      return NextResponse.json({ error: "Server configuration error" }, { status: 500 })
    }

    const contractAddress = CONTRACTS.ENERGY_TOKEN
    if (!contractAddress) {
      return NextResponse.json({ error: "Server configuration error" }, { status: 500 })
    }

    const stellarConfig = getStellarConfigReport()
    if (!stellarConfig.writesEnabled) {
      return NextResponse.json(
        {
          error: "Stellar write operations are disabled: configuration is invalid or incomplete",
          code: "WRITES_DISABLED",
          config_fingerprint: stellarConfig.fingerprint,
        },
        { status: 503 }
      )
    }

    // Burn on-chain through the shared transaction service
    const amountInStroops = BigInt(Math.round(cert.total_kwh * 1e7))
    const minterKeypair = StellarSdk.Keypair.fromSecret(minterSecret)
    const minterPublic = minterKeypair.publicKey()

    let burnTxHash: string
    try {
      const result = await getTransactionService().invokeContract({
        signer: minterKeypair,
        contractId: contractAddress,
        method: "burn_energy",
        args: [
          StellarSdk.nativeToScVal(minterPublic, { type: "address" }),
          StellarSdk.nativeToScVal(amountInStroops, { type: "i128" }),
        ],
        label: `retire:certificate:${certificate_id}`,
        // No certificate column holds an in-flight burn hash, so record it in the audit
        // log as soon as it may be on-chain to support reconciliation.
        onSubmitted: (hash) => {
          auditLog({
            action: "retire",
            actor: session.sub,
            resource_type: "certificate",
            resource_id: certificate_id,
            details: { outcome: "submitted", tx_hash: hash, buyer_address },
          })
        },
      })
      burnTxHash = result.hash
    } catch (err) {
      if (isStellarTransactionError(err)) {
        return transactionErrorResponse(err, {
          action: "retire",
          actor: session.sub,
          resourceType: "certificate",
          resourceId: certificate_id,
        })
      }
      throw err
    }

    const { data: retirement, error: retireError } = await supabase
      .from("retirements")
      .insert({
        certificate_id,
        buyer_address,
        buyer_name: buyer_name ?? null,
        buyer_purpose,
        kwh_retired: cert.total_kwh,
        burn_tx_hash: burnTxHash,
      })
      .select()
      .single()

    if (retireError) return safeDbError(retireError)

    await supabase
      .from("certificates")
      .update({ status: "retired" })
      .eq("id", certificate_id)

    await supabase.from("events").insert({
      type: "burn",
      amount: cert.total_kwh,
      tx_hash: burnTxHash,
      cooperative_id: cert.cooperative_id,
      stellar_address: buyer_address,
    })

    return NextResponse.json({
      success: true,
      retirement,
      burn_tx_hash: burnTxHash,
    })
  } catch (err) {
    return safeCatchError(err)
  }
}

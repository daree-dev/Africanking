import { NextRequest, NextResponse } from "next/server"
import * as StellarSdk from "@stellar/stellar-sdk"
import { supabase } from "@/lib/supabase"
import { CONTRACTS } from "@/lib/contracts-config"
import { requireAuth, isSession } from "@/lib/auth/middleware"
import { validateBody } from "@/lib/validation/validate"
import { mintSchema } from "@/lib/validation/schemas"
import { getStellarConfigReport } from "@/server/stellar/network-config"
import { getTransactionService, isStellarTransactionError } from "@/server/stellar/transaction-service"
import { transactionErrorResponse } from "@/server/stellar/transaction-response"

async function markFailed(readingId: string, reason: string) {
  await supabase
    .from("readings")
    .update({ status: "failed" })
    .eq("id", readingId)
  return NextResponse.json({ error: reason }, { status: 500 })
}

function getMintableKwh(reading: {
  kwh_injected?: number | null
  kwh_generated?: number | null
  kwh_self_consumed?: number | null
}) {
  if (reading.kwh_injected != null) {
    return reading.kwh_injected
  }

  if (reading.kwh_generated == null) {
    throw new Error("Reading is missing both kwh_injected and kwh_generated")
  }

  if (reading.kwh_self_consumed == null) {
    throw new Error("Reading requires kwh_self_consumed when kwh_injected is unavailable")
  }

  return Math.max(0, reading.kwh_generated - reading.kwh_self_consumed)
}

function mintArgs(toAddress: string, amountKwh: number, minterPublic: string) {
  const amountInStroops = BigInt(Math.round(amountKwh * 1e7))
  return [
    StellarSdk.nativeToScVal(toAddress, { type: "address" }),
    StellarSdk.nativeToScVal(amountInStroops, { type: "i128" }),
    StellarSdk.nativeToScVal(minterPublic, { type: "address" }),
  ]
}

// POST: admin — mints tokens for certificate (or legacy reading)
export async function POST(req: NextRequest) {
  let readingId: string | undefined
  let actor = "unknown"

  try {
    const session = await requireAuth()
    if (!isSession(session)) return session
    actor = session.sub

    const body = await req.json()
    const v = validateBody(mintSchema, body)
    if (!v.success) return v.response

    readingId = v.data.reading_id
    const certificateId = v.data.certificate_id

    const minterSecret = process.env.MINTER_SECRET_KEY
    if (!minterSecret) {
      console.error("[MINT] MINTER_SECRET_KEY not configured")
      return NextResponse.json({ error: "Server configuration error: missing minter key" }, { status: 500 })
    }

    const contractAddress = CONTRACTS.ENERGY_TOKEN
    if (!contractAddress) {
      console.error("[MINT] ENERGY_TOKEN contract not configured")
      return NextResponse.json({ error: "Server configuration error: missing contract" }, { status: 500 })
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

    // --- Certificate flow ---
    if (certificateId) {
      const { data: cert, error: certError } = await supabase
        .from("certificates")
        .select("*, cooperatives(admin_stellar_address, token_contract_address)")
        .eq("id", certificateId)
        .single()

      if (certError || !cert) {
        return NextResponse.json({ error: "Certificate not found" }, { status: 404 })
      }

      // Must be admin of the certificate's cooperative
      if (!session.admin_cooperative_ids.includes(cert.cooperative_id)) {
        return NextResponse.json({ error: "Admin access required" }, { status: 403 })
      }

      if (cert.status !== "pending") {
        return NextResponse.json(
          { error: `Certificate status is '${cert.status}', expected 'pending'` },
          { status: 400 }
        )
      }

      if (cert.mint_tx_hash) {
        return NextResponse.json(
          {
            error:
              `This certificate already has a submitted mint transaction (${cert.mint_tx_hash}) ` +
              `that never confirmed as available. Check it on Stellar Expert before minting again — ` +
              `retrying may mint duplicate tokens.`,
          },
          { status: 409 }
        )
      }

      const coop = cert.cooperatives as {
        admin_stellar_address: string
        token_contract_address: string | null
      }
      // Custodial model: tokens go to minter (platform holds them)
      const minterKeypair = StellarSdk.Keypair.fromSecret(minterSecret)
      const mintTo = minterKeypair.publicKey()
      const tokenContract = coop.token_contract_address || contractAddress

      let txHash: string
      try {
        const result = await getTransactionService().invokeContract({
          signer: minterKeypair,
          contractId: tokenContract,
          method: "mint_energy",
          args: mintArgs(mintTo, cert.total_kwh, mintTo),
          label: `mint:certificate:${certificateId}`,
          // Record the hash as soon as it may be on-chain so a retry is blocked (409 above)
          // instead of silently minting twice.
          onSubmitted: async (submittedHash) => {
            await supabase
              .from("certificates")
              .update({ mint_tx_hash: submittedHash })
              .eq("id", certificateId)
          },
        })
        txHash = result.hash
      } catch (err) {
        if (isStellarTransactionError(err)) {
          return transactionErrorResponse(err, {
            action: "mint",
            actor,
            resourceType: "certificate",
            resourceId: certificateId,
          })
        }
        throw err
      }

      await supabase
        .from("certificates")
        .update({
          status: "available",
          mint_tx_hash: txHash,
          token_amount: cert.total_kwh,
        })
        .eq("id", certificateId)

      await supabase.from("mint_log").insert({
        certificate_id: certificateId,
        prosumer_address: mintTo,
        amount_hdrop: cert.total_kwh,
        tx_hash: txHash,
      })

      await supabase.from("events").insert({
        type: "mint",
        amount: cert.total_kwh,
        tx_hash: txHash,
        cooperative_id: cert.cooperative_id,
        stellar_address: mintTo,
      })

      return NextResponse.json({
        success: true,
        tx_hash: txHash,
        certificate_id: certificateId,
        amount_kwh: cert.total_kwh,
        mint_to: mintTo,
      })
    }

    // --- Legacy reading flow ---
    const { data: reading, error: readingError } = await supabase
      .from("readings")
      .select("*, prosumers(stellar_address)")
      .eq("id", readingId!)
      .single()

    if (readingError || !reading) {
      return NextResponse.json({ error: "Reading not found" }, { status: 404 })
    }

    if (reading.status !== "pending") {
      return NextResponse.json(
        { error: `Reading status is '${reading.status}', expected 'pending'` },
        { status: 400 }
      )
    }

    if (reading.tx_hash) {
      return NextResponse.json(
        {
          error:
            `This reading already has a submitted mint transaction (${reading.tx_hash}) ` +
            `that never confirmed. Reconcile it before minting again — retrying may mint duplicate tokens.`,
          code: "UNRECONCILED_TRANSACTION",
          tx_hash: reading.tx_hash,
        },
        { status: 409 }
      )
    }

    const prosumerAddress = reading.prosumers.stellar_address
    let kwhAmount: number

    try {
      kwhAmount = getMintableKwh(reading)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid reading energy data"
      return NextResponse.json({ error: message }, { status: 400 })
    }

    const minterKeypair = StellarSdk.Keypair.fromSecret(minterSecret)
    let txHash: string
    try {
      const result = await getTransactionService().invokeContract({
        signer: minterKeypair,
        contractId: contractAddress,
        method: "mint_energy",
        args: mintArgs(prosumerAddress, kwhAmount, minterKeypair.publicKey()),
        label: `mint:reading:${readingId}`,
        onSubmitted: async (submittedHash) => {
          await supabase.from("readings").update({ tx_hash: submittedHash }).eq("id", readingId!)
        },
      })
      txHash = result.hash
    } catch (err) {
      if (isStellarTransactionError(err)) {
        // Definitive, non-retryable failures that never reached the ledger close the reading.
        // Submitted-but-unknown outcomes stay 'pending' with tx_hash set for reconciliation;
        // retryable failures stay 'pending' so the admin can retry.
        if (!err.submitted && !err.retryable) {
          await supabase.from("readings").update({ status: "failed" }).eq("id", readingId!)
        }
        return transactionErrorResponse(err, {
          action: "mint",
          actor,
          resourceType: "reading",
          resourceId: readingId!,
        })
      }
      throw err
    }

    await supabase
      .from("readings")
      .update({ status: "minted", tx_hash: txHash })
      .eq("id", readingId!)

    await supabase.from("mint_log").insert({
      reading_id: readingId,
      prosumer_address: prosumerAddress,
      amount_hdrop: kwhAmount,
      tx_hash: txHash,
    })

    await supabase.from("events").insert({
      type: "mint",
      amount: kwhAmount,
      tx_hash: txHash,
      cooperative_id: reading.cooperative_id,
      stellar_address: prosumerAddress,
    })

    return NextResponse.json({
      success: true,
      tx_hash: txHash,
      amount_hdrop: kwhAmount,
      prosumer_address: prosumerAddress,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[MINT ERROR]", message, error instanceof Error ? error.stack : error)
    if (readingId) {
      return markFailed(readingId, message)
    }
    // Expose error details for debugging
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

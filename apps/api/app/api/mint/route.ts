import { NextRequest, NextResponse } from "next/server"
import * as StellarSdk from "@stellar/stellar-sdk"
import { supabase } from "@/lib/supabase"
import { CONTRACTS, STELLAR_CONFIG, NETWORK_PASSPHRASE } from "@/lib/contracts-config"
import { requireAuth, isSession } from "@/lib/auth/middleware"
import { validateBody } from "@/lib/validation/validate"
import { mintSchema } from "@/lib/validation/schemas"
import { safeCatchError } from "@/lib/errors/safe-error"
import { finalizeCertificateMint, finalizeReadingMint, getMintableKwh } from "@/lib/mint/finalize"
import {
  ChainUnavailableError,
  isTransientChainError,
  submitSignedTransaction,
  withBackoff,
  type ChainWriteOutcome,
  type RpcWriteClient,
} from "@/lib/stellar/resilience"

const DEFAULT_CONFIRM_TIMEOUT_MS = 90_000

function confirmTimeoutMs() {
  const raw = Number(process.env.MINT_CONFIRM_TIMEOUT_MS)
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_CONFIRM_TIMEOUT_MS
}

/**
 * Build, sign once and submit a mint.
 *
 * Preparation (getAccount / prepareTransaction) is a read-only simulation and
 * is retried with bounded backoff; if the RPC stays down we throw
 * ChainUnavailableError before anything is signed. The signed envelope is
 * only ever re-sent as-is (see submitSignedTransaction), so a retry cannot
 * mint twice.
 */
async function mintOnChain(
  toAddress: string,
  amountKwh: number,
  minterSecret: string,
  contractAddress: string,
  onSubmitted: (hash: string) => Promise<void>,
): Promise<ChainWriteOutcome> {
  const amountInStroops = BigInt(Math.round(amountKwh * 1e7))
  const server = new StellarSdk.rpc.Server(STELLAR_CONFIG.RPC_URL)
  const minterKeypair = StellarSdk.Keypair.fromSecret(minterSecret)
  const minterPublic = minterKeypair.publicKey()
  const contract = new StellarSdk.Contract(contractAddress)

  let preparedTx: StellarSdk.Transaction
  try {
    preparedTx = await withBackoff(async () => {
      const minterAccount = await server.getAccount(minterPublic)
      const maxTime = Math.floor(Date.now() / 1000) + 300
      const transaction = new StellarSdk.TransactionBuilder(minterAccount, {
        fee: "100000",
        networkPassphrase: NETWORK_PASSPHRASE,
        timebounds: { minTime: 0, maxTime },
      })
        .addOperation(
          contract.call(
            "mint_energy",
            StellarSdk.nativeToScVal(toAddress, { type: "address" }),
            StellarSdk.nativeToScVal(amountInStroops, { type: "i128" }),
            StellarSdk.nativeToScVal(minterPublic, { type: "address" })
          )
        )
        .build()
      return server.prepareTransaction(transaction)
    })
  } catch (err) {
    if (isTransientChainError(err)) throw new ChainUnavailableError(undefined, err)
    throw err
  }

  preparedTx.sign(minterKeypair)

  return submitSignedTransaction(server as unknown as RpcWriteClient, preparedTx, {
    onSubmitted,
    confirmTimeoutMs: confirmTimeoutMs(),
  })
}

function pendingResponse(txHash: string, extra: Record<string, unknown>) {
  return NextResponse.json(
    {
      status: "pending_confirmation",
      tx_hash: txHash,
      message:
        "Transaction submitted but not yet confirmed. It will not be resubmitted; " +
        "use /api/mint/reconcile to check its status.",
      ...extra,
    },
    { status: 202 }
  )
}

function unavailableResponse() {
  return NextResponse.json(
    { error: "Stellar network unavailable — no transaction was submitted. Safe to retry later.", submitted: false },
    { status: 503 }
  )
}

// POST: admin — mints tokens for certificate (or legacy reading)
export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth()
    if (!isSession(session)) return session

    const body = await req.json()
    const v = validateBody(mintSchema, body)
    if (!v.success) return v.response

    const readingId = v.data.reading_id
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
              `that has not been confirmed. Use /api/mint/reconcile to check it — ` +
              `minting again may create duplicate tokens.`,
            tx_hash: cert.mint_tx_hash,
          },
          { status: 409 }
        )
      }

      const coop = cert.cooperatives as {
        admin_stellar_address: string
        token_contract_address: string | null
      }
      // Custodial model: tokens go to minter (platform holds them)
      const mintTo = StellarSdk.Keypair.fromSecret(minterSecret).publicKey()
      const tokenContract = coop.token_contract_address || contractAddress

      let outcome: ChainWriteOutcome
      try {
        outcome = await mintOnChain(mintTo, cert.total_kwh, minterSecret, tokenContract, async (submittedHash) => {
          // Persist before waiting so a timeout can never lead to a blind re-mint.
          await supabase.from("certificates").update({ mint_tx_hash: submittedHash }).eq("id", certificateId)
        })
      } catch (err) {
        if (err instanceof ChainUnavailableError) return unavailableResponse()
        throw err
      }

      if (outcome.status === "pending") {
        return pendingResponse(outcome.hash, { certificate_id: certificateId })
      }

      if (outcome.status === "failed") {
        // Definitive on-chain rejection: nothing was minted, so the guard hash
        // can be cleared and the admin may try again.
        await supabase.from("certificates").update({ mint_tx_hash: null }).eq("id", certificateId)
        return NextResponse.json({ error: outcome.reason, tx_hash: outcome.hash }, { status: 502 })
      }

      await finalizeCertificateMint({
        certificateId,
        cooperativeId: cert.cooperative_id,
        totalKwh: cert.total_kwh,
        mintTo,
        txHash: outcome.hash,
      })

      return NextResponse.json({
        success: true,
        tx_hash: outcome.hash,
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
            `This reading already has a submitted mint transaction (${reading.tx_hash}) that has not been confirmed. ` +
            `Use /api/mint/reconcile before minting again.`,
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

    let outcome: ChainWriteOutcome
    try {
      outcome = await mintOnChain(prosumerAddress, kwhAmount, minterSecret, contractAddress, async (submittedHash) => {
        await supabase.from("readings").update({ tx_hash: submittedHash }).eq("id", readingId!)
      })
    } catch (err) {
      // Not submitted → the reading keeps its status; it did not "fail".
      if (err instanceof ChainUnavailableError) return unavailableResponse()
      throw err
    }

    if (outcome.status === "pending") {
      return pendingResponse(outcome.hash, { reading_id: readingId })
    }

    if (outcome.status === "failed") {
      await supabase.from("readings").update({ status: "failed" }).eq("id", readingId!)
      return NextResponse.json({ error: outcome.reason, tx_hash: outcome.hash }, { status: 502 })
    }

    await finalizeReadingMint({
      readingId: readingId!,
      cooperativeId: reading.cooperative_id,
      prosumerAddress,
      kwhAmount,
      txHash: outcome.hash,
    })

    return NextResponse.json({
      success: true,
      tx_hash: outcome.hash,
      amount_hdrop: kwhAmount,
      prosumer_address: prosumerAddress,
    })
  } catch (error) {
    // Unexpected errors carry no on-chain evidence: never mark records failed here.
    console.error("[MINT ERROR]", error instanceof Error ? error.message : error)
    return safeCatchError(error)
  }
}

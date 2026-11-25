import { supabase } from "@/lib/supabase"

/**
 * Database side-effects of a mint that the chain has *confirmed*.
 * Only call these with a hash for which getTransaction returned SUCCESS.
 */
export async function finalizeCertificateMint(params: {
  certificateId: string
  cooperativeId: string
  totalKwh: number
  mintTo: string
  txHash: string
}) {
  await supabase
    .from("certificates")
    .update({ status: "available", mint_tx_hash: params.txHash, token_amount: params.totalKwh })
    .eq("id", params.certificateId)

  await supabase.from("mint_log").insert({
    certificate_id: params.certificateId,
    prosumer_address: params.mintTo,
    amount_hdrop: params.totalKwh,
    tx_hash: params.txHash,
  })

  await supabase.from("events").insert({
    type: "mint",
    amount: params.totalKwh,
    tx_hash: params.txHash,
    cooperative_id: params.cooperativeId,
    stellar_address: params.mintTo,
  })
}

export async function finalizeReadingMint(params: {
  readingId: string
  cooperativeId: string | null
  prosumerAddress: string
  kwhAmount: number
  txHash: string
}) {
  await supabase
    .from("readings")
    .update({ status: "minted", tx_hash: params.txHash })
    .eq("id", params.readingId)

  await supabase.from("mint_log").insert({
    reading_id: params.readingId,
    prosumer_address: params.prosumerAddress,
    amount_hdrop: params.kwhAmount,
    tx_hash: params.txHash,
  })

  await supabase.from("events").insert({
    type: "mint",
    amount: params.kwhAmount,
    tx_hash: params.txHash,
    cooperative_id: params.cooperativeId,
    stellar_address: params.prosumerAddress,
  })
}

/** Mintable energy for a legacy reading: injected kWh, else generated − self-consumed. */
export function getMintableKwh(reading: {
  kwh_injected?: number | null
  kwh_generated?: number | null
  kwh_self_consumed?: number | null
}) {
  if (reading.kwh_injected != null) return reading.kwh_injected
  if (reading.kwh_generated == null) {
    throw new Error("Reading is missing both kwh_injected and kwh_generated")
  }
  if (reading.kwh_self_consumed == null) {
    throw new Error("Reading requires kwh_self_consumed when kwh_injected is unavailable")
  }
  return Math.max(0, reading.kwh_generated - reading.kwh_self_consumed)
}

/**
 * Mint reconciliation — compares certificate / reading rows against finalized
 * Stellar transaction evidence from the configured network.
 *
 * Usage:
 *   npx tsx scripts/reconcile-mints.ts                 # dry-run (default, no writes)
 *   npx tsx scripts/reconcile-mints.ts --apply         # apply safe derived-state repairs
 *   npx tsx scripts/reconcile-mints.ts --json          # machine-readable report
 *   npx tsx scripts/reconcile-mints.ts --kind=certificate --limit=100
 *
 * Exit codes: 0 = all consistent, 1 = error, 2 = mismatches found.
 * See docs/operations/mint-reconciliation.md.
 */

import { config } from "dotenv"
import { createClient } from "@supabase/supabase-js"
import * as StellarSdk from "@stellar/stellar-sdk"
import { assertNetwork, fetchTransactionEvidence } from "../apps/web/lib/reconciliation/evidence"
import { formatOperation, runReconciliation } from "../apps/web/lib/reconciliation/runner"
import type { MintRecord } from "../apps/web/lib/reconciliation/types"

config({ path: process.env.ENV_FILE || "apps/api/.env.local" })

const PASSPHRASES: Record<string, string> = {
  TESTNET: StellarSdk.Networks.TESTNET,
  PUBLIC: StellarSdk.Networks.PUBLIC,
  FUTURENET: StellarSdk.Networks.FUTURENET,
  LOCAL: StellarSdk.Networks.STANDALONE,
}

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return undefined
  return hit.includes("=") ? hit.split("=")[1] : "true"
}

function required(key: string): string {
  const value = process.env[key]
  if (!value) {
    console.error(`Missing required environment variable ${key}`)
    process.exit(1)
  }
  return value
}

async function main() {
  const apply = arg("apply") === "true"
  const json = arg("json") === "true"
  const kindArg = arg("kind")
  const kinds = kindArg ? (kindArg.split(",") as MintRecord["kind"][]) : undefined
  const limit = arg("limit") ? Number(arg("limit")) : undefined

  const network = process.env.NEXT_PUBLIC_STELLAR_NETWORK || "TESTNET"
  const passphrase = PASSPHRASES[network]
  if (!passphrase) throw new Error(`Unknown NEXT_PUBLIC_STELLAR_NETWORK "${network}"`)
  const rpcUrl = required("NEXT_PUBLIC_STELLAR_RPC_URL")
  const defaultContract = required("NEXT_PUBLIC_ENERGY_TOKEN_CONTRACT")

  const server = new StellarSdk.rpc.Server(rpcUrl, { allowHttp: network === "LOCAL" })
  await assertNetwork(server, passphrase)

  const supabase = createClient(required("NEXT_PUBLIC_SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"))

  const report = await runReconciliation({
    supabase,
    fetchEvidence: (hash) => fetchTransactionEvidence(server, hash),
    defaultContract,
    apply,
    actor: `reconcile-mints:${process.env.USER || "operator"}`,
    kinds,
    limit,
  })

  if (json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(`Mint reconciliation (${report.mode}) — network ${network}, rpc ${rpcUrl}\n`)
    for (const op of report.operations) console.log(formatOperation(op) + "\n")
    console.log("Summary:", report.summary)
    if (!apply && report.operations.some((o) => o.repair)) {
      console.log("\nDry-run only. Re-run with --apply to perform the listed repairs.")
    }
  }

  const mismatched = report.operations.some((o) => o.verdict !== "consistent" && o.verdict !== "not_submitted")
  process.exit(mismatched ? 2 : 0)
}

main().catch((err) => {
  console.error("Reconciliation aborted:", err instanceof Error ? err.message : err)
  process.exit(1)
})

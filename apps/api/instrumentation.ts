/**
 * Next.js startup hook. Validates Stellar network/contract configuration before
 * the API serves traffic: invalid PUBLIC configuration fails startup, other
 * invalid configuration leaves the API running with write operations disabled.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  const { enforceStellarConfigAtStartup } = await import("./server/stellar/network-config")
  enforceStellarConfigAtStartup()
}

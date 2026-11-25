/**
 * Single, validated Stellar network configuration.
 *
 * Every endpoint the browser talks to (Horizon, Soroban RPC, explorer links,
 * wallet passphrase checks) must come from here so that payments, contract
 * events and signatures are always about the same network.
 */

export type StellarNetworkName = "TESTNET" | "PUBLIC" | "FUTURENET" | "LOCAL"

export const NETWORK_PASSPHRASES: Record<StellarNetworkName, string> = {
  TESTNET: "Test SDF Network ; September 2015",
  PUBLIC: "Public Global Stellar Network ; September 2015",
  FUTURENET: "Test SDF Future Network ; October 2022",
  LOCAL: "Standalone Network ; February 2017",
}

const DEFAULT_ENDPOINTS: Record<StellarNetworkName, { horizon: string; rpc: string }> = {
  TESTNET: { horizon: "https://horizon-testnet.stellar.org", rpc: "https://soroban-testnet.stellar.org" },
  PUBLIC: { horizon: "https://horizon.stellar.org", rpc: "https://soroban.stellar.org" },
  FUTURENET: { horizon: "https://horizon-futurenet.stellar.org", rpc: "https://rpc-futurenet.stellar.org" },
  LOCAL: { horizon: "http://localhost:8000", rpc: "http://localhost:8000/rpc" },
}

const EXPLORER_SEGMENT: Record<StellarNetworkName, string | null> = {
  TESTNET: "testnet",
  PUBLIC: "public",
  FUTURENET: "futurenet",
  LOCAL: null,
}

export interface StellarNetworkConfig {
  network: StellarNetworkName
  label: string
  passphrase: string
  horizonUrl: string
  rpcUrl: string
  /** stellar.expert network segment, null when no public explorer exists */
  explorerNetwork: string | null
  /** Problems found while validating; non-empty means writes must be refused. */
  issues: string[]
  valid: boolean
}

export interface RawNetworkInput {
  network?: string
  passphrase?: string
  horizonUrl?: string
  rpcUrl?: string
}

function isNetworkName(value: string): value is StellarNetworkName {
  return value in NETWORK_PASSPHRASES
}

/** Normalise the many spellings wallets and env files use for a network. */
export function normalizeNetworkName(value: string | null | undefined): StellarNetworkName | null {
  if (!value) return null
  const v = value.trim().toUpperCase()
  if (v === "MAINNET" || v === "PUBNET" || v === "PUBLIC") return "PUBLIC"
  if (v === "TESTNET" || v === "TEST") return "TESTNET"
  if (v === "FUTURENET") return "FUTURENET"
  if (v === "LOCAL" || v === "STANDALONE") return "LOCAL"
  // Wallets may report a passphrase instead of a name.
  for (const [name, passphrase] of Object.entries(NETWORK_PASSPHRASES)) {
    if (value === passphrase) return name as StellarNetworkName
  }
  return null
}

/** Best-effort network inference from a well-known endpoint host. */
export function inferNetworkFromUrl(url: string): StellarNetworkName | null {
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    return null
  }
  if (host === "localhost" || host === "127.0.0.1") return "LOCAL"
  if (host.includes("futurenet")) return "FUTURENET"
  if (host.includes("testnet")) return "TESTNET"
  if (host === "horizon.stellar.org" || host.includes("mainnet") || host.includes("pubnet")) return "PUBLIC"
  return null // custom/self-hosted endpoint — cannot infer
}

function validateUrl(
  label: string,
  url: string,
  network: StellarNetworkName,
  issues: string[]
): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    issues.push(`${label} "${url}" is not a valid URL`)
    return
  }
  if (parsed.protocol !== "https:" && !(network === "LOCAL" && parsed.protocol === "http:")) {
    issues.push(`${label} must use https`)
  }
  const inferred = inferNetworkFromUrl(url)
  if (inferred && inferred !== network) {
    issues.push(`${label} ${parsed.host} looks like ${inferred}, but the app is configured for ${network}`)
  }
}

export function resolveNetworkConfig(raw: RawNetworkInput): StellarNetworkConfig {
  const issues: string[] = []
  const requested = (raw.network || "TESTNET").trim().toUpperCase()
  let network: StellarNetworkName = "TESTNET"
  if (isNetworkName(requested)) {
    network = requested
  } else {
    issues.push(`Unknown NEXT_PUBLIC_STELLAR_NETWORK "${raw.network}" (expected TESTNET, PUBLIC, FUTURENET or LOCAL)`)
  }

  const passphrase = NETWORK_PASSPHRASES[network]
  if (raw.passphrase && raw.passphrase !== passphrase) {
    issues.push(`Configured passphrase "${raw.passphrase}" does not match ${network}`)
  }

  const horizonUrl = (raw.horizonUrl || DEFAULT_ENDPOINTS[network].horizon).replace(/\/+$/, "")
  const rpcUrl = (raw.rpcUrl || DEFAULT_ENDPOINTS[network].rpc).replace(/\/+$/, "")
  validateUrl("Horizon URL", horizonUrl, network, issues)
  validateUrl("RPC URL", rpcUrl, network, issues)

  return {
    network,
    label: network === "PUBLIC" ? "Mainnet" : network.charAt(0) + network.slice(1).toLowerCase(),
    passphrase,
    horizonUrl,
    rpcUrl,
    explorerNetwork: EXPLORER_SEGMENT[network],
    issues,
    valid: issues.length === 0,
  }
}

export function explorerTxUrl(config: StellarNetworkConfig, hash: string): string | null {
  if (!config.explorerNetwork) return null
  return `https://stellar.expert/explorer/${config.explorerNetwork}/tx/${hash}`
}

/**
 * Compare what a wallet reports with the app configuration. A passphrase is
 * authoritative; the network name is a fallback for wallets that omit it.
 * Returns null when they match, or a human-readable mismatch description.
 */
export function walletNetworkMismatch(
  config: StellarNetworkConfig,
  wallet: { network?: string | null; passphrase?: string | null }
): string | null {
  if (wallet.passphrase) {
    if (wallet.passphrase === config.passphrase) return null
    const name = normalizeNetworkName(wallet.passphrase) ?? "an unknown network"
    return `Wallet is connected to ${name}, but this app uses ${config.network}`
  }
  const name = normalizeNetworkName(wallet.network)
  if (!name) return "Wallet did not report its network; switch it to " + config.network + " and reconnect"
  if (name !== config.network) return `Wallet is connected to ${name}, but this app uses ${config.network}`
  return null
}

/**
 * The app's network configuration. Env vars are read with literal
 * `process.env.NEXT_PUBLIC_*` access so Next.js inlines them at build time.
 */
export const APP_NETWORK: StellarNetworkConfig = resolveNetworkConfig({
  network: process.env.NEXT_PUBLIC_STELLAR_NETWORK,
  passphrase: process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE,
  horizonUrl: process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL,
  rpcUrl: process.env.NEXT_PUBLIC_STELLAR_RPC_URL,
})

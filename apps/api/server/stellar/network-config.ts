/**
 * Stellar network + contract configuration validation.
 *
 * Validates the network passphrase, RPC/Horizon endpoints, contract IDs and the
 * deployment manifest *together*, so a deployment cannot silently combine a
 * mainnet network with testnet contract IDs (or an unsupported contract version).
 *
 * Policy:
 * - Any validation error disables write operations (mint / burn / submit).
 * - On the PUBLIC network, errors fail startup unless the operator explicitly opts
 *   into a read-only API with STELLAR_CONFIG_ON_ERROR=read-only.
 * - A configuration fingerprint (sha256 over public identifiers only) is exposed so
 *   operators can compare deployments without seeing any secret.
 */
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"
import { Keypair, StrKey } from "@stellar/stellar-sdk"
import bundledTestnetManifest from "../../../contracts/deployments/testnet.json"

export type StellarNetworkName = "PUBLIC" | "TESTNET" | "FUTURENET" | "LOCAL"
export type ContractRole = "energy_token" | "energy_distribution" | "community_governance"

export const NETWORK_PASSPHRASES: Record<StellarNetworkName, string> = {
  PUBLIC: "Public Global Stellar Network ; September 2015",
  TESTNET: "Test SDF Network ; September 2015",
  FUTURENET: "Test SDF Future Network ; October 2022",
  LOCAL: "Standalone Network ; February 2017",
}

/** Well-known SDF hosts. Using another network's host is always a mismatch. */
const KNOWN_HOSTS: Record<StellarNetworkName, string[]> = {
  PUBLIC: ["horizon.stellar.org"],
  TESTNET: ["horizon-testnet.stellar.org", "soroban-testnet.stellar.org"],
  FUTURENET: ["horizon-futurenet.stellar.org", "rpc-futurenet.stellar.org"],
  LOCAL: [],
}

/** Contract versions (crate versions) this API build knows how to talk to. */
export const SUPPORTED_CONTRACT_VERSIONS: Record<ContractRole, string[]> = {
  energy_token: ["0.1.0"],
  energy_distribution: ["0.1.0"],
  community_governance: ["0.1.0"],
}

const REQUIRED_ROLES: ContractRole[] = ["energy_token", "energy_distribution"]
const ALL_ROLES: ContractRole[] = ["energy_token", "energy_distribution", "community_governance"]

const CONTRACT_ENV: Record<ContractRole, string> = {
  energy_token: "NEXT_PUBLIC_ENERGY_TOKEN_CONTRACT",
  energy_distribution: "NEXT_PUBLIC_ENERGY_DISTRIBUTION_CONTRACT",
  community_governance: "NEXT_PUBLIC_COMMUNITY_GOVERNANCE_CONTRACT",
}

export interface DeploymentManifest {
  schemaVersion: number
  network: string
  networkPassphrase: string
  environment?: string
  contracts: Partial<Record<ContractRole, { id: string; version: string; wasmHash?: string }>>
}

export interface ConfigIssue {
  code: string
  message: string
}

export interface StellarConfigReport {
  network: StellarNetworkName | null
  networkPassphrase: string | null
  rpcUrl: string | null
  horizonUrl: string | null
  contracts: Partial<Record<ContractRole, string>>
  manifest: DeploymentManifest | null
  minterPublicKey: string | null
  errors: ConfigIssue[]
  warnings: ConfigIssue[]
  writesEnabled: boolean
  fingerprint: string
}

type Env = Record<string, string | undefined>

function normalizeNetwork(raw: string | undefined): StellarNetworkName | null {
  const value = (raw ?? "").trim().toUpperCase()
  if (value === "PUBLIC" || value === "MAINNET" || value === "PUBNET") return "PUBLIC"
  if (value === "TESTNET" || value === "FUTURENET" || value === "LOCAL") return value
  return null
}

function safeHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return "<invalid-url>"
  }
}

/** Origin only — strips credentials, paths and query strings that may carry provider API keys. */
function safeOrigin(url: string | null): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host}`
  } catch {
    return "<invalid-url>"
  }
}

function validateEndpoint(
  label: "RPC" | "Horizon",
  url: string | undefined,
  network: StellarNetworkName,
  errors: ConfigIssue[]
): string | null {
  if (!url) {
    if (network === "PUBLIC") {
      errors.push({
        code: `${label.toUpperCase()}_URL_MISSING`,
        message: `${label} URL must be set explicitly on the PUBLIC network (defaults point to testnet)`,
      })
    }
    return null
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    errors.push({ code: `${label.toUpperCase()}_URL_INVALID`, message: `${label} URL is not a valid URL` })
    return null
  }

  const host = parsed.hostname.toLowerCase()

  if (network === "PUBLIC") {
    if (parsed.protocol !== "https:") {
      errors.push({ code: `${label.toUpperCase()}_URL_INSECURE`, message: `${label} URL must use https on PUBLIC` })
    }
    if (/testnet|futurenet|localhost|127\.0\.0\.1/.test(host)) {
      errors.push({
        code: `${label.toUpperCase()}_URL_NETWORK_MISMATCH`,
        message: `${label} host ${parsed.host} looks like a non-public network endpoint`,
      })
    }
  }

  for (const other of Object.keys(KNOWN_HOSTS) as StellarNetworkName[]) {
    if (other !== network && KNOWN_HOSTS[other].includes(host)) {
      errors.push({
        code: `${label.toUpperCase()}_URL_NETWORK_MISMATCH`,
        message: `${label} host ${parsed.host} belongs to ${other}, but network is ${network}`,
      })
    }
  }

  return url
}

export function loadDeploymentManifest(env: Env, cwd: string = process.cwd()): {
  manifest: DeploymentManifest | null
  error?: ConfigIssue
} {
  const inline = env.STELLAR_DEPLOYMENT_MANIFEST_JSON
  const file = env.STELLAR_DEPLOYMENT_MANIFEST
  if (!inline && !file) return { manifest: null }

  try {
    const raw = inline ?? readFileSync(path.resolve(cwd, file!), "utf8")
    const manifest = JSON.parse(raw) as DeploymentManifest
    if (typeof manifest !== "object" || manifest === null || typeof manifest.contracts !== "object") {
      return { manifest: null, error: { code: "MANIFEST_INVALID", message: "Deployment manifest has no contracts section" } }
    }
    return { manifest }
  } catch (err) {
    return {
      manifest: null,
      error: {
        code: "MANIFEST_UNREADABLE",
        message: `Deployment manifest could not be read: ${err instanceof Error ? err.message : "unknown error"}`,
      },
    }
  }
}

const KNOWN_TESTNET_CONTRACT_IDS = new Set(
  Object.values((bundledTestnetManifest as DeploymentManifest).contracts)
    .map((c) => c?.id)
    .filter((id): id is string => Boolean(id))
)

export function validateStellarConfig(
  env: Env,
  manifestOverride?: DeploymentManifest | null
): StellarConfigReport {
  const errors: ConfigIssue[] = []
  const warnings: ConfigIssue[] = []

  const network = normalizeNetwork(env.NEXT_PUBLIC_STELLAR_NETWORK || "TESTNET")
  if (!network) {
    errors.push({ code: "NETWORK_UNKNOWN", message: "NEXT_PUBLIC_STELLAR_NETWORK must be PUBLIC, TESTNET, FUTURENET or LOCAL" })
  }

  const expectedPassphrase = network ? NETWORK_PASSPHRASES[network] : null
  const explicitPassphrase = env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE
  if (explicitPassphrase && expectedPassphrase && explicitPassphrase !== expectedPassphrase) {
    errors.push({
      code: "PASSPHRASE_MISMATCH",
      message: `NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE does not match network ${network}`,
    })
  }

  // Secondary network flag used by wallet provisioning must agree too.
  const secondary = env.STELLAR_NETWORK ? normalizeNetwork(env.STELLAR_NETWORK) : null
  if (network && secondary && secondary !== network) {
    errors.push({ code: "NETWORK_FLAG_MISMATCH", message: `STELLAR_NETWORK=${secondary} disagrees with ${network}` })
  }

  const rpcUrl = network
    ? validateEndpoint("RPC", env.NEXT_PUBLIC_STELLAR_RPC_URL, network, errors)
    : env.NEXT_PUBLIC_STELLAR_RPC_URL ?? null
  const horizonUrl = network
    ? validateEndpoint("Horizon", env.NEXT_PUBLIC_STELLAR_HORIZON_URL, network, errors)
    : env.NEXT_PUBLIC_STELLAR_HORIZON_URL ?? null

  // Contract IDs from env
  const contracts: Partial<Record<ContractRole, string>> = {}
  for (const role of ALL_ROLES) {
    const id = env[CONTRACT_ENV[role]]?.trim()
    if (!id) {
      if (REQUIRED_ROLES.includes(role)) {
        errors.push({ code: "CONTRACT_ID_MISSING", message: `${CONTRACT_ENV[role]} is not set` })
      }
      continue
    }
    if (!StrKey.isValidContract(id)) {
      errors.push({ code: "CONTRACT_ID_INVALID", message: `${CONTRACT_ENV[role]} is not a valid contract ID` })
      continue
    }
    contracts[role] = id
  }

  const ids = Object.values(contracts)
  if (new Set(ids).size !== ids.length) {
    errors.push({ code: "CONTRACT_ID_DUPLICATE", message: "The same contract ID is configured for more than one role" })
  }

  if (network === "PUBLIC") {
    for (const [role, id] of Object.entries(contracts)) {
      if (KNOWN_TESTNET_CONTRACT_IDS.has(id)) {
        errors.push({
          code: "CONTRACT_ID_NETWORK_MISMATCH",
          message: `${role} uses a known TESTNET contract ID on the PUBLIC network`,
        })
      }
    }
  }

  // Deployment manifest
  let manifest: DeploymentManifest | null
  if (manifestOverride !== undefined) {
    manifest = manifestOverride
  } else {
    const loaded = loadDeploymentManifest(env)
    manifest = loaded.manifest
    if (loaded.error) errors.push(loaded.error)
  }

  if (!manifest) {
    const issue = { code: "MANIFEST_MISSING", message: "No deployment manifest configured (STELLAR_DEPLOYMENT_MANIFEST)" }
    if (network === "PUBLIC") errors.push(issue)
    else warnings.push(issue)
  } else {
    if (network && normalizeNetwork(manifest.network) !== network) {
      errors.push({
        code: "MANIFEST_NETWORK_MISMATCH",
        message: `Manifest is for ${manifest.network}, but network is ${network}`,
      })
    }
    if (expectedPassphrase && manifest.networkPassphrase !== expectedPassphrase) {
      errors.push({ code: "MANIFEST_PASSPHRASE_MISMATCH", message: "Manifest network passphrase does not match network" })
    }
    for (const role of ALL_ROLES) {
      const entry = manifest.contracts[role]
      const configured = contracts[role]
      if (!entry) {
        if (configured) {
          errors.push({ code: "MANIFEST_CONTRACT_MISSING", message: `${role} is configured but absent from the manifest` })
        } else if (REQUIRED_ROLES.includes(role)) {
          errors.push({ code: "MANIFEST_CONTRACT_MISSING", message: `Manifest does not declare required contract ${role}` })
        }
        continue
      }
      if (configured && entry.id !== configured) {
        errors.push({
          code: "CONTRACT_ID_MANIFEST_MISMATCH",
          message: `${role} contract ID does not match the deployment manifest`,
        })
      }
      if (!SUPPORTED_CONTRACT_VERSIONS[role].includes(entry.version)) {
        errors.push({
          code: "CONTRACT_VERSION_UNSUPPORTED",
          message: `${role} version ${entry.version} is not supported (supported: ${SUPPORTED_CONTRACT_VERSIONS[role].join(", ")})`,
        })
      }
    }
  }

  // Minter key: only its presence/validity matters; it is never echoed.
  let minterPublicKey: string | null = null
  if (env.MINTER_SECRET_KEY) {
    try {
      minterPublicKey = Keypair.fromSecret(env.MINTER_SECRET_KEY).publicKey()
    } catch {
      errors.push({ code: "MINTER_KEY_INVALID", message: "MINTER_SECRET_KEY is not a valid Stellar secret key" })
    }
  } else {
    warnings.push({ code: "MINTER_KEY_MISSING", message: "MINTER_SECRET_KEY not set — write operations disabled" })
  }

  const report: Omit<StellarConfigReport, "fingerprint"> = {
    network,
    networkPassphrase: expectedPassphrase,
    rpcUrl,
    horizonUrl,
    contracts,
    manifest,
    minterPublicKey,
    errors,
    warnings,
    writesEnabled: errors.length === 0 && minterPublicKey !== null,
  }

  return { ...report, fingerprint: computeConfigFingerprint(report) }
}

/**
 * sha256 over public identifiers only (network, passphrase, endpoint origins,
 * contract IDs, manifest versions, minter *public* key). Never includes secrets,
 * URL paths or query strings.
 */
export function computeConfigFingerprint(report: Omit<StellarConfigReport, "fingerprint">): string {
  const canonical = {
    network: report.network,
    passphrase: report.networkPassphrase,
    rpc: safeOrigin(report.rpcUrl),
    horizon: safeOrigin(report.horizonUrl),
    contracts: ALL_ROLES.map((r) => [r, report.contracts[r] ?? null]),
    versions: ALL_ROLES.map((r) => [r, report.manifest?.contracts[r]?.version ?? null]),
    minter: report.minterPublicKey,
  }
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical)).digest("hex")}`
}

/** Public, secret-free view for health endpoints and logs. */
export function publicConfigSummary(report: StellarConfigReport) {
  return {
    network: report.network,
    fingerprint: report.fingerprint,
    writes_enabled: report.writesEnabled,
    rpc_host: report.rpcUrl ? safeHost(report.rpcUrl) : null,
    horizon_host: report.horizonUrl ? safeHost(report.horizonUrl) : null,
    contracts: report.contracts,
    manifest: report.manifest
      ? {
          environment: report.manifest.environment ?? null,
          versions: Object.fromEntries(
            Object.entries(report.manifest.contracts).map(([role, c]) => [role, c?.version ?? null])
          ),
        }
      : null,
    errors: report.errors.map((e) => e.code),
    warnings: report.warnings.map((w) => w.code),
  }
}

// ---------------------------------------------------------------------------
// Process-level cache, startup enforcement, and write guard
// ---------------------------------------------------------------------------

let cached: StellarConfigReport | null = null

export function getStellarConfigReport(): StellarConfigReport {
  if (!cached) cached = validateStellarConfig(process.env)
  return cached
}

export function resetStellarConfigCache() {
  cached = null
}

export class StellarConfigError extends Error {
  constructor(message: string, public readonly issues: ConfigIssue[]) {
    super(message)
    this.name = "StellarConfigError"
  }
}

/**
 * Called from instrumentation `register()`. Throws (fails startup) on invalid
 * PUBLIC configuration unless STELLAR_CONFIG_ON_ERROR=read-only; otherwise logs
 * and leaves the API running in read-only mode.
 */
export function enforceStellarConfigAtStartup(env: Env = process.env): StellarConfigReport {
  const report = getStellarConfigReport()
  const summary = publicConfigSummary(report)
  const onError = (env.STELLAR_CONFIG_ON_ERROR ?? "").toLowerCase()
  const shouldFail = onError === "fail" || (report.network === "PUBLIC" && onError !== "read-only")

  if (report.errors.length > 0) {
    const detail = report.errors.map((e) => `${e.code}: ${e.message}`).join("; ")
    if (shouldFail) {
      throw new StellarConfigError(`[stellar-config] Refusing to start: ${detail}`, report.errors)
    }
    console.error(`[stellar-config] Invalid configuration, write operations disabled: ${detail}`)
  }
  for (const w of report.warnings) console.warn(`[stellar-config] ${w.code}: ${w.message}`)
  console.info("[stellar-config]", JSON.stringify(summary))
  return report
}

export function assertStellarWritesEnabled(): StellarConfigReport {
  const report = getStellarConfigReport()
  if (!report.writesEnabled) {
    throw new StellarConfigError(
      "Stellar write operations are disabled by configuration validation",
      report.errors.length ? report.errors : report.warnings
    )
  }
  return report
}

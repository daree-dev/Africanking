/**
 * generate-manifest.ts
 *
 * Generates a release manifest at build time:
 *   dist/release-manifest.json
 *
 * The manifest records the commit SHA, package versions, contract WASM
 * hashes, and network/environment identifiers. It contains no credentials
 * or private user data.
 *
 * Usage:
 *   npx tsx scripts/generate-manifest.ts
 *   # or via turbo: "manifest": "tsx scripts/generate-manifest.ts"
 *
 * The manifest is consumed by:
 *   - apps/api/app/api/health/route.ts  (exposed as build_id in /api/health)
 *   - CI verification step (compare deployed manifest to artifact hashes)
 */

import { execSync } from "child_process"
import * as fs from "fs"
import * as path from "path"
import * as crypto from "crypto"

const ROOT = path.resolve(__dirname, "..")
const OUT_DIR = path.join(ROOT, "dist")
const OUT_FILE = path.join(OUT_DIR, "release-manifest.json")

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function run(cmd: string, fallback = "unknown"): string {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: "utf8" }).trim()
  } catch {
    return fallback
  }
}

function sha256File(filePath: string): string | null {
  try {
    const buf = fs.readFileSync(filePath)
    return crypto.createHash("sha256").update(buf).digest("hex")
  } catch {
    return null
  }
}

function readJsonVersion(pkgPath: string): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"))
    return pkg.version ?? "unknown"
  } catch {
    return "unknown"
  }
}

// ---------------------------------------------------------------------------
// Git provenance
// ---------------------------------------------------------------------------

const commitSha = run("git rev-parse HEAD")
const shortSha = run("git rev-parse --short HEAD")
const commitDate = run("git log -1 --format=%cI")
const branch = run("git rev-parse --abbrev-ref HEAD")
const tags = run("git tag --points-at HEAD", "")

// ---------------------------------------------------------------------------
// Package versions
// ---------------------------------------------------------------------------

const packages = {
  api: readJsonVersion(path.join(ROOT, "apps/api/package.json")),
  web: readJsonVersion(path.join(ROOT, "apps/web/package.json")),
  stellar: readJsonVersion(path.join(ROOT, "packages/stellar/package.json")),
  root: readJsonVersion(path.join(ROOT, "package.json")),
}

// ---------------------------------------------------------------------------
// Contract WASM hashes
// ---------------------------------------------------------------------------
// Compiled WASM files land in apps/contracts/target/wasm32v1-none/release/
// after `stellar contract build`. If not present, hash is null (pre-build).

const WASM_DIR = path.join(
  ROOT,
  "apps/contracts/target/wasm32v1-none/release"
)

const contractNames = [
  "energy_token",
  "energy_distribution",
  "community_governance",
  "cooperative_factory",
]

const contractHashes: Record<string, string | null> = {}
for (const name of contractNames) {
  const wasmPath = path.join(WASM_DIR, `${name}.wasm`)
  contractHashes[name] = sha256File(wasmPath)
}

// ---------------------------------------------------------------------------
// Deployed contract addresses (read from env, not hardcoded secrets)
// ---------------------------------------------------------------------------
// These are public on-chain addresses — not credentials.

const deployedContracts: Record<string, string> = {
  energy_token:
    process.env.NEXT_PUBLIC_ENERGY_TOKEN_CONTRACT ??
    "CCYOVOFDJ5BVBSI6HADLWETTUF3BU423MEAWBSBWV2X5UVNKSJMRPBA6",
  energy_distribution:
    process.env.NEXT_PUBLIC_ENERGY_DISTRIBUTION_CONTRACT ??
    "CBTDPLFNFGWVOD4HXDKW4EH5L3D2YGOY5CWTFCJM5TEWFL4VQTNX2UDZ",
  community_governance:
    process.env.NEXT_PUBLIC_COMMUNITY_GOVERNANCE_CONTRACT ??
    "CCH2EXXNSDW2BAKBIPFAG6CCZS6LV4VJFUP2CZZCW5LEY4JOAXBJD6YI",
}

// ---------------------------------------------------------------------------
// Network / environment
// ---------------------------------------------------------------------------

const network = {
  stellar_network: process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? "TESTNET",
  stellar_rpc_url:
    process.env.NEXT_PUBLIC_STELLAR_RPC_URL ??
    "https://soroban-testnet.stellar.org",
  horizon_url:
    process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL ??
    "https://horizon-testnet.stellar.org",
  vercel_env: process.env.VERCEL_ENV ?? "local",
  vercel_region: process.env.VERCEL_REGION ?? "unknown",
}

// ---------------------------------------------------------------------------
// Pnpm lockfile hash (dependency integrity)
// ---------------------------------------------------------------------------

const lockfileHash = sha256File(path.join(ROOT, "pnpm-lock.yaml"))

// ---------------------------------------------------------------------------
// Assemble manifest
// ---------------------------------------------------------------------------

const manifest = {
  // Human-readable build identifier — safe to log and expose in /api/health
  build_id: `${shortSha}+${network.stellar_network.toLowerCase()}`,

  git: {
    commit_sha: commitSha,
    short_sha: shortSha,
    commit_date: commitDate,
    branch,
    tags: tags ? tags.split("\n") : [],
  },

  packages,

  lockfile_sha256: lockfileHash,

  contracts: {
    wasm_hashes: contractHashes,
    deployed_addresses: deployedContracts,
  },

  network,

  generated_at: new Date().toISOString(),
}

// ---------------------------------------------------------------------------
// Write output
// ---------------------------------------------------------------------------

fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(OUT_FILE, JSON.stringify(manifest, null, 2))

console.log(`Release manifest written to ${OUT_FILE}`)
console.log(`build_id: ${manifest.build_id}`)
console.log(
  `contracts wasm_hashes: ${JSON.stringify(contractHashes, null, 2)}`
)

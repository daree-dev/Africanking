import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { Keypair } from "@stellar/stellar-sdk"
import path from "node:path"
import {
  validateStellarConfig,
  enforceStellarConfigAtStartup,
  resetStellarConfigCache,
  publicConfigSummary,
  NETWORK_PASSPHRASES,
  type DeploymentManifest,
} from "@/server/stellar/network-config"

// Real IDs from apps/contracts/deployments/testnet.json
const TESTNET_IDS = {
  energy_token: "CCYOVOFDJ5BVBSI6HADLWETTUF3BU423MEAWBSBWV2X5UVNKSJMRPBA6",
  energy_distribution: "CBTDPLFNFGWVOD4HXDKW4EH5L3D2YGOY5CWTFCJM5TEWFL4VQTNX2UDZ",
  community_governance: "CCH2EXXNSDW2BAKBIPFAG6CCZS6LV4VJFUP2CZZCW5LEY4JOAXBJD6YI",
}

// Synthetic, well-formed contract IDs standing in for a production deployment
const MAINNET_IDS = {
  energy_token: "CCHNXS3UIRUM2BEQTR6RPT5H27EIMXZGAVD3U2R5JHH55DSKOQCRQY3W",
  energy_distribution: "CAGMLPLTWBYIS52XSCVPHKO7NZQLLTQUB6HG2G7UMXLTHJX6MLJZ5ECT",
  community_governance: "CBOP7EDJI7CXSSENPBSXVGAEY6GXD5HFILN4QEWCLTRIBM3WN3YRD3MJ",
}

const minterSecret = Keypair.random().secret()

function manifestFor(network: "TESTNET" | "PUBLIC", ids: typeof TESTNET_IDS, version = "0.1.0"): DeploymentManifest {
  return {
    schemaVersion: 1,
    network,
    networkPassphrase: NETWORK_PASSPHRASES[network],
    contracts: {
      energy_token: { id: ids.energy_token, version },
      energy_distribution: { id: ids.energy_distribution, version },
      community_governance: { id: ids.community_governance, version },
    },
  }
}

function testnetEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    NEXT_PUBLIC_STELLAR_NETWORK: "TESTNET",
    NEXT_PUBLIC_STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
    NEXT_PUBLIC_STELLAR_HORIZON_URL: "https://horizon-testnet.stellar.org",
    NEXT_PUBLIC_ENERGY_TOKEN_CONTRACT: TESTNET_IDS.energy_token,
    NEXT_PUBLIC_ENERGY_DISTRIBUTION_CONTRACT: TESTNET_IDS.energy_distribution,
    NEXT_PUBLIC_COMMUNITY_GOVERNANCE_CONTRACT: TESTNET_IDS.community_governance,
    MINTER_SECRET_KEY: minterSecret,
    ...overrides,
  }
}

function publicEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    NEXT_PUBLIC_STELLAR_NETWORK: "PUBLIC",
    NEXT_PUBLIC_STELLAR_RPC_URL: "https://rpc.example-provider.com/v1/secret-api-key",
    NEXT_PUBLIC_STELLAR_HORIZON_URL: "https://horizon.stellar.org",
    NEXT_PUBLIC_ENERGY_TOKEN_CONTRACT: MAINNET_IDS.energy_token,
    NEXT_PUBLIC_ENERGY_DISTRIBUTION_CONTRACT: MAINNET_IDS.energy_distribution,
    NEXT_PUBLIC_COMMUNITY_GOVERNANCE_CONTRACT: MAINNET_IDS.community_governance,
    MINTER_SECRET_KEY: minterSecret,
    ...overrides,
  }
}

const codes = (r: { errors: { code: string }[] }) => r.errors.map((e) => e.code)

describe("validateStellarConfig — valid manifests", () => {
  it("accepts a consistent testnet configuration", () => {
    const r = validateStellarConfig(testnetEnv(), manifestFor("TESTNET", TESTNET_IDS))
    expect(r.errors).toEqual([])
    expect(r.writesEnabled).toBe(true)
    expect(r.networkPassphrase).toBe(NETWORK_PASSPHRASES.TESTNET)
  })

  it("accepts the committed testnet manifest file", () => {
    const manifestPath = path.resolve(__dirname, "../../../contracts/deployments/testnet.json")
    const r = validateStellarConfig(testnetEnv({ STELLAR_DEPLOYMENT_MANIFEST: manifestPath }))
    expect(r.errors).toEqual([])
    expect(r.writesEnabled).toBe(true)
  })

  it("accepts a consistent production configuration", () => {
    const r = validateStellarConfig(publicEnv(), manifestFor("PUBLIC", MAINNET_IDS))
    expect(r.errors).toEqual([])
    expect(r.writesEnabled).toBe(true)
    expect(r.network).toBe("PUBLIC")
  })

  it("only warns (read-only) when testnet has no minter key", () => {
    const r = validateStellarConfig(testnetEnv({ MINTER_SECRET_KEY: undefined }), manifestFor("TESTNET", TESTNET_IDS))
    expect(r.errors).toEqual([])
    expect(r.writesEnabled).toBe(false)
    expect(r.warnings.map((w) => w.code)).toContain("MINTER_KEY_MISSING")
  })
})

describe("validateStellarConfig — mixed network failures", () => {
  it("rejects testnet contract IDs on the PUBLIC network", () => {
    const r = validateStellarConfig(
      publicEnv({
        NEXT_PUBLIC_ENERGY_TOKEN_CONTRACT: TESTNET_IDS.energy_token,
        NEXT_PUBLIC_ENERGY_DISTRIBUTION_CONTRACT: TESTNET_IDS.energy_distribution,
      }),
      manifestFor("PUBLIC", MAINNET_IDS)
    )
    expect(codes(r)).toContain("CONTRACT_ID_NETWORK_MISMATCH")
    expect(codes(r)).toContain("CONTRACT_ID_MANIFEST_MISMATCH")
    expect(r.writesEnabled).toBe(false)
  })

  it("rejects a testnet manifest on the PUBLIC network", () => {
    const r = validateStellarConfig(publicEnv(), manifestFor("TESTNET", MAINNET_IDS))
    expect(codes(r)).toEqual(expect.arrayContaining(["MANIFEST_NETWORK_MISMATCH", "MANIFEST_PASSPHRASE_MISMATCH"]))
  })

  it("rejects testnet RPC/Horizon endpoints on the PUBLIC network", () => {
    const r = validateStellarConfig(
      publicEnv({
        NEXT_PUBLIC_STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
        NEXT_PUBLIC_STELLAR_HORIZON_URL: "https://horizon-testnet.stellar.org",
      }),
      manifestFor("PUBLIC", MAINNET_IDS)
    )
    expect(codes(r)).toEqual(expect.arrayContaining(["RPC_URL_NETWORK_MISMATCH", "HORIZON_URL_NETWORK_MISMATCH"]))
  })

  it("rejects mainnet Horizon on TESTNET", () => {
    const r = validateStellarConfig(
      testnetEnv({ NEXT_PUBLIC_STELLAR_HORIZON_URL: "https://horizon.stellar.org" }),
      manifestFor("TESTNET", TESTNET_IDS)
    )
    expect(codes(r)).toContain("HORIZON_URL_NETWORK_MISMATCH")
  })

  it("rejects an explicit passphrase that disagrees with the network", () => {
    const r = validateStellarConfig(
      publicEnv({ NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE: NETWORK_PASSPHRASES.TESTNET }),
      manifestFor("PUBLIC", MAINNET_IDS)
    )
    expect(codes(r)).toContain("PASSPHRASE_MISMATCH")
  })

  it("rejects a disagreeing STELLAR_NETWORK flag", () => {
    const r = validateStellarConfig(publicEnv({ STELLAR_NETWORK: "testnet" }), manifestFor("PUBLIC", MAINNET_IDS))
    expect(codes(r)).toContain("NETWORK_FLAG_MISMATCH")
  })

  it("rejects unsupported contract versions", () => {
    const r = validateStellarConfig(testnetEnv(), manifestFor("TESTNET", TESTNET_IDS, "9.0.0"))
    expect(codes(r)).toContain("CONTRACT_VERSION_UNSUPPORTED")
  })
})

describe("validateStellarConfig — missing values", () => {
  it("requires explicit endpoints and a manifest on PUBLIC", () => {
    const r = validateStellarConfig(
      publicEnv({ NEXT_PUBLIC_STELLAR_RPC_URL: undefined, NEXT_PUBLIC_STELLAR_HORIZON_URL: undefined }),
      null
    )
    expect(codes(r)).toEqual(expect.arrayContaining(["RPC_URL_MISSING", "HORIZON_URL_MISSING", "MANIFEST_MISSING"]))
  })

  it("requires token and distribution contract IDs", () => {
    const r = validateStellarConfig(
      testnetEnv({ NEXT_PUBLIC_ENERGY_TOKEN_CONTRACT: "", NEXT_PUBLIC_ENERGY_DISTRIBUTION_CONTRACT: undefined }),
      manifestFor("TESTNET", TESTNET_IDS)
    )
    expect(codes(r).filter((c) => c === "CONTRACT_ID_MISSING")).toHaveLength(2)
    expect(r.writesEnabled).toBe(false)
  })

  it("rejects malformed contract IDs and minter keys", () => {
    const r = validateStellarConfig(
      testnetEnv({ NEXT_PUBLIC_ENERGY_TOKEN_CONTRACT: "CNOTVALID", MINTER_SECRET_KEY: "SNOTVALID" }),
      manifestFor("TESTNET", TESTNET_IDS)
    )
    expect(codes(r)).toEqual(expect.arrayContaining(["CONTRACT_ID_INVALID", "MINTER_KEY_INVALID"]))
  })

  it("reports an unreadable manifest file", () => {
    const r = validateStellarConfig(testnetEnv({ STELLAR_DEPLOYMENT_MANIFEST: "/nonexistent/manifest.json" }))
    expect(codes(r)).toContain("MANIFEST_UNREADABLE")
  })
})

describe("configuration fingerprint", () => {
  it("is stable, changes with contract IDs, and never contains secrets", () => {
    const a = validateStellarConfig(publicEnv(), manifestFor("PUBLIC", MAINNET_IDS))
    const b = validateStellarConfig(publicEnv(), manifestFor("PUBLIC", MAINNET_IDS))
    const c = validateStellarConfig(
      publicEnv({ NEXT_PUBLIC_COMMUNITY_GOVERNANCE_CONTRACT: undefined }),
      manifestFor("PUBLIC", MAINNET_IDS)
    )
    expect(a.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(a.fingerprint).toBe(b.fingerprint)
    expect(a.fingerprint).not.toBe(c.fingerprint)

    const serialized = JSON.stringify(publicConfigSummary(a))
    expect(serialized).not.toContain(minterSecret)
    expect(serialized).not.toContain("secret-api-key")
    expect(serialized).toContain("rpc.example-provider.com")
  })
})

describe("enforceStellarConfigAtStartup", () => {
  const originalEnv = process.env

  beforeEach(() => {
    resetStellarConfigCache()
    vi.spyOn(console, "info").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    process.env = originalEnv
    resetStellarConfigCache()
    vi.restoreAllMocks()
  })

  it("fails startup on invalid PUBLIC configuration", () => {
    process.env = { ...originalEnv, ...publicEnv({ NEXT_PUBLIC_STELLAR_RPC_URL: "https://soroban-testnet.stellar.org" }) }
    expect(() => enforceStellarConfigAtStartup()).toThrow(/Refusing to start/)
  })

  it("allows explicit read-only mode on invalid PUBLIC configuration", () => {
    process.env = {
      ...originalEnv,
      ...publicEnv({ NEXT_PUBLIC_STELLAR_RPC_URL: "https://soroban-testnet.stellar.org" }),
      STELLAR_CONFIG_ON_ERROR: "read-only",
    }
    const report = enforceStellarConfigAtStartup()
    expect(report.writesEnabled).toBe(false)
  })

  it("keeps testnet up but read-only on invalid configuration", () => {
    process.env = { ...originalEnv, ...testnetEnv({ NEXT_PUBLIC_ENERGY_TOKEN_CONTRACT: "" }) }
    const report = enforceStellarConfigAtStartup()
    expect(report.writesEnabled).toBe(false)
  })
})

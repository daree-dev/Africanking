import { describe, it, expect, vi } from "vitest"
import * as StellarSdk from "@stellar/stellar-sdk"
import { resolveNetworkConfig, NETWORK_PASSPHRASES } from "@/lib/stellar-network"
import {
  executeContractWrite,
  preflight,
  WalletWriteError,
  type ContractWriteDeps,
  type ContractWriteRequest,
  type LiveWalletState,
  type SignFn,
} from "@/lib/wallet/contract-write"

const TESTNET = resolveNetworkConfig({ network: "TESTNET" })
const CONTRACT = "CAUH3NUZGCNRHHVJK5S3FLXIS244GCNPC2LDZDU2SVOK66G3IGAGBBL2"
const admin = StellarSdk.Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1))
const other = StellarSdk.Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2))
const member = StellarSdk.Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3)).publicKey()
const COOP = { id: "coop-1", name: "Cooperativa Solar Norte" }

function request(overrides: Partial<ContractWriteRequest> = {}): ContractWriteRequest {
  return {
    operation: "mint",
    cooperative: COOP,
    amountKwh: 12.5,
    contractId: CONTRACT,
    method: "mint_energy",
    recipient: member,
    args: [
      StellarSdk.nativeToScVal(member, { type: "address" }),
      StellarSdk.nativeToScVal(BigInt(125000000), { type: "i128" }),
      StellarSdk.nativeToScVal(admin.publicKey(), { type: "address" }),
    ],
    ...overrides,
  }
}

/** A wallet that signs with `keypair` for `passphrase` (defaults to the right network). */
function signer(keypair = admin, passphrase = NETWORK_PASSPHRASES.TESTNET): SignFn {
  return async (xdr) => {
    const tx = StellarSdk.TransactionBuilder.fromXDR(xdr, passphrase) as StellarSdk.Transaction
    tx.sign(keypair)
    return { signedTxXdr: tx.toXDR(), signerAddress: keypair.publicKey() }
  }
}

function setup(opts: {
  wallet?: LiveWalletState | LiveWalletState[]
  sign?: SignFn
  confirm?: boolean
  txStatuses?: string[]
} = {}) {
  const events: string[] = []
  const wallets = Array.isArray(opts.wallet)
    ? [...opts.wallet]
    : [opts.wallet ?? { address: admin.publicKey(), network: "TESTNET", passphrase: NETWORK_PASSPHRASES.TESTNET }]
  const statuses = [...(opts.txStatuses ?? ["NOT_FOUND", "SUCCESS"])]

  const server = {
    getAccount: vi.fn(async (id: string) => {
      events.push("getAccount")
      return new StellarSdk.Account(id, "100")
    }),
    prepareTransaction: vi.fn(async (tx: StellarSdk.Transaction) => {
      events.push("prepare")
      return tx
    }),
    sendTransaction: vi.fn(async (tx: StellarSdk.Transaction) => {
      events.push("send")
      return { status: "PENDING", hash: tx.hash().toString("hex") }
    }),
    getTransaction: vi.fn(async () => {
      const status = statuses.length > 1 ? statuses.shift()! : statuses[0]
      return { status, ledger: 4242 }
    }),
  }

  const sign = opts.sign ?? signer()
  const deps: ContractWriteDeps = {
    config: TESTNET,
    server: server as never,
    getWalletState: vi.fn(async () => {
      events.push("walletState")
      return wallets.length > 1 ? wallets.shift()! : wallets[0]
    }),
    confirmIntent: vi.fn(async () => {
      events.push("confirm")
      return opts.confirm ?? true
    }),
    signTransaction: vi.fn(async (xdr, o) => {
      events.push("sign")
      return sign(xdr, o)
    }),
    sleep: async () => {},
    maxPollAttempts: 5,
  }
  return { deps, server, events }
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ name: "WalletWriteError", code })
}

describe("guarded contract write — success", () => {
  it("shows the intent before signing and confirms on-chain before reporting success", async () => {
    const { deps, events, server } = setup()
    const result = await executeContractWrite(request(), deps)

    expect(events).toEqual(["walletState", "getAccount", "prepare", "confirm", "sign", "walletState", "send"])
    expect(server.getTransaction).toHaveBeenCalledTimes(2)
    expect(result.ledger).toBe(4242)
    expect(result.hash).toMatch(/^[0-9a-f]{64}$/)

    const intent = (deps.confirmIntent as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(intent).toMatchObject({
      operation: "mint",
      cooperative: COOP,
      amountKwh: 12.5,
      contractId: CONTRACT,
      method: "mint_energy",
      signer: admin.publicKey(),
      recipient: member,
      network: "TESTNET",
      networkUnverified: false,
    })
  })

  it("passes the configured passphrase and signer to the wallet", async () => {
    const { deps } = setup()
    await executeContractWrite(request(), deps)
    expect(deps.signTransaction).toHaveBeenCalledWith(expect.any(String), {
      networkPassphrase: NETWORK_PASSPHRASES.TESTNET,
      address: admin.publicKey(),
    })
  })
})

describe("guarded contract write — wrong network", () => {
  it("refuses before building when the wallet reports another network", async () => {
    const { deps, events } = setup({
      wallet: { address: admin.publicKey(), network: "PUBLIC", passphrase: NETWORK_PASSPHRASES.PUBLIC },
    })
    await expectCode(executeContractWrite(request(), deps), "wrong_network")
    expect(events).toEqual(["walletState"])
  })

  it("rejects a signature made for another network when the wallet does not report one", async () => {
    const { deps, events } = setup({
      wallet: { address: admin.publicKey(), network: null, passphrase: null },
      sign: signer(admin, NETWORK_PASSPHRASES.PUBLIC),
    })
    await expectCode(executeContractWrite(request(), deps), "wrong_network")
    expect(events).not.toContain("send")
    const intent = (deps.confirmIntent as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(intent.networkUnverified).toBe(true)
  })

  it("aborts if the wallet switched network during signing", async () => {
    const { deps, events } = setup({
      wallet: [
        { address: admin.publicKey(), network: "TESTNET", passphrase: NETWORK_PASSPHRASES.TESTNET },
        { address: admin.publicKey(), network: "PUBLIC", passphrase: NETWORK_PASSPHRASES.PUBLIC },
      ],
    })
    await expectCode(executeContractWrite(request(), deps), "network_changed")
    expect(events).not.toContain("send")
  })

  it("refuses when the app's own network configuration is invalid", async () => {
    const { deps, events } = setup()
    deps.config = resolveNetworkConfig({ network: "PUBLIC", horizonUrl: "https://horizon-testnet.stellar.org" })
    await expectCode(executeContractWrite(request(), deps), "config_invalid")
    expect(events).toEqual(["walletState"])
  })
})

describe("guarded contract write — rejected or cancelled", () => {
  it("does not request a signature when the user cancels the review", async () => {
    const { deps, events } = setup({ confirm: false })
    await expectCode(executeContractWrite(request(), deps), "user_cancelled")
    expect(events).not.toContain("sign")
  })

  it("reports a rejected signature without submitting", async () => {
    const { deps, events } = setup({
      sign: async () => {
        throw new Error("User declined access")
      },
    })
    await expectCode(executeContractWrite(request(), deps), "signature_rejected")
    expect(events).not.toContain("send")
  })
})

describe("guarded contract write — changed account", () => {
  it("aborts when the wallet account changed while the signature was pending", async () => {
    const { deps, events } = setup({
      wallet: [
        { address: admin.publicKey(), network: "TESTNET" },
        { address: other.publicKey(), network: "TESTNET" },
      ],
    })
    await expectCode(executeContractWrite(request(), deps), "account_changed")
    expect(events).not.toContain("send")
  })

  it("aborts when the wallet signed with a different account", async () => {
    const { deps, events } = setup({ sign: signer(other) })
    await expectCode(executeContractWrite(request(), deps), "account_changed")
    expect(events).not.toContain("send")
  })

  it("rejects a transaction modified by the wallet", async () => {
    const tamper: SignFn = async (xdr) => {
      const original = StellarSdk.TransactionBuilder.fromXDR(xdr, NETWORK_PASSPHRASES.TESTNET) as StellarSdk.Transaction
      const altered = StellarSdk.TransactionBuilder.cloneFrom(original, { fee: "999999" }).build()
      altered.sign(admin)
      return { signedTxXdr: altered.toXDR() }
    }
    const { deps, events } = setup({ sign: tamper })
    await expectCode(executeContractWrite(request(), deps), "tx_tampered")
    expect(events).not.toContain("send")
  })
})

describe("guarded contract write — confirmation", () => {
  it("does not report success for a failed transaction", async () => {
    const { deps } = setup({ txStatuses: ["FAILED"] })
    await expectCode(executeContractWrite(request(), deps), "tx_failed")
  })

  it("times out with the hash instead of polling forever", async () => {
    const { deps } = setup({ txStatuses: ["NOT_FOUND"] })
    const err = await executeContractWrite(request(), deps).catch((e) => e)
    expect(err).toBeInstanceOf(WalletWriteError)
    expect(err.code).toBe("confirmation_timeout")
    expect(err.txHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it("reports a submission rejected by RPC", async () => {
    const { deps, server } = setup()
    server.sendTransaction.mockResolvedValueOnce({ status: "ERROR", hash: "h" })
    await expectCode(executeContractWrite(request(), deps), "submit_failed")
  })
})

describe("preflight", () => {
  const wallet = { address: admin.publicKey(), network: "TESTNET" }

  it.each([
    ["missing cooperative", { cooperative: null }, "invalid_intent"],
    ["zero amount", { amountKwh: 0 }, "invalid_intent"],
    ["NaN amount", { amountKwh: Number.NaN }, "invalid_intent"],
    ["unconfigured contract", { contractId: "" }, "contract_not_configured"],
  ])("rejects %s", (_label, overrides, code) => {
    expect(() => preflight(TESTNET, wallet, request(overrides as Partial<ContractWriteRequest>))).toThrow(
      expect.objectContaining({ code })
    )
  })

  it("requires a connected wallet", () => {
    expect(() => preflight(TESTNET, { address: null }, request())).toThrow(expect.objectContaining({ code: "no_wallet" }))
  })
})

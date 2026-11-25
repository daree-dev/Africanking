import { describe, it, expect, vi, beforeEach } from "vitest"
import { Account, Keypair, nativeToScVal } from "@stellar/stellar-sdk"
import {
  createTransactionService,
  StellarTransactionError,
  httpStatusForTxError,
  type RpcClient,
} from "@/server/stellar/transaction-service"

const CONTRACT_ID = "CCYOVOFDJ5BVBSI6HADLWETTUF3BU423MEAWBSBWV2X5UVNKSJMRPBA6"
const signer = Keypair.random()

function makeServer(overrides: Partial<Record<keyof RpcClient, ReturnType<typeof vi.fn>>> = {}) {
  return {
    getAccount: vi.fn(async (addr: string) => new Account(addr, "100")),
    simulateTransaction: vi.fn(async () => ({ latestLedger: 1 })),
    sendTransaction: vi.fn(async () => ({ status: "PENDING", hash: "ignored" })),
    getTransaction: vi.fn(async () => ({ status: "SUCCESS", ledger: 42 })),
    ...overrides,
  }
}

function makeService(server: ReturnType<typeof makeServer>, extra: Record<string, unknown> = {}) {
  return createTransactionService({
    server: server as unknown as RpcClient,
    networkPassphrase: "Test SDF Network ; September 2015",
    sleep: async () => {},
    assemble: (tx) => tx,
    maxPollAttempts: 5,
    ...extra,
  })
}

function invoke(service: ReturnType<typeof makeService>, onSubmitted = vi.fn()) {
  return service.invokeContract({
    signer,
    contractId: CONTRACT_ID,
    method: "mint_energy",
    args: [nativeToScVal(signer.publicKey(), { type: "address" }), nativeToScVal(BigInt(10), { type: "i128" })],
    onSubmitted,
  })
}

async function expectTxError(p: Promise<unknown>): Promise<StellarTransactionError> {
  try {
    await p
  } catch (err) {
    expect(err).toBeInstanceOf(StellarTransactionError)
    return err as StellarTransactionError
  }
  throw new Error("expected StellarTransactionError")
}

describe("transaction service", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  it("pending confirmation: polls NOT_FOUND until SUCCESS and preserves the hash", async () => {
    const server = makeServer({
      getTransaction: vi
        .fn()
        .mockResolvedValueOnce({ status: "NOT_FOUND" })
        .mockResolvedValueOnce({ status: "NOT_FOUND" })
        .mockResolvedValueOnce({ status: "SUCCESS", ledger: 77 }),
    })
    const onSubmitted = vi.fn()
    const result = await invoke(makeService(server), onSubmitted)

    expect(result.status).toBe("SUCCESS")
    expect(result.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(result.ledger).toBe(77)
    expect(result.pollAttempts).toBe(3)
    expect(onSubmitted).toHaveBeenCalledExactlyOnceWith(result.hash)
    expect(server.getTransaction).toHaveBeenCalledWith(result.hash)
  })

  it("simulation error: no submission, non-retryable SIMULATION_FAILED with reason", async () => {
    const server = makeServer({
      simulateTransaction: vi.fn(async () => ({ error: "HostError: Error(Contract, #1)", latestLedger: 1 })),
    })
    const onSubmitted = vi.fn()
    const err = await expectTxError(invoke(makeService(server), onSubmitted))

    expect(err.code).toBe("SIMULATION_FAILED")
    expect(err.submitted).toBe(false)
    expect(err.details?.simulation_error).toMatch(/HostError/)
    expect(server.sendTransaction).not.toHaveBeenCalled()
    expect(onSubmitted).not.toHaveBeenCalled()
    expect(httpStatusForTxError(err)).toBe(422)
  })

  it("RPC timeout: bounded polling ends in TIMEOUT with the hash kept for reconciliation", async () => {
    const server = makeServer({ getTransaction: vi.fn(async () => ({ status: "NOT_FOUND" })) })
    const onSubmitted = vi.fn()
    const err = await expectTxError(invoke(makeService(server, { maxPollAttempts: 4 }), onSubmitted))

    expect(err.code).toBe("TIMEOUT")
    expect(err.submitted).toBe(true)
    expect(err.retryable).toBe(false)
    expect(err.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(onSubmitted).toHaveBeenCalledWith(err.hash)
    expect(server.getTransaction).toHaveBeenCalledTimes(4)
    expect(err.toFailureReason()).toMatchObject({ code: "TIMEOUT", tx_hash: err.hash, submitted: true })
    expect(httpStatusForTxError(err)).toBe(504)
  })

  it("RPC unavailable before submission: RPC_UNAVAILABLE, retryable, nothing submitted", async () => {
    const server = makeServer({ getAccount: vi.fn(async () => Promise.reject(new Error("ECONNRESET"))) })
    const err = await expectTxError(invoke(makeService(server)))

    expect(err.code).toBe("RPC_UNAVAILABLE")
    expect(err.retryable).toBe(true)
    expect(err.submitted).toBe(false)
    expect(server.getAccount).toHaveBeenCalledTimes(2)
  })

  it("transient polling errors are retried within the bound", async () => {
    const server = makeServer({
      getTransaction: vi
        .fn()
        .mockRejectedValueOnce(new Error("socket hang up"))
        .mockResolvedValueOnce({ status: "SUCCESS", ledger: 5 }),
    })
    const result = await invoke(makeService(server))
    expect(result.status).toBe("SUCCESS")
  })

  it("duplicate submission: DUPLICATE status is treated as in-flight and confirmed by hash", async () => {
    const server = makeServer({ sendTransaction: vi.fn(async () => ({ status: "DUPLICATE" })) })
    const result = await invoke(makeService(server))
    expect(result.status).toBe("SUCCESS")
    expect(server.sendTransaction).toHaveBeenCalledTimes(1)
  })

  it("ambiguous send failure re-submits the same envelope, then resolves by hash", async () => {
    const sent: string[] = []
    const server = makeServer({
      sendTransaction: vi
        .fn()
        .mockImplementationOnce(async (tx: { hash: () => Buffer }) => {
          sent.push(tx.hash().toString("hex"))
          throw new Error("ETIMEDOUT")
        })
        .mockImplementationOnce(async (tx: { hash: () => Buffer }) => {
          sent.push(tx.hash().toString("hex"))
          return { status: "DUPLICATE" }
        }),
    })
    const onSubmitted = vi.fn()
    const result = await invoke(makeService(server), onSubmitted)

    expect(result.status).toBe("SUCCESS")
    expect(sent).toHaveLength(2)
    expect(sent[0]).toBe(sent[1]) // same signed envelope, never a rebuilt transaction
    expect(sent[0]).toBe(result.hash)
    expect(server.getAccount).toHaveBeenCalledTimes(1)
    expect(onSubmitted).toHaveBeenCalledTimes(1)
  })

  it("ERROR after an ambiguous attempt resolves by hash instead of reporting rejection", async () => {
    const server = makeServer({
      sendTransaction: vi
        .fn()
        .mockRejectedValueOnce(new Error("ETIMEDOUT"))
        .mockResolvedValueOnce({ status: "ERROR" }),
      getTransaction: vi.fn(async () => ({ status: "SUCCESS", ledger: 9 })),
    })
    const result = await invoke(makeService(server))
    expect(result.ledger).toBe(9)
  })

  it("submission rejected: SUBMISSION_REJECTED with decoded result code, not submitted", async () => {
    const server = makeServer({
      sendTransaction: vi.fn(async () => ({
        status: "ERROR",
        errorResult: { result: () => ({ switch: () => ({ name: "txBadSeq" }) }) },
      })),
    })
    const onSubmitted = vi.fn()
    const err = await expectTxError(invoke(makeService(server), onSubmitted))

    expect(err.code).toBe("SUBMISSION_REJECTED")
    expect(err.submitted).toBe(false)
    expect(err.details?.result_code).toBe("txBadSeq")
    expect(onSubmitted).not.toHaveBeenCalled()
    expect(server.getTransaction).not.toHaveBeenCalled()
  })

  it("TRY_AGAIN_LATER is retried with the same envelope, then surfaces as retryable", async () => {
    const server = makeServer({ sendTransaction: vi.fn(async () => ({ status: "TRY_AGAIN_LATER" })) })
    const err = await expectTxError(invoke(makeService(server, { submitAttempts: 3 })))

    expect(err.code).toBe("TRY_AGAIN_LATER")
    expect(err.retryable).toBe(true)
    expect(server.sendTransaction).toHaveBeenCalledTimes(3)
  })

  it("terminal failure: FAILED with result code and ledger, hash preserved", async () => {
    const server = makeServer({
      getTransaction: vi.fn(async () => ({
        status: "FAILED",
        ledger: 88,
        resultXdr: { result: () => ({ switch: () => ({ name: "txFailed" }) }) },
      })),
    })
    const err = await expectTxError(invoke(makeService(server)))

    expect(err.code).toBe("FAILED")
    expect(err.submitted).toBe(true)
    expect(err.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(err.details).toMatchObject({ result_code: "txFailed", ledger: 88 })
    expect(httpStatusForTxError(err)).toBe(502)
  })

  it("unknown transaction status is surfaced explicitly", async () => {
    const server = makeServer({ getTransaction: vi.fn(async () => ({ status: "SOMETHING_NEW" })) })
    const err = await expectTxError(invoke(makeService(server)))
    expect(err.code).toBe("UNKNOWN_STATUS")
    expect(err.details?.status).toBe("SOMETHING_NEW")
  })

  it("builds the transaction for the configured network passphrase", async () => {
    const server = makeServer()
    await invoke(makeService(server))
    const tx = server.simulateTransaction.mock.calls[0][0] as { networkPassphrase: string; timeBounds?: unknown }
    expect(tx.networkPassphrase).toBe("Test SDF Network ; September 2015")
    expect(tx.timeBounds).toBeDefined()
  })
})

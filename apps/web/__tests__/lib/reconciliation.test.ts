import { describe, it, expect } from "vitest"
import * as StellarSdk from "@stellar/stellar-sdk"
import fixtures from "../fixtures/reconciliation/cases.json"
import { reconcileRecord, kwhToStroops } from "@/lib/reconciliation/rules"
import { decodeMintEvent, fetchTransactionEvidence, assertNetwork } from "@/lib/reconciliation/evidence"
import { runReconciliation } from "@/lib/reconciliation/runner"
import type { MintRecord, TransactionEvidence } from "@/lib/reconciliation/types"

const ev = fixtures.evidence as Record<string, TransactionEvidence>

function cert(overrides: Partial<MintRecord> = {}): MintRecord {
  return {
    kind: "certificate",
    id: "cert-1",
    cooperative_id: "coop-1",
    status: "available",
    tx_hash: ev.confirmed.hash,
    expected_kwh: 12.5,
    expected_contract: fixtures.contract,
    expected_recipient: fixtures.recipient,
    token_amount: 12.5,
    ...overrides,
  }
}

function reading(overrides: Partial<MintRecord> = {}): MintRecord {
  return cert({ kind: "reading", id: "reading-1", status: "minted", token_amount: null, ...overrides })
}

describe("reconcileRecord — confirmed evidence", () => {
  it("treats a completed certificate with matching mint event as consistent", () => {
    const r = reconcileRecord(cert(), ev.confirmed)
    expect(r.verdict).toBe("consistent")
    expect(r.repair).toBeNull()
    expect(r.needs_manual_review).toBe(false)
  })

  it("promotes a pending certificate to available after finality", () => {
    const r = reconcileRecord(cert({ status: "pending", token_amount: null }), ev.confirmed)
    expect(r.verdict).toBe("pending_but_confirmed")
    expect(r.repair).toEqual({
      table: "certificates",
      id: "cert-1",
      expect: { status: "pending", mint_tx_hash: ev.confirmed.hash },
      set: { status: "available", token_amount: 12.5 },
    })
  })

  it("promotes a reading marked failed (e.g. poll timeout) to minted", () => {
    const r = reconcileRecord(reading({ status: "failed" }), ev.confirmed)
    expect(r.verdict).toBe("pending_but_confirmed")
    expect(r.repair?.set).toEqual({ status: "minted" })
    expect(r.repair?.expect).toEqual({ status: "failed", tx_hash: ev.confirmed.hash })
  })

  it("does not require a recipient match when none was recorded", () => {
    const r = reconcileRecord(cert({ expected_recipient: null }), ev.confirmed)
    expect(r.verdict).toBe("consistent")
  })
})

describe("reconcileRecord — failed evidence", () => {
  it("reverts an available certificate whose mint failed", () => {
    const r = reconcileRecord(cert({ tx_hash: ev.failed.hash }), ev.failed)
    expect(r.verdict).toBe("completed_but_failed")
    expect(r.repair?.set).toEqual({ status: "pending", mint_tx_hash: null, token_amount: null })
  })

  it("clears the hash on a pending certificate so it can be retried", () => {
    const r = reconcileRecord(cert({ status: "pending", tx_hash: ev.failed.hash }), ev.failed)
    expect(r.verdict).toBe("pending_but_failed")
    expect(r.repair?.set).toEqual({ mint_tx_hash: null })
  })

  it("never auto-repairs a sold or retired certificate", () => {
    for (const status of ["sold", "retired"]) {
      const r = reconcileRecord(cert({ status, tx_hash: ev.failed.hash }), ev.failed)
      expect(r.verdict).toBe("conflicting_evidence")
      expect(r.repair).toBeNull()
      expect(r.needs_manual_review).toBe(true)
    }
  })

  it("marks a minted reading as failed, keeping the hash", () => {
    const r = reconcileRecord(reading({ tx_hash: ev.failed.hash }), ev.failed)
    expect(r.verdict).toBe("completed_but_failed")
    expect(r.repair?.set).toEqual({ status: "failed" })
  })

  it("accepts an already-failed reading as consistent", () => {
    const r = reconcileRecord(reading({ status: "failed", tx_hash: ev.failed.hash }), ev.failed)
    expect(r.verdict).toBe("consistent")
  })
})

describe("reconcileRecord — missing evidence", () => {
  it("reports NOT_FOUND for manual review without repair", () => {
    const r = reconcileRecord(cert({ tx_hash: ev.missing.hash }), ev.missing)
    expect(r.verdict).toBe("missing_evidence")
    expect(r.repair).toBeNull()
    expect(r.needs_manual_review).toBe(true)
    expect(r.reasons.join(" ")).toMatch(/retains ledgers 900–1200/)
  })

  it("treats evidence from a ledger beyond latest as not final", () => {
    const notFinal = { ...ev.confirmed, ledger: 5000 }
    const r = reconcileRecord(cert({ status: "pending" }), notFinal)
    expect(r.verdict).toBe("missing_evidence")
    expect(r.repair).toBeNull()
  })

  it("flags completed rows with no hash", () => {
    const r = reconcileRecord(cert({ tx_hash: null }), null)
    expect(r.verdict).toBe("completed_without_hash")
    expect(r.needs_manual_review).toBe(true)
  })

  it("ignores pending rows that were never submitted", () => {
    const r = reconcileRecord(cert({ status: "pending", tx_hash: null }), null)
    expect(r.verdict).toBe("not_submitted")
    expect(r.needs_manual_review).toBe(false)
  })
})

describe("reconcileRecord — conflicting evidence", () => {
  it.each([
    ["amount", ev.conflictingAmount, /amount mismatch/],
    ["contract", ev.conflictingContract, /expected contract/],
    ["recipient", ev.conflictingRecipient, /recipient mismatch/],
  ])("reports %s conflict without repair, even for pending rows", (_label, evidence, pattern) => {
    const r = reconcileRecord(cert({ status: "pending", tx_hash: evidence.hash }), evidence)
    expect(r.verdict).toBe("conflicting_evidence")
    expect(r.repair).toBeNull()
    expect(r.needs_manual_review).toBe(true)
    expect(r.reasons.join(" ")).toMatch(pattern)
  })

  it("rejects evidence for a different hash", () => {
    const r = reconcileRecord(cert({ tx_hash: "other" }), ev.confirmed)
    expect(r.verdict).toBe("conflicting_evidence")
  })

  it("converts kWh using the same rounding as the mint route", () => {
    expect(kwhToStroops(12.5)).toBe(BigInt(125000000))
    expect(kwhToStroops(1.3)).toBe(BigInt(13000000))
  })
})

describe("evidence decoding", () => {
  const contractHash = StellarSdk.StrKey.decodeContract(fixtures.contract)

  function makeEvent(topics: StellarSdk.xdr.ScVal[], data: StellarSdk.xdr.ScVal) {
    return new StellarSdk.xdr.ContractEvent({
      ext: new (StellarSdk.xdr.ExtensionPoint as any)(0),
      contractId: contractHash as unknown as StellarSdk.xdr.Hash,
      type: StellarSdk.xdr.ContractEventType.contract(),
      body: new (StellarSdk.xdr.ContractEventBody as any)(
        0,
        new StellarSdk.xdr.ContractEventV0({ topics, data })
      ),
    })
  }

  const mintTopics = [
    StellarSdk.nativeToScVal("mint", { type: "symbol" }),
    StellarSdk.nativeToScVal(fixtures.recipient, { type: "address" }),
  ]

  it("decodes a SEP-41 style mint event", () => {
    const event = makeEvent(mintTopics, StellarSdk.nativeToScVal(BigInt(125000000), { type: "i128" }))
    expect(decodeMintEvent(event)).toEqual({
      contract_id: fixtures.contract,
      to: fixtures.recipient,
      amount: "125000000",
    })
  })

  it("decodes a struct-style mint event", () => {
    const data = StellarSdk.nativeToScVal({ amount: BigInt(125000000) }, { type: { amount: ["symbol", "i128"] } })
    expect(decodeMintEvent(makeEvent(mintTopics, data))?.amount).toBe("125000000")
  })

  it("ignores non-mint events", () => {
    const topics = [StellarSdk.nativeToScVal("transfer", { type: "symbol" }), mintTopics[1]]
    expect(decodeMintEvent(makeEvent(topics, StellarSdk.nativeToScVal(BigInt(1), { type: "i128" })))).toBeNull()
  })

  it("maps RPC NOT_FOUND to missing evidence with retention window", async () => {
    const server = {
      getTransaction: async () => ({ status: "NOT_FOUND", latestLedger: 50, oldestLedger: 10 }),
      getNetwork: async () => ({ passphrase: StellarSdk.Networks.TESTNET }),
    } as never
    const evidence = await fetchTransactionEvidence(server, "abc")
    expect(evidence).toEqual({
      hash: "abc",
      status: "NOT_FOUND",
      ledger: null,
      latest_ledger: 50,
      oldest_ledger: 10,
      mint_events: [],
    })
  })

  it("refuses an RPC endpoint on a different network", async () => {
    const server = { getNetwork: async () => ({ passphrase: StellarSdk.Networks.PUBLIC }) } as never
    await expect(assertNetwork(server, StellarSdk.Networks.TESTNET)).rejects.toThrow(/network mismatch/)
  })
})

// ---------------------------------------------------------------------------
// Runner with an in-memory Supabase double
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>

function fakeSupabase(tables: Record<string, Row[]>, opts: { failAudit?: boolean } = {}) {
  const writes: { op: string; table: string; payload?: Row; filters?: [string, unknown][] }[] = []

  function from(table: string) {
    const filters: [string, unknown][] = []
    let pendingUpdate: Row | null = null

    const builder: Record<string, unknown> = {
      select: () => builder,
      or: () => builder,
      order: () => builder,
      limit: () => builder,
      eq: (col: string, value: unknown) => (filters.push([col, value]), builder),
      is: (col: string, value: unknown) => (filters.push([col, value]), builder),
      update: (payload: Row) => ((pendingUpdate = payload), builder),
      insert: async (payload: Row) => {
        if (table === "audit_log" && opts.failAudit) return { error: { message: "audit down" } }
        writes.push({ op: "insert", table, payload })
        return { error: null }
      },
      then: (resolve: (v: unknown) => unknown) => {
        const rows = tables[table] ?? []
        if (pendingUpdate) {
          const matched = rows.filter((r) => filters.every(([c, v]) => (r[c] ?? null) === v))
          matched.forEach((r) => Object.assign(r, pendingUpdate))
          writes.push({ op: "update", table, payload: pendingUpdate, filters })
          return resolve({ data: matched.map((r) => ({ id: r.id })), error: null })
        }
        return resolve({ data: rows, error: null })
      },
    }
    return builder
  }

  return { client: { from } as never, writes }
}

describe("runReconciliation", () => {
  const evidenceByHash = Object.fromEntries(Object.values(ev).map((e) => [e.hash, e]))
  const fetchEvidence = async (hash: string) => evidenceByHash[hash]

  function tables() {
    return {
      mint_log: [{ tx_hash: ev.confirmed.hash, prosumer_address: fixtures.recipient }],
      certificates: [
        {
          id: "c-pending-confirmed",
          cooperative_id: "coop",
          status: "pending",
          mint_tx_hash: ev.confirmed.hash,
          total_kwh: 12.5,
          token_amount: null,
          cooperatives: { token_contract_address: null },
        },
        {
          id: "c-available-failed",
          cooperative_id: "coop",
          status: "available",
          mint_tx_hash: ev.failed.hash,
          total_kwh: 12.5,
          token_amount: 12.5,
          cooperatives: null,
        },
        {
          id: "c-missing",
          cooperative_id: "coop",
          status: "available",
          mint_tx_hash: ev.missing.hash,
          total_kwh: 12.5,
          token_amount: 12.5,
          cooperatives: null,
        },
      ],
      readings: [] as Row[],
    }
  }

  it("dry-run reports per-operation repairs and writes nothing", async () => {
    const db = tables()
    const { client, writes } = fakeSupabase(db)
    const report = await runReconciliation({ supabase: client, fetchEvidence, defaultContract: fixtures.contract })

    expect(report.mode).toBe("dry-run")
    expect(writes).toEqual([])
    expect(report.operations.map((o) => [o.record.id, o.verdict, o.outcome?.state ?? null])).toEqual([
      ["c-pending-confirmed", "pending_but_confirmed", "dry_run"],
      ["c-available-failed", "completed_but_failed", "dry_run"],
      ["c-missing", "missing_evidence", null],
    ])
    expect(report.summary).toEqual({ pending_but_confirmed: 1, completed_but_failed: 1, missing_evidence: 1 })
    expect(db.certificates[0].status).toBe("pending")
  })

  it("apply writes the audit entry with prior values before each update", async () => {
    const db = tables()
    const { client, writes } = fakeSupabase(db)
    const report = await runReconciliation({
      supabase: client,
      fetchEvidence,
      defaultContract: fixtures.contract,
      apply: true,
      actor: "test",
    })

    expect(report.operations.filter((o) => o.outcome?.state === "applied")).toHaveLength(2)
    expect(writes.map((w) => `${w.op}:${w.table}`)).toEqual([
      "insert:audit_log",
      "update:certificates",
      "insert:audit_log",
      "update:certificates",
    ])
    expect(writes[0].payload).toMatchObject({
      action: "reconcile",
      actor: "test",
      resource_id: "c-pending-confirmed",
      details: {
        before: { status: "pending", mint_tx_hash: ev.confirmed.hash, token_amount: null },
        after: { status: "available", token_amount: 12.5 },
      },
    })
    expect(db.certificates[0]).toMatchObject({ status: "available", token_amount: 12.5 })
    expect(db.certificates[1]).toMatchObject({ status: "pending", mint_tx_hash: null, token_amount: null })
    // Missing evidence row is untouched.
    expect(db.certificates[2]).toMatchObject({ status: "available", mint_tx_hash: ev.missing.hash })
  })

  it("does not repair when the audit log cannot be written", async () => {
    const db = tables()
    const { client, writes } = fakeSupabase(db, { failAudit: true })
    const report = await runReconciliation({
      supabase: client,
      fetchEvidence,
      defaultContract: fixtures.contract,
      apply: true,
    })
    expect(writes.filter((w) => w.op === "update")).toEqual([])
    expect(report.operations[0].outcome).toMatchObject({ state: "error" })
    expect(db.certificates[0].status).toBe("pending")
  })

  it("skips a repair when the row changed since it was read", async () => {
    const db = tables()
    const { client } = fakeSupabase(db)
    const racing = async (hash: string) => {
      // Simulate a concurrent mint completing between read and repair.
      db.certificates[0].status = "available"
      return evidenceByHash[hash]
    }
    const report = await runReconciliation({
      supabase: client,
      fetchEvidence: racing,
      defaultContract: fixtures.contract,
      apply: true,
      kinds: ["certificate"],
    })
    expect(report.operations[0].outcome).toMatchObject({ state: "skipped_stale" })
  })
})

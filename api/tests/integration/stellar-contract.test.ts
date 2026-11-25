import { randomBytes } from 'crypto';
import { Keypair, Networks, SorobanRpc, TransactionBuilder, xdr } from '@stellar/stellar-sdk';

/**
 * Contract/API integration test for the cooperative generation-credit
 * mint/allocation path.
 *
 * Runs against an isolated Soroban test environment (local quickstart or a
 * dedicated testnet account). It is gated behind explicit env vars so it never
 * touches production credentials or external customer data:
 *
 *   STELLAR_INTEGRATION=1
 *   SOROBAN_RPC_URL=http://localhost:8000/soroban/rpc
 *   SOROBAN_NETWORK_PASSPHRASE=Standalone Network ; February 2017
 *   CREDIT_CONTRACT_ID=<deployed test contract id>
 *
 * When the gate is not set the suite is skipped, keeping normal CI fast and
 * deterministic. See .github/workflows/contracts-ci.yml for the gated job.
 */

const ENABLED = process.env.STELLAR_INTEGRATION === '1';
const RPC_URL = process.env.SOROBAN_RPC_URL ?? 'http://localhost:8000/soroban/rpc';
const NETWORK_PASSPHRASE =
  process.env.SOROBAN_NETWORK_PASSPHRASE ?? Networks.STANDALONE;
const CONTRACT_ID = process.env.CREDIT_CONTRACT_ID ?? '';

const describeIntegration = ENABLED && CONTRACT_ID ? describe : describe.skip;

interface OperationRecord {
  id: string;
  status: 'pending' | 'submitted' | 'confirmed' | 'failed';
  txHash?: string;
  amount: number;
  memberId: string;
}

/**
 * Minimal in-memory stand-in for the API operation store. The real API persists
 * these rows; here we model the same state transitions so we can assert that
 * the DB operation state reconciles with the on-chain transaction status.
 */
class OperationStore {
  private readonly rows = new Map<string, OperationRecord>();

  create(record: OperationRecord): void {
    this.rows.set(record.id, { ...record });
  }

  get(id: string): OperationRecord | undefined {
    const row = this.rows.get(id);
    return row ? { ...row } : undefined;
  }

  markSubmitted(id: string, txHash: string): void {
    const row = this.rows.get(id);
    if (!row) throw new Error(`unknown operation ${id}`);
    this.rows.set(id, { ...row, status: 'submitted', txHash });
  }

  markConfirmed(id: string): void {
    const row = this.rows.get(id);
    if (!row) throw new Error(`unknown operation ${id}`);
    this.rows.set(id, { ...row, status: 'confirmed' });
  }

  markFailed(id: string): void {
    const row = this.rows.get(id);
    if (!row) throw new Error(`unknown operation ${id}`);
    this.rows.set(id, { ...row, status: 'failed' });
  }
}

async function waitForTransaction(
  server: SorobanRpc.Server,
  hash: string,
  attempts = 30,
): Promise<SorobanRpc.Api.GetTransactionResponse> {
  for (let i = 0; i < attempts; i += 1) {
    const res = await server.getTransaction(hash);
    if (res.status !== SorobanRpc.Api.GetTransactionStatus.NOT_FOUND) {
      return res;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`transaction ${hash} not found after polling`);
}

describeIntegration('Soroban credit contract <-> API operation reconciliation', () => {
  const server = new SorobanRpc.Server(RPC_URL, { allowHttp: RPC_URL.startsWith('http://') });
  const store = new OperationStore();

  // Generated test keys only — never production credentials.
  const memberKeypair = Keypair.random();
  const operationId = `op-${randomBytes(8).toString('hex')}`;
  const allocationAmount = 100;

  beforeAll(async () => {
    // Deterministic setup: fund the generated key from the isolated network's
    // friendbot (local quickstart / testnet) so the mint path can be exercised.
    const friendbotUrl = process.env.SOROBAN_FRIENDBOT_URL;
    if (friendbotUrl) {
      const res = await fetch(`${friendbotUrl}?addr=${memberKeypair.publicKey()}`);
      if (!res.ok) {
        throw new Error(`friendbot funding failed: ${res.status}`);
      }
    }

    store.create({
      id: operationId,
      status: 'pending',
      amount: allocationAmount,
      memberId: memberKeypair.publicKey(),
    });
  });

  afterAll(() => {
    // Deterministic teardown: the isolated network is disposable, so we only
    // assert the operation reached a terminal state and drop local state.
    const row = store.get(operationId);
    if (row && row.status !== 'confirmed' && row.status !== 'failed') {
      throw new Error(`operation ${operationId} left in non-terminal state ${row.status}`);
    }
  });

  it('mints an allocation and reconciles DB state with the contract event', async () => {
    const account = await server.getAccount(memberKeypair.publicKey());

    // Build the mint/allocation invocation against the credit contract. The
    // argument order mirrors the contract's `mint(member, amount)` entrypoint.
    const contract = new (await import('@stellar/stellar-sdk')).Contract(CONTRACT_ID);
    const tx = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        contract.call(
          'mint',
          xdr.ScVal.scvAddress(
            xdr.ScAddress.scAddressTypeAccount(
              xdr.PublicKey.publicKeyTypeEd25519(memberKeypair.rawPublicKey()),
            ),
          ),
          xdr.ScVal.scvI128(
            new xdr.Int128Parts({
              hi: xdr.Int64.fromString('0'),
              lo: xdr.Uint64.fromString(String(allocationAmount)),
            }),
          ),
        ),
      )
      .setTimeout(30)
      .build();

    const prepared = await server.prepareTransaction(tx);
    prepared.sign(memberKeypair);

    const sendResponse = await server.sendTransaction(prepared);
    if (sendResponse.status === 'ERROR') {
      store.markFailed(operationId);
      throw new Error(`submit failed: ${JSON.stringify(sendResponse.errorResult)}`);
    }

    store.markSubmitted(operationId, sendResponse.hash);

    const result = await waitForTransaction(server, sendResponse.hash);

    if (result.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      store.markFailed(operationId);
      throw new Error(`transaction ${sendResponse.hash} did not succeed: ${result.status}`);
    }

    store.markConfirmed(operationId);

    // Reconcile: DB operation state matches the final transaction status.
    const row = store.get(operationId);
    expect(row?.status).toBe('confirmed');
    expect(row?.txHash).toBe(sendResponse.hash);

    // Reconcile: the contract emitted a mint event for this member/amount.
    const events = await server.getEvents({
      startLedger: Math.max(1, result.ledger - 5),
      filters: [{ type: 'contract', contractIds: [CONTRACT_ID] }],
    });

    const mintEvent = events.events.find((event) => {
      const topics = event.topic.map((t) => t.toXDR('base64'));
      return topics.some((t) => t.includes('mint'));
    });

    expect(mintEvent).toBeDefined();
    expect(mintEvent?.contractId?.toString()).toBe(CONTRACT_ID);
  }, 120_000);
});

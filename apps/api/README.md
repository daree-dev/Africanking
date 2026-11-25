# Africanking API

The API is a standalone Next.js service. Its route handlers and request-ID middleware live here; server utilities remain in `apps/web/lib` and are resolved through the API TypeScript aliases.

## Local development

1. Copy `.env.example` to `.env.local` and provide the required server values.
2. Run `corepack pnpm --filter @be-energy/api dev` to start the API on port 3001.
3. Run `corepack pnpm --filter @be-energy/web dev` for the frontend on port 3000. The frontend proxies `/api/*` to `http://localhost:3001` by default.

To proxy to another API origin, set `API_URL` in the frontend environment. Use the API origin only, without a trailing slash or `/api` path.

## Deployment

Deploy this directory as a separate Next.js project with the API environment variables from `.env.example`. Set `API_URL` in the frontend deployment to the deployed API origin. The browser continues to use same-origin `/api/*` requests through the frontend proxy, including the HTTP-only session cookie.

Run API route tests with `corepack pnpm --filter @be-energy/api test:api`.

## Stellar configuration validation

At startup (`instrumentation.ts`) the API checks the network passphrase, the RPC/Horizon endpoints, the contract IDs and the deployment manifest (`apps/contracts/deployments/<network>.json`) against each other.

- Invalid configuration on `PUBLIC` fails startup. Set `STELLAR_CONFIG_ON_ERROR=read-only` to keep a read-only API running instead.
- On other networks, invalid configuration disables write routes (mint/retire return `503 WRITES_DISABLED`).
- `GET /api/health/config` returns a secret-free summary and a `sha256:` configuration fingerprint. Use it to compare environments after a deploy.

Rollout: set `STELLAR_DEPLOYMENT_MANIFEST` in every API environment **before** deploying this version. Without it, testnet only gets a warning, but `PUBLIC` refuses to start.

## Stellar transaction service

All contract writes (`/api/mint`, `/api/certificates/retire`) go through `server/stellar/transaction-service.ts`. It handles simulation, fee and resource assembly, submission, bounded polling, and error classification in one place.

| Code | HTTP | Meaning | On-chain? |
|---|---|---|---|
| `SIMULATION_FAILED` | 422 | Contract rejected the call in simulation | No |
| `SUBMISSION_REJECTED` | 502 | RPC returned `ERROR` (result code in `details`) | No |
| `TRY_AGAIN_LATER` / `RPC_UNAVAILABLE` | 503 | Retryable, nothing submitted | No |
| `FAILED` | 502 | Included in a ledger but failed | Yes (fee charged) |
| `TIMEOUT` / `UNKNOWN_STATUS` | 504 / 502 | Submitted, outcome unknown. Reconcile by `tx_hash` | Maybe |

Ambiguous network errors during submission re-send the **same signed envelope**, never a rebuilt transaction, so a retry cannot double-mint. Every failure is written to `audit_log` with its structured reason and hash.

Rollout note: legacy readings now keep `status = 'pending'` with `tx_hash` set while an outcome is unknown, and `/api/mint` answers `409 UNRECONCILED_TRANSACTION` until an operator reconciles them. Only non-retryable failures that never reached the ledger still mark a reading `failed`.

## Soroban event index

`server/stellar/event-indexer.ts` ingests contract events into `chain_events`. It covers every cooperative's token and distribution contract, plus the configured global contracts.

- **Durable cursor**: `chain_event_cursors` holds one row per stream. Events are written before the cursor moves, so a crash only replays the last page.
- **Idempotent**: `UNIQUE (network, event_id)`. Replays and overlapping backfills never create duplicates.
- **Gap detection**: if the stored position has fallen out of the RPC retention window, or the RPC rejects the cursor, the missing ledger range goes into `chain_event_gaps` and ingestion resumes from the oldest available ledger. Call `/api/indexer/run?backfill_gaps=true` (using `INDEXER_RPC_URL` pointed at an archive RPC if needed) to re-ingest open gaps. Each backfill is capped at `INDEXER_MAX_BACKFILL_LEDGERS`.
- **Read API**: `GET /api/cooperatives/:id/events?limit=&type=&before=` returns that cooperative's indexed history to its members only, newest first, paginated by `event_id`.

### Rollout

1. Apply `db/migrations/20261121_soroban_event_index.sql`. It is additive only: no existing table or row changes.
2. Set `INDEXER_CRON_SECRET`, and optionally `INDEXER_START_LEDGER` (otherwise the first run backfills at most `INDEXER_MAX_BACKFILL_LEDGERS`).
3. Schedule `GET /api/indexer/run` (for example every minute) with `Authorization: Bearer $INDEXER_CRON_SECRET`.
4. Watch the response's `gapsDetected` field, and the `chain_event_gaps` rows where `resolved_at IS NULL`.

The existing `events` table and activity feed are unchanged. The new index sits alongside them as a replayable read model.

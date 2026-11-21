# Stellar RPC / Horizon resilience

Soroban RPC or Horizon outages must never make the dashboard state that a
generation-credit operation succeeded or failed without on-chain evidence.
Generation credits remain internal cooperative records assigned to members;
nothing here concerns external certificate markets or I-REC/ESG claims.

Implementation: `apps/web/lib/stellar/resilience.ts` (shared by the web hooks
and the API routes), `apps/web/lib/stellar/contract-client.ts`,
`apps/web/hooks/useChainRead.ts`.

## Read / write policy

| Operation | Kind | Cached fallback | During an outage |
| --- | --- | --- | --- |
| `token.balance` | read | yes, ≤ 30 min | show last value, marked **stale**, retry in background |
| `distribution.total_generated` / `member_list` / `member_percent` | read | yes, ≤ 60 min | same as above |
| `horizon.payments` | read | yes, ≤ 30 min | same as above |
| `token.is_minter` | read (authorization) | **never** | fail closed (treated as "not a minter") |
| `token.transfer`, `token.mint_energy`, `token.burn_energy`, `distribution.record_generation` | write | never | before submission → fail closed ("nothing was sent"); after submission → **pending** until the chain returns SUCCESS / FAILED |

Rules:

- An unknown value is rendered as "unavailable", never as a default such as a
  `0.00` balance or an empty transaction list.
- Only transient errors (network failures, timeouts, HTTP 408/425/429/5xx,
  `TRY_AGAIN_LATER`) are retried or allowed to fall back to the cache.
  Definitive answers (e.g. "account not found", a failed simulation) are not.

## Backoff

`withBackoff` uses bounded exponential backoff: `base · 2^(n-1)` capped at
`maxDelay`, with equal jitter (delay ∈ [cap/2, cap]) and a fixed maximum
number of attempts (default 4 attempts, 500 ms base, 8 s cap). Background
refresh in `useChainRead` uses 5 s base, 60 s cap, 5 attempts; after that the
user can retry manually.

## Non-idempotent writes

- Building, simulating and preparing a transaction is idempotent and may be
  retried.
- A transaction is **signed exactly once** per user action. Only that identical
  signed envelope is ever re-sent (`submitSignedTransaction`). Stellar
  de-duplicates by hash and the sequence number can be consumed only once, so
  a resend cannot apply an operation twice.
- Callers never wrap a whole "build + sign + submit" in a retry loop.

Write outcomes:

| Outcome | Evidence | UI / API behaviour |
| --- | --- | --- |
| `confirmed` | `getTransaction` → SUCCESS | success |
| `failed` | `sendTransaction` → ERROR, `getTransaction` → FAILED, RPC refused (`TRY_AGAIN_LATER` exhausted), or time bounds provably expired | failure, safe to retry |
| `pending` | none yet (poll timeout, RPC down after submission, transport error during submission) | "submitted, awaiting confirmation"; hash stored; no resubmission |

### Server mint (`POST /api/mint`)

- RPC down before submission → `503 { submitted: false }`; the certificate or
  reading is **not** modified (previously a reading was marked `failed`).
- Submitted without a verdict → `202 { status: "pending_confirmation", tx_hash }`.
  The hash is persisted (`certificates.mint_tx_hash` / `readings.tx_hash`)
  *before* polling so a retry is blocked with `409`.
- On-chain FAILED → `502`; the guard hash is cleared so the admin can retry.
- `POST /api/mint/reconcile { certificate_id | reading_id }` asks the RPC for
  the verdict and finalizes (SUCCESS), clears (FAILED) or keeps pending
  (NOT_FOUND / outage → `202`).
- `MINT_CONFIRM_TIMEOUT_MS` (default `90000`) bounds how long the request
  waits for confirmation.

### Client writes

`invokeContractWrite` throws:

- `ChainUnavailableError` — nothing submitted.
- `ChainWritePendingError(hash)` — submitted; the hash is stored in the
  `chainPendingWrites` localStorage ledger and shown by
  `PendingChainWritesNotice`, which reconciles every 30 s. Entries leave the
  ledger only on SUCCESS, FAILED or proven expiry.
- `ChainWriteFailedError` — definitive rejection.

## Freshness indicators

`ChainFreshnessIndicator` shows one of: live ("updated N min ago"), stale
("network unavailable — showing saved data from …"), unavailable, plus the
background retry schedule ("retry 2/5 in 12 s") and a manual retry button.
Used on the member dashboard (community stats, Horizon transactions).

## Rollout

- No database migration. Existing columns (`certificates.mint_tx_hash`,
  `readings.tx_hash`) are reused as submission guards.
- Behaviour change for API clients: `/api/mint` can now return `202` and `503`.
  The cooperative dashboard handles both. Readings are no longer marked
  `failed` on outages or unexpected server errors — only on on-chain failure.
- Existing certificates stuck with a `mint_tx_hash` and status `pending` can
  now be resolved with "Check status" (reconcile) instead of manual inspection.
- Client caches live in `localStorage` under `chainCache:*`; clearing site
  data is safe.

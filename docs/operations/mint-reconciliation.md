# Mint reconciliation

`scripts/reconcile-mints.ts` checks every certificate and legacy reading that claims a mint (or holds a submitted transaction hash) against **finalized** transaction evidence from the configured Stellar network, then reports mismatches. It does not issue or certify anything. It only confirms that cooperative generation credits recorded in the database match what the token contract actually minted.

## Running

```bash
# Dry-run (default): read-only, prints one block per operation
pnpm reconcile:mints

# Machine-readable report
pnpm reconcile:mints --json > reconcile-$(date +%F).json

# Limit scope
pnpm reconcile:mints --kind=certificate --limit=100

# Apply the safe repairs listed by the dry-run
pnpm reconcile:mints --apply
```

Environment is read from `apps/api/.env.local`. Set `ENV_FILE` to use a different file. Required variables: `NEXT_PUBLIC_STELLAR_NETWORK`, `NEXT_PUBLIC_STELLAR_RPC_URL`, `NEXT_PUBLIC_ENERGY_TOKEN_CONTRACT`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. The minter secret is **not** needed.

Exit codes: `0` everything consistent, `2` at least one mismatch, `1` aborted (config error, RPC on the wrong network, DB error).

Before reading anything, the tool calls `getNetwork` on the RPC endpoint. It aborts if the passphrase differs from the configured network, so evidence from the wrong network can never drive a repair.

## Evidence and finality

Evidence comes from Soroban RPC `getTransaction`. Stellar has deterministic finality: a `SUCCESS` or `FAILED` result already sits in a closed ledger. Evidence is used only when `ledger <= latestLedger`.

For `SUCCESS`, the token contract's `mint` events are decoded and checked against the row:

| Check | Source of expectation |
| --- | --- |
| Contract | `cooperatives.token_contract_address`, falling back to `NEXT_PUBLIC_ENERGY_TOKEN_CONTRACT` |
| Recipient | `mint_log.prosumer_address` for the hash, falling back to the prosumer address (readings). Skipped when unknown. |
| Amount | `round(kwh × 10^7)` stroops, the same conversion the mint route uses |

`NOT_FOUND` is treated as **ambiguous**. Soroban RPC keeps only a recent window of ledgers (reported as `oldestLedger`–`latestLedger`), so an old transaction may simply have aged out. Rows like this are never repaired automatically.

## Rules

| Verdict | DB state | Evidence | Action |
| --- | --- | --- | --- |
| `consistent` | completed (`available`/`sold`/`retired`, reading `minted`) | SUCCESS, events match | none |
| `pending_but_confirmed` | certificate `pending` / reading `pending`·`failed` | SUCCESS, events match | **repair:** certificate → `available` + `token_amount`; reading → `minted` |
| `completed_but_failed` | certificate `available` / reading `minted` | FAILED | **repair:** certificate → `pending`, clear `mint_tx_hash` and `token_amount`; reading → `failed` (hash kept) |
| `pending_but_failed` | `pending` with hash | FAILED | **repair:** certificate clears `mint_tx_hash` (unblocks retry); reading → `failed` |
| `conflicting_evidence` | any | SUCCESS with wrong contract/amount/recipient, or FAILED on `sold`/`retired` | manual review only |
| `missing_evidence` | any with hash | NOT_FOUND / not final | manual review only |
| `completed_without_hash` | completed | none | manual review only |
| `not_submitted` | `pending`, no hash | none | none |

"Safe derived state" means only the mint lifecycle columns (`status`, `mint_tx_hash`/`tx_hash`, `token_amount`) move, and only to the state the chain proves. Certificates that are `sold` or `retired` carry downstream business meaning and are never changed automatically.

## Audit and concurrency guarantees

For each repair under `--apply`:

1. An `audit_log` row (`action = 'reconcile'`) is written **first**, with `details.before` (the prior values), `details.after`, the verdict and the reasons. If this insert fails, the repair is skipped and reported as `error`.
2. The update is conditioned on the exact `status` and hash that were reconciled. If the row changed in between (for example, a mint route call finished), nothing is written and the operation reports `skipped_stale`.

To roll a repair back, read `details.before` from `audit_log` for the `resource_id` and restore those values.

`mint_log` and `events` are append-only ledgers and are **not** inserted automatically. When a `pending_but_confirmed` certificate is repaired, check whether its `mint_log` row exists and add it by hand if needed.

## Rollout

- No schema migration is required. `audit_log` already exists, and `reconcile` is a new value of the free-text `action` column.
- Run a dry-run in each environment first and archive the `--json` output.
- Resolve every `conflicting_evidence` and `missing_evidence` row manually before considering `--apply` in production.
- The tool reads at most `--limit` rows (default 500) per kind. Re-run until the summary is stable.

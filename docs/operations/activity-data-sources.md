# Activity data sources and network configuration

The activity pages (`/activity`, `/activity/purchases`, `/activity/sales`) and the dashboard's recent-transactions card show data from three sources. Each row is labelled with its source.

| Source | What it describes | Endpoint |
| --- | --- | --- |
| **Payments (Horizon)** | Classic operations: `payment`, `create_account`, path payments, `account_merge`. Soroban `invoke_host_function` rows are excluded because they carry no amount. | `NEXT_PUBLIC_STELLAR_HORIZON_URL` |
| **Contract events (Soroban RPC)** | HDROP token `mint` / `burn` / `transfer` events that touch the account | `NEXT_PUBLIC_STELLAR_RPC_URL`, contract `NEXT_PUBLIC_ENERGY_TOKEN_CONTRACT` |
| **Cooperative records** | Mint/burn rows the API recorded in the `events` table | API |

If a transaction appears both as an on-chain event and as a cooperative record, only the on-chain row is shown.

## Single network configuration

`apps/web/lib/stellar-network.ts` resolves **one** configuration from `NEXT_PUBLIC_STELLAR_NETWORK`, `NEXT_PUBLIC_STELLAR_HORIZON_URL`, `NEXT_PUBLIC_STELLAR_RPC_URL` and the optional `NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE`. It validates them:

- the network must be `TESTNET`, `PUBLIC`, `FUTURENET` or `LOCAL`
- the passphrase, if set, must match that network
- endpoints must use https (`LOCAL` may use http)
- well-known hosts must belong to the configured network (for example, `horizon-testnet` with `PUBLIC` is rejected)

Problems are shown to users on the activity pages. `contracts-config.ts`, the `@be-energy/stellar` wallet kit, explorer links and the web CSP `connect-src` all derive from these same variables.

The activity pages also warn when the connected wallet reports a different network than the app.

## Behaviour

- **Unfunded account** (Horizon 404): shown as "account does not exist on this network yet", not as an error.
- **Outage / rate limit / network error**: shown per source with a retry button. Other sources still render.
- **Event history unsupported**: Soroban RPC keeps only a recent ledger window. If no token contract is configured, the endpoint lacks `getEvents`, or the range is out of retention, the UI says so and falls back to cooperative records.
- **Pagination**: Horizon pages by `paging_token` and RPC pages by event cursor, both through a "Load more" button. Changing account or network discards in-flight responses.

## Rollout notes

- No data migration. The `events` table is still read as before.
- Fixes in this change: testnet explorer links previously pointed at the public explorer, and the wallet kit's passphrase and Horizon host previously ignored the configured network in the browser.
- For mainnet, set all three endpoint variables consistently. The CSP picks up the configured origins at build time.

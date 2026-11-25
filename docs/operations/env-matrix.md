# Environment variable matrix

This matrix covers every variable read by `apps/web` and `apps/api`. Columns:

| Column | Meaning |
|--------|---------|
| **Service** | Which app reads this variable |
| **Required in production** | `yes` = app refuses to start without it; `no` = feature degrades gracefully |
| **Secrecy** | `public` = safe to expose to the browser; `server` = never sent to the client; `secret` = rotate on exposure |
| **Safe default** | What happens when the variable is absent in a non-production environment |

Variables prefixed `NEXT_PUBLIC_` are bundled into the client-side JavaScript by Next.js. Never put secrets in `NEXT_PUBLIC_` variables.

---

## Supabase

| Variable | Service | Required in prod | Secrecy | Safe default |
|----------|---------|-----------------|---------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | web, api | yes | public | App fails to boot — no auth possible |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | web, api | yes | public | App fails to boot — no auth possible |
| `SUPABASE_SERVICE_ROLE_KEY` | api | yes | secret | API server-side auth operations fail |

**Rotation:** if `SUPABASE_SERVICE_ROLE_KEY` is exposed, rotate the key in the Supabase dashboard immediately, update the secret in the deployment environment (Vercel → Settings → Environment Variables), and redeploy. Revoke any active sessions issued with the old key by cycling the JWT secret in Supabase Auth settings.

---

## Application authentication

| Variable | Service | Required in prod | Secrecy | Safe default |
|----------|---------|-----------------|---------|-------------|
| `JWT_SECRET` | api | yes | secret | All issued JWTs are invalid; no user can authenticate |
| `SUPER_ADMIN_ADDRESSES` | api | no | server | No Stellar address has super-admin access; the super-admin panel is inaccessible |
| `NEXT_PUBLIC_APP_URL` | api | yes | public | Defaults to `http://localhost:3000`; OAuth callbacks and CORS will fail in production without the correct value |

**Rotation of `JWT_SECRET`:** rotating invalidates all active sessions. Users will be signed out on their next request. Schedule rotation during low-traffic periods and notify the team in advance. After rotation, redeploy the API service.

---

## Stellar network and contracts

| Variable | Service | Required in prod | Secrecy | Safe default |
|----------|---------|-----------------|---------|-------------|
| `NEXT_PUBLIC_STELLAR_NETWORK` | web, api | yes | public | No default — must be `TESTNET` or `MAINNET` |
| `NEXT_PUBLIC_STELLAR_RPC_URL` | web, api | yes | public | Soroban contract calls fail |
| `NEXT_PUBLIC_STELLAR_HORIZON_URL` | web, api | yes | public | Horizon payment history and account checks fail |
| `NEXT_PUBLIC_ENERGY_TOKEN_CONTRACT` | web, api | yes | public | Token balance and mint operations fail |
| `NEXT_PUBLIC_ENERGY_DISTRIBUTION_CONTRACT` | web, api | yes | public | Member allocation display fails |
| `NEXT_PUBLIC_COMMUNITY_GOVERNANCE_CONTRACT` | web, api | yes | public | Governance panel unavailable; community stats show placeholder |
| `NEXT_PUBLIC_ADMIN_ADDRESS` | web | yes | public | Admin panel access check cannot verify the admin address |
| `MINTER_SECRET_KEY` | api | yes | secret | Certificate minting (token issuance) is disabled |
| `STELLAR_NETWORK` | api | yes | server | Must match `NEXT_PUBLIC_STELLAR_NETWORK`; mismatch causes silent failures on server-side Stellar calls |

**Rotation of `MINTER_SECRET_KEY`:** the minter account is a Stellar keypair. To rotate:
1. Generate a new keypair (`stellar keys generate new-minter`).
2. Fund the new account on Testnet via Friendbot, or on Mainnet via a funded account.
3. Grant the new account the `minter` role on the `energy_token` contract (requires the current admin key).
4. Update `MINTER_SECRET_KEY` in the deployment environment.
5. Redeploy the API service.
6. Revoke the old minter role if the contract supports it, or rotate the admin key as well.

---

## Optional: DFNS wallet provisioning

These variables are only read when `DFNS_AUTH_TOKEN` is set. When absent, wallet provisioning falls back to Freighter/xBull/Lobstr via Stellar Wallets Kit. The feature is inactive and no error is raised when these variables are unset.

| Variable | Service | Required in prod | Secrecy | Safe default |
|----------|---------|-----------------|---------|-------------|
| `DFNS_AUTH_TOKEN` | api | no | secret | DFNS integration disabled |
| `DFNS_PRIVATE_KEY` | api | no | secret | DFNS integration disabled |
| `DFNS_CRED_ID` | api | no | server | DFNS integration disabled |
| `DFNS_BASE_URL` | api | no | server | Defaults to `https://api.dfns.io` |

**Rotation:** if `DFNS_AUTH_TOKEN` or `DFNS_PRIVATE_KEY` is exposed, revoke the credential in the DFNS dashboard, generate a new service credential, and update the deployment environment.

---

## Optional: DeFindex integration

These variables are only read when `DEFINDEX_API_KEY` is set. When absent, DeFindex yield features are hidden in the UI and no error is raised.

| Variable | Service | Required in prod | Secrecy | Safe default |
|----------|---------|-----------------|---------|-------------|
| `DEFINDEX_API_KEY` | api | no | secret | DeFindex integration disabled |
| `DEFINDEX_BASE_URL` | api | no | server | Defaults to `https://api.defindex.io` |

---

## Example files

| File | Purpose |
|------|---------|
| `apps/api/.env.example` | Template for the API service |
| `apps/web/.env.example` | Template for the web frontend |

Copy the relevant example file to `.env.local` before running locally. `.env.local` is gitignored.

---

## Missing required variable behaviour

The API service (`apps/api`) validates required variables at startup. If a required variable is absent, the process logs a clear error and exits rather than starting in a degraded state:

```
[startup] Missing required environment variable: MINTER_SECRET_KEY
[startup] Set this variable and restart the service.
```

This prevents silent failures where the app appears to run but cannot issue certificates or authenticate users.

---

## Rotation incident response

If you suspect a secret has been exposed (leaked in logs, committed to git, shared over an insecure channel):

1. Rotate the secret immediately — do not wait to confirm the exposure.
2. Redeploy all services that used the old secret.
3. Review access logs for the affected service for the period since the last known-good rotation.
4. Record the incident (date, suspected exposure vector, variables rotated, services redeployed) in a private incident log accessible to the core team.
5. If `SUPABASE_SERVICE_ROLE_KEY` or `JWT_SECRET` was exposed, notify users that sessions have been invalidated.

The `.env.example` files in this repository contain no real values — only placeholder comments. Never commit `.env.local` or any file containing real credentials.

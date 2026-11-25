# Local Development Guide

This guide takes you from a clean checkout to a running API, frontend, and contract toolchain. Follow the steps in order.

---

## Prerequisites

| Tool | Minimum version | Install |
|------|----------------|---------|
| Node.js | 20 | https://nodejs.org |
| pnpm | 9.15.0 | `corepack enable && corepack prepare pnpm@9.15.0 --activate` |
| Rust | 1.89.0 | `rustup toolchain install 1.89.0` |
| Rust wasm target | — | `rustup target add wasm32v1-none --toolchain 1.89.0` |
| Stellar CLI | latest | `cargo install stellar-cli --locked` |

> The Rust toolchain version is pinned in `apps/contracts/rust-toolchain.toml`. Running any `cargo` or `stellar` command inside `apps/contracts/` picks it up automatically.

---

## 1. Clone and install

```bash
git clone https://github.com/daree-dev/Africanking.git
cd Africanking
pnpm install
```

`pnpm install` installs all workspaces (`apps/api`, `apps/web`, `packages/stellar`, `tooling/*`) in one pass.

---

## 2. Environment variables

### API (`apps/api/.env.local`)

Copy the template and fill in the required values:

```bash
cp apps/api/.env.example apps/api/.env.local
```

**Required** — the API will not start without these:

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous (public) key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key — server only, never expose to the browser |
| `JWT_SECRET` | Random string used to sign session JWTs, e.g. `openssl rand -hex 32` |

**Optional** — features degrade gracefully if these are absent:

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | Frontend origin used in auth redirects |
| `NEXT_PUBLIC_STELLAR_NETWORK` | `TESTNET` | `TESTNET` or `MAINNET` |
| `NEXT_PUBLIC_STELLAR_RPC_URL` | `https://soroban-testnet.stellar.org` | Soroban RPC endpoint |
| `NEXT_PUBLIC_STELLAR_HORIZON_URL` | `https://horizon-testnet.stellar.org` | Horizon REST endpoint |
| `NEXT_PUBLIC_ENERGY_TOKEN_CONTRACT` | — | Deployed `energy_token` contract address |
| `NEXT_PUBLIC_ENERGY_DISTRIBUTION_CONTRACT` | — | Deployed `energy_distribution` contract address |
| `NEXT_PUBLIC_COMMUNITY_GOVERNANCE_CONTRACT` | — | Deployed `community_governance` contract address |
| `MINTER_SECRET_KEY` | — | Stellar secret key (`S…`) for the server minter account — server only |
| `SUPER_ADMIN_ADDRESSES` | — | Comma-separated Stellar addresses that receive super-admin privileges |
| `DFNS_AUTH_TOKEN` | — | DFNS wallet provisioning token |
| `DFNS_PRIVATE_KEY` | — | DFNS private key — server only |
| `DFNS_CRED_ID` | — | DFNS credential ID |
| `DFNS_BASE_URL` | `https://api.dfns.io` | DFNS API base URL |
| `STELLAR_NETWORK` | `testnet` | Used by DFNS wallet client |
| `DEFINDEX_API_KEY` | — | DeFindex integration key |
| `DEFINDEX_BASE_URL` | `https://api.defindex.io` | DeFindex API base URL |

> Never commit `.env.local`. It is listed in `.gitignore`. All `*_SECRET*`, `*_KEY`, and `*_ROLE*` variables are server-side only — the API process reads them; the browser never receives them.

### Frontend (`apps/web`)

The frontend has no required secrets of its own. By default it proxies `/api/*` to `http://localhost:3001` (the API). To point it elsewhere, add `API_URL=<origin>` to `apps/web/.env.local`. Use the origin only — no trailing slash, no `/api` suffix.

---

## 3. Database setup (Supabase)

Africanking uses Supabase (PostgreSQL). For local development you can either connect to the hosted Testnet project or run Supabase locally.

### Option A — hosted Testnet project (fastest)

1. Ask a maintainer for a `.env.local` with valid Supabase credentials.
2. The schema already exists; skip to step 4.

### Option B — local Supabase

```bash
# Install Supabase CLI
brew install supabase/tap/supabase   # macOS
# or: https://supabase.com/docs/guides/cli/getting-started

supabase init          # from repo root (creates supabase/ if absent)
supabase start         # starts Postgres, Auth, Storage locally
```

The local URLs and keys are printed by `supabase start`. Copy them into `apps/api/.env.local`.

#### Safe test data

After the schema is applied, seed some cooperative and member rows so the dashboard is not empty:

```bash
# Example — adapt addresses to your local wallet or use the demo address
curl -s -X POST http://localhost:3001/api/cooperatives \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Coop","technology":"solar","admin_stellar_address":"GDEMO..."}'
```

Do not seed production-looking data or real meter readings into a shared Testnet project without approval.

---

## 4. Start the API and frontend

Run both services together from the repo root:

```bash
pnpm dev
```

Turborepo starts both workspaces in parallel:

| Service | URL |
|---------|-----|
| Frontend (Next.js) | http://localhost:3000 |
| API (Next.js) | http://localhost:3001 |

The frontend proxies all `/api/*` requests to the API, so the browser only ever talks to port 3000. This matches production behavior.

To run a service individually:

```bash
pnpm --filter @be-energy/api dev    # API only  → http://localhost:3001
pnpm --filter @be-energy/web dev    # Web only  → http://localhost:3000
```

---

## 5. Smart contracts (Rust / Soroban)

### Build

```bash
cd apps/contracts
stellar contract build
```

This compiles all four contracts (`energy_token`, `energy_distribution`, `community_governance`, `cooperative_factory`) to `target/wasm32v1-none/release/*.wasm`.

### Test

```bash
cd apps/contracts
cargo test
```

### Deploy to Testnet (optional)

```bash
stellar contract deploy \
  --wasm target/wasm32v1-none/release/energy_token.wasm \
  --network testnet \
  --source <your-secret-key>
```

Copy the returned contract address into `NEXT_PUBLIC_ENERGY_TOKEN_CONTRACT` in `apps/api/.env.local`.

---

## 6. Troubleshooting

### Database

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `Error: JWT expired` on API startup | `JWT_SECRET` missing or wrong | Set `JWT_SECRET` in `apps/api/.env.local` |
| `relation "cooperatives" does not exist` | Schema not applied | Run migrations or connect to the right project |
| `Invalid API key` from Supabase | Wrong `ANON_KEY` or `SERVICE_ROLE_KEY` | Copy the keys from your Supabase project settings |
| `connection refused` on port 5432 | Local Supabase not running | Run `supabase start` |

### Wallet / Stellar

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Wallet challenge returns 500 | `JWT_SECRET` not set | Add it to `apps/api/.env.local` |
| Mint fails with `account not found` | Minter account not funded | Fund `MINTER_SECRET_KEY`'s public address on Testnet via https://laboratory.stellar.org/#account-creator |
| Freighter shows wrong network | Freighter set to Mainnet | Switch Freighter to Testnet in its extension settings |
| `Invalid Stellar address` validation error | Address does not start with `G` or is not 56 chars | Generate a valid keypair with `stellar keys generate` |

### Rust / contract toolchain

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `error[E0463]: can't find crate for std` | Wrong Rust target | `rustup target add wasm32v1-none --toolchain 1.89.0` |
| `toolchain '1.89.0' is not installed` | Rust version missing | `rustup toolchain install 1.89.0` |
| `stellar: command not found` | Stellar CLI not on PATH | `cargo install stellar-cli --locked` then restart your shell |
| Linking errors on macOS | Missing Xcode tools | `xcode-select --install` |
| `could not find Cargo.toml` | Running from wrong directory | `cd apps/contracts` before any `cargo` or `stellar` command |

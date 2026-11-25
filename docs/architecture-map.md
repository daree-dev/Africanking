# Architecture and Responsibility Map

> Cross-checked against source manifests and route directories. Last updated: 2026-10.
>
> **Status labels used throughout this document:**
> - ✅ **Deployed** — running in production on Stellar Testnet / Vercel
> - 🔧 **Implemented, not deployed** — code exists, not wired to production traffic or not deployed on-chain
> - 🗓 **Planned** — referenced in roadmap, no implementation yet

---

## 1. Service boundaries

| Service | Package name | Runtime port | Deployment | Description |
|---|---|---|---|---|
| **Web dashboard** | `@be-energy/web` | 3000 (dev) | ✅ Vercel (`apps/web/.next`) | Next.js 16 frontend. Serves all dashboard pages. Proxies `/api/*` to the API service in development; in production, Vercel routes `/api/*` to the API deployment. |
| **API service** | `@be-energy/api` | 3001 (dev) | ✅ Vercel (`apps/api`) | Standalone Next.js 16 API service. Owns all business logic, database writes, and on-chain transaction signing. The web app never writes to Supabase directly. |
| **Shared Stellar package** | `@be-energy/stellar` | — | npm workspace (not deployed) | Wallet connection, Stellar network config, localStorage helpers. Imported by both `web` and `api`. |
| **Soroban contracts** | `apps/contracts` | — | ✅ Stellar Testnet | Three contracts deployed; one implemented but not deployed. |

### Request flow

```
Browser
  │
  ├─ Page requests → @be-energy/web (Vercel, port 3000)
  │    Next.js App Router pages, React components
  │
  └─ /api/* requests → @be-energy/api (Vercel, port 3001)
       │
       ├─ Auth middleware (JWT validation)
       ├─ Supabase (postgres) ← reads/writes
       └─ Soroban RPC → Stellar Testnet (on-chain txs)
```

The web app has no direct database connection. All data operations go through the API service.

---

## 2. Active API routes

All routes live in `apps/api/app/api/`.

### Auth — `auth/`

| Route | Methods | Auth required | Description |
|---|---|---|---|
| `/api/auth/challenge` | POST | — | Issues a Stellar wallet challenge for signature auth |
| `/api/auth/verify` | POST | — | Verifies wallet signature, issues JWT |
| `/api/auth/email/send` | POST | — | Sends magic-link / OTP email |
| `/api/auth/email/verify` | POST | — | Verifies OTP, issues JWT |
| `/api/auth/me` | GET | ✅ | Returns current session user |
| `/api/auth/refresh` | POST | ✅ | Refreshes JWT |
| `/api/auth/logout` | POST | ✅ | Invalidates session |

### Cooperatives — `cooperatives/`

| Route | Methods | Auth required | Description |
|---|---|---|---|
| `/api/cooperatives` | GET, POST | GET: public · POST: admin | List cooperatives; create cooperative |
| `/api/cooperatives/[id]` | GET, PATCH, DELETE | admin | Get/update/delete a single cooperative |
| `/api/cooperatives/[id]/readings` | GET | member | Readings scoped to a cooperative |

### Members — `members/`

| Route | Methods | Auth required | Description |
|---|---|---|---|
| `/api/members` | GET, POST | ✅ | List members (scoped to caller's cooperative); add member |

### Meters — `meters/`

| Route | Methods | Auth required | Description |
|---|---|---|---|
| `/api/meters` | GET, POST | ✅ | List/register meters |
| `/api/meters/readings` | POST | ✅ | Bulk ingest from smart meters (15-min cadence) |

### Readings — `readings/`

| Route | Methods | Auth required | Description |
|---|---|---|---|
| `/api/readings` | GET, POST | ✅ | Individual reading (get or submit) |

### Generation credits — `certificates/`

> These routes are named "certificates" in the codebase. They manage **generation credits** — internal cooperative records. They do not issue I-REC or ESG certificates. See `docs/domain-model.md`.

| Route | Methods | Auth required | Description |
|---|---|---|---|
| `/api/certificates` | GET, POST | GET: public · POST: admin | List/create generation credit records |
| `/api/certificates/[id]` | GET | public | Credit detail with on-chain provenance link |
| `/api/certificates/retire` | POST | admin | Retire a credit (on-chain burn via `burn_energy`) |
| `/api/certificates/stats` | GET | public | Aggregate generation statistics |

### Minting — `mint/`

| Route | Methods | Auth required | Description |
|---|---|---|---|
| `/api/mint` | POST | admin | Mint generation credit on-chain. Calls `energy_distribution.record_generation`. Use the contract hook directly where possible. |

### Profile — `profile/`

| Route | Methods | Auth required | Description |
|---|---|---|---|
| `/api/profile` | GET, PATCH | ✅ | Caller's profile data |

### Admin — `admin/`

| Route | Methods | Auth required | Description |
|---|---|---|---|
| `/api/admin/stats` | GET | super-admin | Platform-wide statistics |

### Legacy — `prosumers/`

| Route | Methods | Auth required | Description |
|---|---|---|---|
| `/api/prosumers` | GET, POST | ✅ | **Deprecated** — proxies to `/api/members`. Sunset: 2026-11-30. Use `/api/members` instead. |

### Health

| Route | Methods | Auth required | Description |
|---|---|---|---|
| `/api/health` | GET | — | Liveness check + build identifier. See `docs/releases/build-provenance.md`. |

### DeFindex integration — `defindex/`

| Route | Methods | Auth required | Description |
|---|---|---|---|
| `/api/defindex/health` | GET | — | DeFindex vault availability check |
| `/api/defindex/vault/[address]` | GET | — | Vault metadata |
| `/api/defindex/deposit` | POST | ✅ | Deposit into DeFindex vault |
| `/api/defindex/withdraw` | POST | ✅ | Withdraw from DeFindex vault |
| `/api/defindex/stats/[vaultAddress]/[userAddress]` | GET | ✅ | Vault stats for a user |

---

## 3. Web app pages

All pages live in `apps/web/app/`.

| Path | Status | Description |
|---|---|---|
| `/` | ✅ | Landing page |
| `/login` | ✅ | Email + wallet login |
| `/dashboard` | ✅ | Member dashboard (generation balance, credit history) |
| `/dashboard/cooperative` | ✅ | Cooperative admin view (meters, readings, members) |
| `/dashboard/cooperative/members` | ✅ | Member management |
| `/dashboard/admin` | ✅ | Super-admin view |
| `/admin` | ✅ | Additional admin panel |
| `/certificates` | ✅ | Generation credit list |
| `/certificates/[id]` | ✅ | Credit detail with Stellar Explorer link |
| `/profile` | ✅ | User profile |
| `/consumption` | 🔧 | Consumption tracking (implemented, usage TBD) |
| `/activity` | 🔧 | Activity feed |
| `/activity/sales` | 🔧 | Sales activity (terminology from pre-pivot; needs review) |
| `/activity/purchases` | 🔧 | Purchase activity (terminology from pre-pivot; needs review) |
| `/auth/callback` | ✅ | Auth redirect handler |
| `/auth/callback/password` | ✅ | Password reset handler |

---

## 4. Shared package — `@be-energy/stellar`

Located at `packages/stellar/`. Consumed by both `apps/api` and `apps/web`.

| Module | Description |
|---|---|
| `stellar-config.ts` | Stellar network constants: RPC URL, Horizon URL, network passphrase, contract addresses |
| `wallet.ts` | Freighter wallet connection, balance queries (SEP-43) |
| `storage.ts` | Typed localStorage helpers for wallet connection state |

**Ownership:** shared. Changes here affect both API and web. Add to this package only what genuinely belongs to both sides.

---

## 5. Smart contracts

Located at `apps/contracts/`. All written in Rust with Soroban SDK 23.1.0 and OpenZeppelin Stellar v0.5.1.

| Contract | Status | Address (Testnet) | Tests | Description |
|---|---|---|---|---|
| `energy_token` | ✅ Deployed | `CCYOVOFDJ5BVBSI6HADLWETTUF3BU423MEAWBSBWV2X5UVNKSJMRPBA6` | 36 | SEP-41 fungible token. 1 token = 1 kWh generation credit. Each cooperative gets its own instance. Includes Pausable and Upgradeable. |
| `energy_distribution` | ✅ Deployed | `CBTDPLFNFGWVOD4HXDKW4EH5L3D2YGOY5CWTFCJM5TEWFL4VQTNX2UDZ` | 18 | Distributes tokens proportionally to members by participation %. Calls `mint_energy` on `energy_token`. |
| `community_governance` | ✅ Deployed | `CCH2EXXNSDW2BAKBIPFAG6CCZS6LV4VJFUP2CZZCW5LEY4JOAXBJD6YI` | 11 | Proposal skeleton. On-chain governance WIP — proposal creation works, voting not implemented. |
| `cooperative_factory` | 🔧 Implemented, not deployed | — | 19 | Deploys per-cooperative token+distribution pair. Implemented and tested; not integrated into the frontend or deployed to Testnet. |

**Contract dependency direction:**

```
energy_distribution  →  energy_token  (calls mint_energy, holds MINTER role)
community_governance  (independent)
cooperative_factory  →  energy_token + energy_distribution  (deploys both)
```

---

## 6. Data stores

| Store | Owner | Access | Tables / collections |
|---|---|---|---|
| **Supabase (PostgreSQL)** | `@be-energy/api` | API service only (service role key). Web never writes directly. | `cooperatives`, `members` (also `prosumers` as legacy alias), `meters`, `readings`, `certificates`, `retirements`, `users`, `sessions` |
| **Stellar Testnet** | Contracts (immutable once deployed) | Public read via Horizon/RPC. Writes require MINTER key (API server) or user wallet (transfers, burns). | `energy_token` ledger entries, `energy_distribution` state, `community_governance` state |

---

## 7. Dependency direction

```
apps/web
  └── @be-energy/stellar  (wallet, config)
  └── calls apps/api over HTTP (/api/*)

apps/api
  └── @be-energy/stellar  (config, possibly wallet)
  └── supabase-js  → Supabase
  └── @stellar/stellar-sdk  → Stellar Testnet (Soroban RPC)

apps/contracts  (independent — Rust, not Node)
  └── soroban-sdk
  └── openzeppelin-stellar-contracts
```

No package imports from an `apps/` sibling. The only cross-app communication is HTTP (web → api).

---

## 8. Environment variables

### Public (client-side, `NEXT_PUBLIC_*`)

| Variable | Used by | Description |
|---|---|---|
| `NEXT_PUBLIC_STELLAR_NETWORK` | web, api | `TESTNET` or `PUBLIC` |
| `NEXT_PUBLIC_STELLAR_RPC_URL` | web, api | Soroban RPC endpoint |
| `NEXT_PUBLIC_STELLAR_HORIZON_URL` | web, api | Horizon REST endpoint |
| `NEXT_PUBLIC_ENERGY_TOKEN_CONTRACT` | web, api | `energy_token` address |
| `NEXT_PUBLIC_ENERGY_DISTRIBUTION_CONTRACT` | web, api | `energy_distribution` address |
| `NEXT_PUBLIC_SUPABASE_URL` | web, api | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | web | Supabase anon key (read-only public) |

### Secret (server-side only)

| Variable | Used by | Description |
|---|---|---|
| `MINTER_SECRET_KEY` | api | Stellar keypair for signing mint/burn transactions |
| `SUPABASE_SERVICE_ROLE_KEY` | api | Full database access; never exposed to browser |
| `JWT_SECRET` | api | Signs session JWTs |

---

## 9. Deployment

| | |
|---|---|
| **Platform** | Vercel |
| **Build command** | `pnpm turbo build --filter=@be-energy/web` |
| **API build** | `pnpm turbo build --filter=@be-energy/api` |
| **Output** | `apps/web/.next` (web), `apps/api` (API) |
| **Branch policy** | `develop` → PR → `main` → auto-deploy |
| **Release manifest** | Generated by `pnpm manifest` before build (see `docs/releases/build-provenance.md`) |

---

## 10. What is not in this codebase

These items are referenced elsewhere but are not implemented here:

| Item | Note |
|---|---|
| I-REC / IRAM certification | Separate registry operated by IRAM/Evident. BeEnergy tokens are generation credits, not I-REC certificates. See `docs/domain-model.md`. |
| External buyer / certificate marketplace | Discarded in Pivot #2. No marketplace routes exist. |
| Mainnet deployment | Testnet only. Mainnet requires audited contracts and a migration plan. |
| Real smart meter integration | Testnet uses `scripts/smart-meter-mock.ts`. Mainnet will integrate HES/MDM or inverter APIs (Fronius, Huawei, SMA). |
| DeFindex mainnet | DeFindex integration routes exist (`/api/defindex/*`) but DeFindex is not in production. |
| `cooperative_factory` on-chain | Contract is implemented and tested but not deployed or integrated. |
| Community governance voting | Proposal creation is on-chain; voting logic is not implemented. |

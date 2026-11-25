# Africanking

> **BeEnergy — cooperative generation credit management on Stellar.**

[![Live Demo](https://img.shields.io/badge/🌐_Live_Demo-be--energy--six.vercel.app-00537A?style=for-the-badge)](https://be-energy-six.vercel.app)
[![Network](https://img.shields.io/badge/Stellar-Testnet-FFD500?style=for-the-badge&logo=stellar)](https://stellar.org)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue?style=for-the-badge)](LICENSE)

---

## Recognition

| Award | Event |
|-------|-------|
| 🥇 **Featured Project** | [Stellar Buenos Aires Hackathon 2025](https://dorahacks.io/buidl/36793) |
| 🏅 **Innovation Certificate** | Stellar Jury — Buenos Aires 2025 |
| 🌍 **Selected** | [ClimateLaunchpad 2026](https://climatelaunchpad.org/) — world's largest green startup competition, powered by Climate-KIC & Chrysalis LEAP |

---

## The Problem

Electricity cooperatives in Argentina generate renewable energy and share it among members under Ley 27.424. Splitting that generation fairly and verifiably is still a manual, spreadsheet-driven process:

- No standardized way to record per-member generation credits
- No verifiable, auditable record that members can inspect independently
- Paper-based billing reconciliation that is slow and error-prone
- No digital tooling equivalent to what the Brazilian market already has (Exa Energia, Nex Energy)

BeEnergy closes that gap.

---

## The Solution

BeEnergy is a cooperative management dashboard combined with on-chain generation credit infrastructure on **Stellar**.

Each kWh recorded by a cooperative becomes a **generation credit**: a verifiable, on-chain record tied to a real meter, a real cooperative, and a real time period — assigned proportionally to the cooperative's members.

```
Smart meter sends reading → POST /api/meters/readings
         ↓
BeEnergy validates & mints a generation credit on Stellar (1 token = 1 kWh)
         ↓
Credit is distributed to cooperative members by participation %
         ↓
Each member can verify their balance on-chain
         ↓
Credit backs the member's billing adjustment — auditable, immutable
```

The credit stays inside the cooperative. It is a record of generation and allocation, not a product sold to an external buyer.

> **What BeEnergy records are not:** A BeEnergy token is not an I-REC, not an ESG certificate, and not a Scope 2 claim. I-REC certificates in Argentina are issued by IRAM and registered in Evident — a separate system. See `docs/domain-model.md`.

---

## How It Works

### For Cooperatives

```
1. Register the cooperative on BeEnergy
2. Add smart meters (or use the testnet meter simulator)
3. Meters send generation readings automatically via API
4. BeEnergy records generation credits on Stellar and distributes them to members
5. Manage members, view generation stats, track credit history
```

### Authentication

BeEnergy supports two access methods:

**Email + OTP** (for cooperative admins and members)
```
/login → OTP sent → verified → JWT issued → /dashboard
```
> Demo: `demo@beenergy.coop` / `Demo2026!`

**Stellar Wallet** (for members with Freighter / xBull / Lobstr)
```
Connect wallet → Server issues challenge → User signs with private key
→ Signature verified on-chain → JWT issued → /dashboard
```

Both methods issue the same JWT and give full platform access.

---

## Stellar Integration

Stellar is load-bearing infrastructure, not a wrapper:

| What | How |
|------|-----|
| **Credit issuance** | Mint SEP-41 tokens on Stellar Testnet |
| **On-chain burn** | Retire a credit (permanently auditable) |
| **Member allocation** | `energy_distribution` contract splits tokens by participation % |
| **Governance** | `community_governance` contract for cooperative proposals |
| **Wallet auth** | Challenge-response signature verification |
| **Token standard** | SEP-41 (fungible) with OpenZeppelin Stellar Pausable + Upgradeable |

### Deployed Contracts — Stellar Testnet

| Contract | Address | Purpose |
|----------|---------|---------|
| `energy_token` | [`CCYOVOFD...MRPBA6`](https://stellar.expert/explorer/testnet/contract/CCYOVOFDJ5BVBSI6HADLWETTUF3BU423MEAWBSBWV2X5UVNKSJMRPBA6) | SEP-41 token — 1 token = 1 kWh generation credit |
| `energy_distribution` | [`CBTDPLFN...NX2UDZ`](https://stellar.expert/explorer/testnet/contract/CBTDPLFNFGWVOD4HXDKW4EH5L3D2YGOY5CWTFCJM5TEWFL4VQTNX2UDZ) | Distributes credits to members proportionally |
| `community_governance` | [`CCH2EXXN...BJD6YI`](https://stellar.expert/explorer/testnet/contract/CCH2EXXNSDW2BAKBIPFAG6CCZS6LV4VJFUP2CZZCW5LEY4JOAXBJD6YI) | Cooperative on-chain governance (proposals; voting WIP) |

Built with **OpenZeppelin Stellar Contracts v0.5.1** + **Soroban SDK 23.1.0** — 65 tests passing.

---

## Live Demo

**Platform:** https://be-energy-six.vercel.app  
**Network:** Stellar Testnet  
**Demo login:** `demo@beenergy.coop` / `Demo2026!`

**[Watch Demo Video →](https://www.youtube.com/watch?v=c5avxNUI18Y)**

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Blockchain | Stellar Testnet (Soroban smart contracts) |
| Smart Contracts | Rust + OpenZeppelin Stellar v0.5.1 |
| Token Standard | SEP-41 fungible token |
| Frontend | Next.js 16 + React 19 + TypeScript |
| Styling | Tailwind CSS v4 + shadcn/ui |
| Auth | JWT + Stellar wallet signature challenge |
| Wallet Support | Freighter, xBull, Lobstr (via Stellar Wallets Kit) |
| Backend | Standalone Next.js API service + Supabase |
| Deployment | Vercel |
| Monorepo | Turborepo + pnpm |

---

## Monorepo Structure

```
Africanking/
├── apps/
│   ├── contracts/           # Soroban smart contracts (Rust)
│   │   ├── energy_token/         # SEP-41 generation credit token
│   │   ├── energy_distribution/  # Member allocation logic
│   │   ├── community_governance/ # Cooperative proposals (voting WIP)
│   │   └── cooperative_factory/  # Factory for per-coop deployments (implemented, not deployed)
│   ├── api/                 # Standalone Next.js API service (port 3001)
│   └── web/                 # Next.js dashboard (port 3000)
│       ├── app/             # App Router pages
│       ├── components/      # UI components
│       └── lib/             # Auth, wallet, Stellar utils
├── packages/
│   └── stellar/             # Shared wallet & config utilities
├── scripts/
│   ├── generate-manifest.ts # Build provenance manifest
│   ├── smart-meter-mock.ts  # Meter simulator (testnet)
│   └── simulate-testnet.ts  # Testnet simulation (legacy)
├── docs/
│   ├── domain-model.md          # Legal/regulatory model for Argentina GD
│   ├── architecture-map.md      # Service boundaries, routes, responsibility map
│   └── releases/
│       ├── api-rollout-policy.md    # Expand-migrate-contract, deprecation policy
│       └── build-provenance.md      # Release manifest and /api/health
└── tooling/
```

For a detailed service map, routes, and data ownership, see [`docs/architecture-map.md`](docs/architecture-map.md).

---

## Quick Start

```bash
git clone https://github.com/daree-dev/Africanking.git
cd Africanking
pnpm install
# Copy and fill required values
cp apps/api/.env.example apps/api/.env.local
pnpm dev
```

Frontend: `http://localhost:3000`  
API: `http://localhost:3001`

**Build and test contracts:**
```bash
cd apps/contracts
stellar contract build
cargo test
```

**Deploy the cooperative contracts to Testnet:** see
[`apps/contracts/DEPLOYMENT.md`](apps/contracts/DEPLOYMENT.md) for secure key
setup, dry-run previews, deployment, and generated manifests. The deployment
flow supports cooperative member generation-credit allocation; it is not an
external certificate marketplace or I-REC/ESG certification.

API and web tests run in CI on every pull request (`.github/workflows/ci.yml`).
The workflow installs with a frozen lockfile (`pnpm install --frozen-lockfile`),
caches the pnpm store, and fails the PR on any regression.

## Service-Level Objectives & Degradation Policy

Operational targets for the cooperative-management platform. Generation credits are assigned to cooperative members; this is **not** an external certificate marketplace and makes **no** I-REC/ESG certification claim. Stellar is the immutable evidence layer; the relational store is the operational system of record.

### SLOs

| Area | SLO | Target | Window | Measurement |
|------|-----|--------|--------|-------------|
| API availability | Successful (non-5xx) responses on `/api/*` | ≥ 99.5% | 30 days rolling | `http_requests_total` by status class |
| Reading ingestion latency | `POST /api/meters/readings` p95 | ≤ 800 ms | 30 days rolling | `http_request_duration_seconds` histogram |
| Chain status freshness | Age of last successful Stellar RPC status check | ≤ 60 s | 30 days rolling | `chain_status_age_seconds` gauge |
| Data durability | Successful Supabase writes / attempted writes | ≥ 99.9% | 30 days rolling | `db_write_errors_total` vs `db_writes_total` |

Error budget = 100% − SLO target over the window (e.g. API availability budget ≈ 3.6 h/month).

### Degradation policy (user-visible behavior)

| Dependency / SLO at risk | User-visible behavior |
|--------------------------|-----------------------|
| API availability budget < 25% | Banner: "Degraded performance — some actions may be slow." Read paths stay up; non-critical writes queued. |
| Ingestion latency p95 > 800 ms | Readings still accepted; UI shows "Processing" state and retries idempotently. |
| Chain status stale > 60 s | Chain-backed actions (mint/retire) disabled with "Chain temporarily unavailable — retry shortly"; cached balances shown read-only. |
| Data durability budget < 25% | Writes fail closed with explicit error; no silent data loss; operators paged. |

### Error-budget review & capacity

- Weekly review of error-budget burn against the 30-day windows above.
- When burn rate exceeds 2× the sustainable rate, freeze non-critical rollouts and update capacity assumptions (instance count, DB pool size, RPC rate limits) in the operations runbook.
- Dashboards and alert rules live in `docs/operations/observability-runbook.md`; alerting is validated against a controlled SLO breach before each release.

---

## Backup, Restore & Disaster Recovery

Operational runbook for the cooperative-management platform. Generation credits are assigned to cooperative members; this is **not** an external certificate marketplace and makes **no** I-REC/ESG certification claim. Stellar is the immutable evidence layer; the relational store is the operational system of record.

### RPO / RTO targets

| Data class |

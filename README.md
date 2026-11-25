# Africanking

> **Renewable energy cooperatives deserve proof. Africanking puts it on-chain.**

[![Live Demo](https://img.shields.io/badge/🌐_Live_Demo-be--energy--six.vercel.app-00537A?style=for-the-badge)](https://be-energy-six.vercel.app)
[![Network](https://img.shields.io/badge/Stellar-Testnet-FFD500?style=for-the-badge&logo=stellar)](https://stellar.org)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue?style=for-the-badge)](LICENSE)

---

> ### ⚠️ Estado actual (pivot en curso — leer antes de lo demás)
> Africanking está pivoteando el modelo de producto. El flujo de "comprador externo / certificado vendido a ESG" y cualquier mercado secundario descritos más abajo **no son el rumbo actual** — se descartaron junto con el marketplace P2P. La nueva dirección: software de gestión de créditos de generación compartida para cooperativas eléctricas (foco Argentina, referencia: Exa Energia en Brasil). El resto de este README todavía no está actualizado al pivot — se está reescribiendo por partes. No asumir que lo de abajo describe el producto que se está construyendo hoy.

---

## 🏆 Recognition

| Award | Event |
|-------|-------|
| 🥇 **Featured Project** | [Stellar Buenos Aires Hackathon 2025](https://dorahacks.io/buidl/36793) |
| 🏅 **Innovation Certificate** | Stellar Jury — Buenos Aires 2025 |
| 🌍 **Selected** | [ClimateLaunchpad 2026](https://climatelaunchpad.org/) — world's largest green startup competition, powered by Climate-KIC & Chrysalis LEAP |

---

## The Problem

Renewable energy cooperatives generate clean energy every day — but **they can't prove it**.

- No standardized way to record generation
- No verifiable certificate that travels with the energy claim
- No access to ESG markets, carbon offsetting programs, or institutional buyers
- Manual, paper-based processes that nobody trusts

Meanwhile, companies and funds with ESG commitments are actively looking for verifiable renewable energy claims — and can't find them.

**The gap between cooperatives and buyers is a trust gap. Africanking closes it.**

---

## The Solution

Africanking is a cooperative management dashboard + on-chain certification infrastructure on **Stellar**.

Every kWh registered by a cooperative becomes a **proto-certificate**: a verifiable, on-chain claim tied to a real meter, a real cooperative, and a real time period.

```
Smart meter sends reading → POST /api/meters/readings
         ↓
Africanking validates & mints token on Stellar (1 token = 1 kWh)
         ↓
Certificate is assigned to cooperative members
         ↓
External buyer (company / ESG fund) purchases certificate
         ↓
Buyer retires certificate on-chain (verifiable burn)
         ↓
Permanent, auditable proof on Stellar blockchain
```

No intermediaries. No PDFs. No trust required — the chain is the proof.

---

## How It Works — Full Platform Flow

### For Cooperatives

```
1. Register cooperative on Africanking
2. Add smart meters (physical IoT devices)
3. Meters send generation readings automatically via API
4. Africanking mints proto-certificates on Stellar
5. Manage members, view generation stats, track certificates
```

### Authentication

Africanking supports two access methods — no setup required to try:

**Email + Password** (for admins, buyers, internal team)
```
/login → Supabase auth → JWT issued → Stellar wallet auto-assigned → /dashboard
```
> Try it: `demo@beenergy.coop` / `Demo2026!`

**Stellar Wallet** (for cooperatives with Freighter / xBull / Lobstr)
```
Connect wallet → Server issues challenge → User signs with private key
→ Signature verified on-chain → JWT issued → /dashboard
```

Both methods issue the same JWT and give full platform access. Wallet users can additionally sign on-chain transactions.

---

## Stellar Integration — What's Actually On-Chain

This is not a wrapper. Stellar is load-bearing infrastructure:

| What | How |
|------|-----|
| **Certificate issuance** | Mint SEP-41 tokens directly on Stellar Testnet |
| **Certificate retirement** | On-chain burn, permanently auditable |
| **Member allocation** | `energy_distribution` contract splits tokens by participation % |
| **Governance** | `community_governance` contract for cooperative proposals |
| **Wallet auth** | Challenge-response signature verification (no gas, no tx) |
| **Token standard** | SEP-41 (fungible) with OpenZeppelin Stellar Pausable + Upgradeable |

### Deployed Contracts — Stellar Testnet

| Contract | Address | Purpose |
|----------|---------|---------|
| `energy_token` | [`CCYOVOFD...MRPBA6`](https://stellar.expert/explorer/testnet/contract/CCYOVOFDJ5BVBSI6HADLWETTUF3BU423MEAWBSBWV2X5UVNKSJMRPBA6) | SEP-41 token — 1 token = 1 kWh certified |
| `energy_distribution` | [`CBTDPLFN...NX2UDZ`](https://stellar.expert/explorer/testnet/contract/CBTDPLFNFGWVOD4HXDKW4EH5L3D2YGOY5CWTFCJM5TEWFL4VQTNX2UDZ) | Distributes certificates to members |
| `community_governance` | [`CCH2EXXN...BJD6YI`](https://stellar.expert/explorer/testnet/contract/CCH2EXXNSDW2BAKBIPFAG6CCZS6LV4VJFUP2CZZCW5LEY4JOAXBJD6YI) | Cooperative on-chain governance |

Built with **OpenZeppelin Stellar Contracts v0.5.1** + **Soroban SDK 23.1.0** — 65 tests passing.

---

## Customer Discovery

We validated the problem directly with:

- **Energy cooperatives** in Argentina — confirmed the pain of not being able to sell renewable attributes
- **ESG compliance teams** — confirmed demand for verifiable, auditable certificates
- **Climate program coordinators** — confirmed interest in blockchain-based proof over PDFs

Key insight: the bottleneck isn't production — cooperatives generate plenty. The bottleneck is **verifiable proof**. Africanking solves exactly that.

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
| Auth | Supabase + JWT + Stellar wallet signature |
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
│   │   ├── energy_token/         # SEP-41 certificate token
│   │   ├── energy_distribution/  # Member allocation logic
│   │   └── community_governance/ # DAO-style proposals
│   ├── api/                  # Standalone Next.js API service
│   └── web/                  # Next.js dashboard
│       ├── app/             # App Router pages
│       ├── components/      # UI components
│       └── lib/             # Auth, wallet, Stellar utils
├── packages/
│   └── stellar/             # Shared wallet & config utilities
└── tooling/
    └── issues/              # GitHub issue templates
```

---

## Quick Start

```bash
git clone https://github.com/BuenDia-Builders/Africanking.git
cd Africanking
pnpm install
# Set required backend values in apps/api/.env.local using apps/api/.env.example
pnpm dev
```

Frontend: `http://localhost:3000`

API: `http://localhost:3001` (the frontend proxies `/api/*` to the API service)

**Build & test contracts:**
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

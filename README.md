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

---

## Security Architecture — Threat Model

Africanking combines cooperative data, wallet identity, service-role database access, and a server-side minter key. This section is the maintained threat model for those trust boundaries. It is scoped to the current cooperative-management direction: generation credits are assigned to cooperative members. It is **not** an external certificate marketplace and makes **no** I-REC/ESG certification claim.

### Assets

| Asset | Where it lives | Why it matters |
|-------|----------------|----------------|
| Cooperative & member records | Supabase (Postgres) | Tenant data; cross-tenant reads are a breach |
| Meter readings (ingestion) | Supabase + API | Source of truth for generation credits |
| Generation credits / proto-certificates | `energy_token` (SEP-41) on Stellar | On-chain value assigned to members |
| Member allocation state | `energy_distribution` contract | Determines who receives credits |
| Governance proposals | `community_governance` contract | Cooperative decisions |
| Minter key | Server-side secret (API env) | Can mint credits — highest-value secret |
| Service-role DB key | Server-side secret (API env) | Bypasses row-level security |
| Session JWTs | Client + API | Identity for all authenticated routes |

### Trust boundaries

1. **Browser ↔ API** — untrusted client; every request is authenticated and tenant-scoped server-side.
2. **API ↔ Supabase** — API holds the service-role key; RLS is bypassed here, so tenant scoping must be enforced in API code.
3. **API ↔ Stellar (minter)** — server-side minter key signs mint/burn; never exposed to clients.
4. **Meter/IoT ↔ Ingestion API** — external device input; treated as untrusted until validated.
5. **Cooperative tenant ↔ cooperative tenant** — logical isolation enforced by cooperative ID on every query.

### Threat actors

- **Anonymous internet attacker** — probes auth and ingestion endpoints.
- **Authenticated member of another cooperative** — attempts cross-tenant access (IDOR).
- **Malicious/compromised meter** — submits forged or inflated readings.
- **Insider / compromised admin** — abuses privileged review, minting, or admin actions.
- **Leaked-secret attacker** — obtains minter or service-role key.

### Abuse cases, mitigations, and verification

| Flow | Abuse case | Mitigation | Verification evidence |
|------|-----------|------------|-----------------------|
| **Authentication** | Forged/replayed JWT; wallet challenge replay | JWT verified server-side on every route; wallet challenge is single-use and signature-checked | Auth route tests + wallet challenge-response tests |
| **Authentication** | Cross-tenant access via guessed IDs | Every query scoped by authenticated cooperative ID; service-role queries never trust client-supplied tenant | Tenant-isolation tests on API routes |
| **Ingestion** | Forged/inflated meter readings | Meter authenticated; readings validated (range, monotonicity, period) before persistence | Ingestion validation tests |
| **Review** | Member approves own or foreign-cooperative submission | Review actions require reviewer role within the same cooperative; separation of submit vs. approve | Review authorization tests |
| **Minting** | Unauthorized or duplicate mint | Mint only via server-side minter key after review; idempotency on reading ID; `energy_token` mint restricted to minter authority | Contract tests (`energy_token`) + mint idempotency tests |
| **Minting** | Minter key leak | Key stored only in server env, never shipped to client; rotation runbook | Secret-scanning CI + key-rotation operational control |
| **Administration** | Privilege escalation / destructive admin action | Admin actions role-gated and audited; service-role key server-only | Admin authorization tests + audit-log operational control |
| **Contracts** | Unauthorized allocation or governance change | `energy_distribution` and `community_governance` enforce caller authorization | Contract tests for both contracts |

### Review process

This threat model is reviewed and updated **whenever a new data source or privileged action is introduced** (new ingestion source, new admin/review/mint capability, new contract method, or new secret). Each high-risk scenario above must link to an automated test or an operational control; a change that adds a privileged action without such evidence is not mergeable.

---

## Roadmap

| Level | What | Status |
|-------|------|--------|
| 1 — Internal registry | Token = verifiable production record | ✅ Live on Testnet |
| 2 — Verified certification | IoT oracles + independent meter validation | 🔄 Next |
| 3 — Recognized standard | Integration with I-REC, Energy Web, TIGR | 🔮 Future |

---

## Planned Stellar Ecosystem Integrations

Africanking is designed to plug into the wider Stellar ecosystem as the cooperative-credit model matures.

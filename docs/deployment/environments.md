# Environments

Three environment tiers keep local dev, staging, and production data and networks isolated.

## Environment matrix

| Environment | Stellar network | Supabase project | Contracts |
|---|---|---|---|
| **local** | Testnet | Local or dev Supabase | Shared testnet contracts (see `contract-manifest.json`) |
| **staging** | Testnet | Dedicated staging Supabase | Staging-specific contract IDs |
| **production** | Mainnet | Production Supabase | Production mainnet contract IDs |

Each environment uses a separate set of env vars. Never share secrets or contract IDs across tiers.

## Setup

### Local

1. Copy `apps/web/.env.local.example` → `apps/web/.env.local`.
2. Copy `apps/api/.env.example` → `apps/api/.env.local`.
3. Fill in your local/dev Supabase credentials and testnet contract IDs.
4. Run `pnpm dev` from the repo root.

### Staging

Variables are set as **GitHub Actions repository variables** (non-secret) or **secrets** (Supabase service role key, JWT secret):

| Variable name | Secret? | Description |
|---|---|---|
| `STAGING_SUPABASE_URL` | No | Staging Supabase project URL |
| `STAGING_SUPABASE_ANON_KEY` | No | Staging Supabase anon key |
| `STAGING_SUPABASE_SERVICE_ROLE_KEY` | Yes | Staging service role key |
| `STAGING_ENERGY_TOKEN_CONTRACT` | No | Staging `energy_token` contract ID |
| `STAGING_ENERGY_DISTRIBUTION_CONTRACT` | No | Staging `energy_distribution` contract ID |
| `STAGING_COMMUNITY_GOVERNANCE_CONTRACT` | No | Staging `community_governance` contract ID |
| `STAGING_URL` | No | Base URL of the staging deployment |

See `.env.staging.example` and `apps/api/.env.staging.example` for the full list.

### Production

Variables are set as **GitHub Actions secrets** in the `production` environment (requires approval gate):

| Variable/Secret | Description |
|---|---|
| `PROD_SUPABASE_URL` | Production Supabase URL |
| `PROD_SUPABASE_ANON_KEY` | Production Supabase anon key |
| `PROD_SUPABASE_SERVICE_ROLE_KEY` | Production service role key |
| `PROD_ENERGY_TOKEN_CONTRACT` | Production contract ID |
| `PROD_ENERGY_DISTRIBUTION_CONTRACT` | Production contract ID |
| `PROD_COMMUNITY_GOVERNANCE_CONTRACT` | Production contract ID |
| `PROD_JWT_SECRET` | Production JWT signing key |
| `PRODUCTION_URL` | Base URL of the production deployment |

See `.env.production.example` for the full list.

# Build Provenance and Deployment Manifest

> Applies to the monorepo build pipeline and `apps/api`. Last updated: 2026-10.

---

## Purpose

Operators need to identify the exact source revision, dependency lockfiles, contract WASM, and network configuration behind a running deployment. The release manifest provides that in a single machine-readable file without exposing credentials or user data.

---

## How the manifest is generated

`scripts/generate-manifest.ts` runs at build time and writes `dist/release-manifest.json`.

Run it manually:

```bash
pnpm manifest
# or
npx tsx scripts/generate-manifest.ts
```

Integrate into CI before deploying:

```yaml
# .github/workflows/deploy.yml  (excerpt)
- name: Build contracts
  run: cd apps/contracts && stellar contract build

- name: Generate release manifest
  run: pnpm manifest

- name: Build apps
  run: pnpm build
```

---

## Manifest contents

```jsonc
{
  // Safe identifier for logs, monitoring, and /api/health
  "build_id": "866124e+testnet",

  "git": {
    "commit_sha": "<full 40-char SHA>",
    "short_sha": "866124e",
    "commit_date": "2026-10-01T12:00:00Z",
    "branch": "main",
    "tags": ["v0.3.0"]
  },

  // Versions from each package.json
  "packages": {
    "api": "0.3.0",
    "web": "0.3.0",
    "stellar": "0.3.0",
    "root": "0.3.0"
  },

  // SHA-256 of pnpm-lock.yaml — detects lockfile drift between environments
  "lockfile_sha256": "<hex>",

  "contracts": {
    // SHA-256 of compiled WASM files from apps/contracts/target/wasm32v1-none/release/
    // null = WASM not built yet (development without a prior build)
    "wasm_hashes": {
      "energy_token": "<hex or null>",
      "energy_distribution": "<hex or null>",
      "community_governance": "<hex or null>",
      "cooperative_factory": "<hex or null>"
    },
    // Public on-chain addresses — not secrets
    "deployed_addresses": {
      "energy_token": "CCYOVOFDJ5BVBSI6HADLWETTUF3BU423MEAWBSBWV2X5UVNKSJMRPBA6",
      "energy_distribution": "CBTDPLFNFGWVOD4HXDKW4EH5L3D2YGOY5CWTFCJM5TEWFL4VQTNX2UDZ",
      "community_governance": "CCH2EXXNSDW2BAKBIPFAG6CCZS6LV4VJFUP2CZZCW5LEY4JOAXBJD6YI"
    }
  },

  "network": {
    "stellar_network": "TESTNET",
    "stellar_rpc_url": "https://soroban-testnet.stellar.org",
    "horizon_url": "https://horizon-testnet.stellar.org",
    "vercel_env": "production",
    "vercel_region": "iad1"
  },

  "generated_at": "2026-10-01T12:00:00.000Z"
}
```

**What the manifest never contains:**
- `MINTER_SECRET_KEY` or any private key
- `SUPABASE_SERVICE_ROLE_KEY` or any database credentials
- JWT secrets or session tokens
- Any user data (IDs, emails, readings)

The script reads contract addresses from `NEXT_PUBLIC_*` environment variables, which are already public on the client side. If not set, it falls back to the known Testnet addresses.

---

## /api/health endpoint

`GET /api/health` returns a subset of the manifest that is safe to expose to any caller:

```json
{
  "status": "ok",
  "service": "@be-energy/api",
  "build_id": "866124e+testnet",
  "git": {
    "short_sha": "866124e",
    "commit_date": "2026-10-01T12:00:00Z",
    "branch": "main"
  },
  "network": {
    "stellar_network": "TESTNET",
    "env": "production",
    "region": "iad1"
  },
  "manifest_generated_at": "2026-10-01T12:00:00.000Z",
  "timestamp": "2026-10-01T12:05:00.000Z"
}
```

The response omits WASM hashes, lockfile hash, deployed contract addresses, and package versions. Those are available in the full manifest artifact stored in CI.

---

## Verifying reproducibility in CI

After a deploy, compare the manifest from the deployed artifact against the one generated from the same commit:

```bash
# 1. Fetch the deployed manifest's build_id
DEPLOYED_BUILD_ID=$(curl -s https://be-energy-api.vercel.app/api/health | jq -r .build_id)
echo "Deployed: $DEPLOYED_BUILD_ID"

# 2. Rebuild locally at that commit
git checkout <commit_sha>
cd apps/contracts && stellar contract build
cd ../.. && pnpm manifest

# 3. Compare WASM hashes from dist/release-manifest.json with CI artifact
jq '.contracts.wasm_hashes' dist/release-manifest.json
```

WASM hashes are deterministic: the same Rust source, Soroban SDK version, and toolchain (`rust-toolchain.toml`) produce the same binary. A mismatch means either a source change or a toolchain drift.

---

## Security notes

- `dist/release-manifest.json` is a build artifact, not a secret. It is safe to store in CI artifact storage and compare across environments.
- Do not add `dist/` to `.gitignore` exemptions that would commit the manifest into the repository — it belongs in CI artifacts, not in git history (it changes on every commit).
- The manifest file path is under `dist/` which is already in `.gitignore`.

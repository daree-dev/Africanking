# Deployment manifests

One JSON manifest per network describes which contract IDs and contract versions the API may
talk to. The API validates the manifest together with the network passphrase, the RPC/Horizon
endpoints, and the contract IDs from its environment at startup
(`apps/api/server/stellar/network-config.ts`).

| File | Network | Notes |
|---|---|---|
| `testnet.json` | `TESTNET` | Demo deployment from `docs/5-CONTRACTS.md`. Not production guidance. |
| `mainnet.json` | `PUBLIC` | Not committed yet. Create it in the production release PR once the contracts are deployed under the multisig admin described in `docs/operations/contract-authority-runbook.md`. |

## Format

```json
{
  "schemaVersion": 1,
  "network": "PUBLIC",
  "networkPassphrase": "Public Global Stellar Network ; September 2015",
  "environment": "production",
  "contracts": {
    "energy_token": { "id": "C…", "version": "0.1.0", "wasmHash": "<sha256 hex, optional>" },
    "energy_distribution": { "id": "C…", "version": "0.1.0" },
    "community_governance": { "id": "C…", "version": "0.1.0" }
  }
}
```

- `energy_token` and `energy_distribution` are required. `community_governance` is optional.
- `version` must be listed in `SUPPORTED_CONTRACT_VERSIONS` in the API.
- Manifests only hold **public** identifiers. Never add secret keys, seeds, or API tokens.

Point the API at a manifest with `STELLAR_DEPLOYMENT_MANIFEST=../contracts/deployments/testnet.json`
(path relative to the API working directory), or inline it with `STELLAR_DEPLOYMENT_MANIFEST_JSON`.

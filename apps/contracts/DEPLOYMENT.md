# Cooperative contracts deployment

The deployment script builds the contracts and deploys a sample cooperative to
**Stellar Testnet only**. It uses the Cooperative Registry required by the
factory. Generation credits are managed for cooperative members; this flow is
not an external certificate marketplace and does not claim I-REC or ESG
certification.

## Prerequisites

- Python 3.10 or later
- Rust toolchain and the `wasm32v1-none` target
- Stellar CLI, configured for Testnet
- A funded Testnet account saved as a Stellar CLI identity

Create and fund a local identity:

```sh
stellar keys generate deployer --network testnet --fund
```

Stellar CLI stores local signing keys in its secure credential storage. The
script accepts an identity alias (`STELLAR_SOURCE`), never a secret key. In CI,
provision that alias from the CI secret store on an ephemeral runner; do not put
signing keys in repository files, manifests, or workflow logs.

## Preview

```sh
python tooling/scripts/deploy_contracts.py --dry-run
```

The preview builds the WASM and prints its hashes, deterministic registry,
factory, and cooperative contract addresses, and the sample cooperative
parameters. It does not upload WASM or submit transactions. Use a unique
deployment ID for each deployment:

```sh
python tooling/scripts/deploy_contracts.py \
  --deployment-id workshop-2026 \
  --cooperative-id buenos-aires-solar \
  --token-name "Buenos Aires Solar" \
  --token-symbol BARS
```

The script deploys and initializes the registry and factory, uploads the three
approved child-contract WASMs, sets their hashes on the factory, and creates the
sample cooperative with one required approval and no initial members. Members
can then be added through the distribution contract. IDs are deterministic, so
re-running the same deployment ID will fail if those contracts already exist;
choose a new deployment ID to deploy again.

On success, the script writes
`deployments/testnet/<deployment-id>.json` with contract IDs, all five WASM
hashes, network, deployment parameters, and Stellar Expert links for each
transaction. The manifest contains no signing material.

## Validation

```sh
cd apps/contracts
cargo test
```

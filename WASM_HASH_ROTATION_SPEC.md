# WASM Hash Rotation Design Specification

## Overview

Currently, the Cooperative Factory fixes child WASM hashes once via `set_wasm_hashes`, which is called at setup and never updated. This specification defines a documented and testable upgrade path that enables future hash rotation while preserving backward compatibility with already-deployed cooperatives.

## Motivation

As the protocol evolves:
- Bug fixes and optimizations require new WASM bytecode
- Emergency response to security issues may require immediate hash changes
- Different cooperative versions may need different hash signatures

The current immutable hash design prevents these upgrades. The upgrade path must:
1. Maintain the security of existing cooperatives (they don't auto-upgrade)
2. Enable new cooperatives to use improved WASM versions
3. Provide a documented, auditable authorization process
4. Support future multisig voting if governance becomes decentralized

## Design Goals

- **Explicit versioning**: Each hash set is tagged with an activation version
- **Auditability**: All hash changes emit events containing old/new hashes and version
- **Backward compatibility**: Existing cooperatives unaffected by factory hash changes
- **Admin control**: Only factory admin can authorize (multisig support deferred to Phase 2)
- **Atomic operations**: All three child hashes rotate together, or none do

## Architecture

### Hash Versioning System

Each set of approved WASM hashes (token, distribution, governance) is paired with:
- `version: u32` - Sequential version number (1, 2, 3, ...)
- `hashes: (BytesN<32>, BytesN<32>, BytesN<32>)` - Three contract hashes
- `activated_at: Moment` - Block height or timestamp of activation (tracked for ordering)

### Storage Schema

```rust
enum DataKey {
    // Phase 1: Current active hash set (new field)
    CurrentHashVersion,
    
    // Phase 1: History of all hash versions (new field)
    HashVersionHistory(u32),  // version → (hashes, activated_at)
    
    // Existing fields
    Registry,
    TokenWasm,         // Deprecated: kept for Phase 1 compatibility
    DistributionWasm,  // Deprecated: kept for Phase 1 compatibility
    GovernanceWasm,    // Deprecated: kept for Phase 1 compatibility
}

#[contracttype]
pub struct HashVersionRecord {
    pub token_wasm_hash: BytesN<32>,
    pub distribution_wasm_hash: BytesN<32>,
    pub governance_wasm_hash: BytesN<32>,
    pub activated_at: u64,  // ledger sequence number for auditability
}
```

### Cooperative Hash Tracking

Existing cooperatives continue to use their deployed contract instances. No factory upgrade affects them. When a new cooperative is deployed, it:
1. Records the hash version used: `CooperativeHashVersion(cooperative_id) → version`
2. This enables future queries: "which WASM version did this coop use?"

```rust
enum DataKey {
    CooperativeHashVersion(String),  // cooperative_id → version
}
```

### Events

All hash changes emit auditable events:

```rust
#[contracttype]
pub struct HashRotationEvent {
    pub old_version: u32,
    pub new_version: u32,
    pub old_hashes: (BytesN<32>, BytesN<32>, BytesN<32>),
    pub new_hashes: (BytesN<32>, BytesN<32>, BytesN<32>),
    pub activated_at_ledger: u64,
}

// Emitted as:
env.events().publish(
    (Symbol::new(&env, "hash_rotation"),),
    HashRotationEvent {
        old_version,
        new_version,
        old_hashes,
        new_hashes,
        activated_at_ledger: env.ledger().sequence(),
    },
);
```

## Phase 1 Implementation (Current)

### New Functions

#### `rotate_wasm_hashes`
Authorized admin function that updates all three hashes and increments the version.

```rust
pub fn rotate_wasm_hashes(
    env: Env,
    token_wasm_hash: BytesN<32>,
    distribution_wasm_hash: BytesN<32>,
    governance_wasm_hash: BytesN<32>,
) -> Result<u32, FactoryError>
```

**Behavior**:
- Requires admin authentication
- Increments `CurrentHashVersion` from N to N+1
- Stores the three new hashes in `HashVersionHistory(N+1)`
- Emits a `HashRotationEvent` with both old and new versions
- Returns the new version number for confirmation
- **Immediate activation**: All new cooperatives deployed after this call use the new hashes

**Authorization**: 
- Admin account as configured in `__constructor`
- Single signature required (multisig deferred to Phase 2)
- Called via: `stellar contract invoke --id <factory> -- rotate_wasm_hashes ...`

#### `get_hash_version`
Query the current active hash version.

```rust
pub fn get_hash_version(env: Env) -> u32
```

#### `get_hashes_at_version`
Query which hashes were used at a specific version.

```rust
pub fn get_hashes_at_version(
    env: Env,
    version: u32,
) -> Option<HashVersionRecord>
```

#### `get_cooperative_hash_version`
Query which hash version a specific cooperative used.

```rust
pub fn get_cooperative_hash_version(
    env: Env,
    cooperative_id: String,
) -> Option<u32>
```

### Modified Functions

#### `deploy_cooperative`
No signature change. After rotation, uses `CurrentHashVersion` to load hashes instead of fixed storage keys.

```rust
pub fn deploy_cooperative(
    env: Env,
    cooperative_id: String,
    admin: Address,
    token_name: String,
    token_symbol: String,
    initial_members: Vec<Member>,
    required_approvals: u32,
) -> Result<CooperativeInfo, FactoryError>
```

**Behavior changes**:
- Load hashes from `HashVersionHistory(current_version)` instead of fixed keys
- Record `CooperativeHashVersion(cooperative_id) = current_version`
- Existing cooperatives continue to use their deployed contract instances; this only affects new deployments

#### `set_wasm_hashes`
Deprecated but kept for Phase 1 backward compatibility. New deployments should use `rotate_wasm_hashes`.

```rust
pub fn set_wasm_hashes(
    env: Env,
    token_wasm_hash: BytesN<32>,
    distribution_wasm_hash: BytesN<32>,
    governance_wasm_hash: BytesN<32>,
) -> Result<(), FactoryError>
```

**Behavior in Phase 1**:
- If `CurrentHashVersion` doesn't exist (factory initialization), sets it to 1 and stores hashes
- If `CurrentHashVersion` already exists, returns `Err(FactoryError::HashesAlreadySet)` → forces use of `rotate_wasm_hashes` for future changes
- Logs a deprecation event

## Phase 2 (Future): Multisig Rotation

When governance decentralizes:

```rust
pub fn propose_hash_rotation(
    env: Env,
    proposal_id: String,
    token_wasm_hash: BytesN<32>,
    distribution_wasm_hash: BytesN<32>,
    governance_wasm_hash: BytesN<32>,
) -> Result<(), FactoryError>

pub fn confirm_hash_rotation(
    env: Env,
    proposal_id: String,
) -> Result<u32, FactoryError>  // approved when M of N multisig signers approve
```

This keeps the same external interface (new hash version incremented on confirmation) while changing the authorization layer.

## Error Handling

```rust
pub enum FactoryError {
    // Existing errors...
    
    // Phase 1 hash rotation errors
    HashesAlreadySet = 20,          // set_wasm_hashes called twice
    InvalidHashVersion = 21,        // rotate_wasm_hashes called with version 0
    HashVersionNotFound = 22,       // get_hashes_at_version(N) where N was never set
}
```

## Backward Compatibility

### For Existing Cooperatives

- Deployed cooperatives continue to use their deployed contract instances
- Factory WASM hash updates do NOT affect them
- Their tokens, distributions, and governance contracts remain at their original WASM bytecode

### For Factory Storage

- Old keys (`TokenWasm`, `DistributionWasm`, `GovernanceWasm`) maintained alongside new versioning system
- `set_wasm_hashes` can be called once to initialize version 1
- Future changes go through `rotate_wasm_hashes` with explicit versioning

### For Client Code

- Existing calls to `get_wasm_hashes()` continue to work (returns current active version)
- New queries available: `get_hashes_at_version()` for historical audit

## Testing Strategy

### Unit Tests

1. **Initialization**
   - `test_set_wasm_hashes_initializes_version_1`
   - `test_set_wasm_hashes_fails_if_already_set`

2. **Rotation**
   - `test_rotate_wasm_hashes_increments_version`
   - `test_rotate_wasm_hashes_stores_history`
   - `test_rotate_wasm_hashes_emits_event_with_old_new_versions`
   - `test_rotate_wasm_hashes_requires_admin`

3. **Versioning**
   - `test_deploy_uses_current_hash_version`
   - `test_deploy_records_coop_hash_version`
   - `test_multiple_rotations_new_coops_use_latest`
   - `test_get_hashes_at_version_returns_history`

4. **Backward Compatibility**
   - `test_existing_cooperatives_unaffected_by_rotation`
   - `test_get_wasm_hashes_returns_current_version`

### Integration Tests

5. **Full Rotation Scenario**
   - Deploy coop with version 1
   - Rotate hashes to version 2
   - Deploy new coop with version 2
   - Verify old coop still uses original contracts
   - Query history to confirm rotation occurred

6. **Audit Trail**
   - Emit multiple rotation events
   - Parse event log to reconstruct full hash history
   - Verify each event contains old/new versions and ledger height

## Migration Path for Production

### Pre-Deployment Checklist

- [ ] All three child contracts (token, distribution, governance) compiled and tested
- [ ] WASMs installed on target network: `stellar contract install`
- [ ] New hash values documented (SHA-256 of compiled WASM files)
- [ ] Factory contract upgraded with Phase 1 implementation
- [ ] Integration tests passing in testnet

### Deployment Steps

1. **Deploy factory with Phase 1 code**
   ```bash
   stellar contract deploy --source <deployer> --network testnet \
       --wasm cooperative_factory.wasm
   ```

2. **Initialize version 1 hashes**
   ```bash
   stellar contract invoke --id <factory> -- set_wasm_hashes \
       --token_wasm_hash <hash1> \
       --distribution_wasm_hash <hash2> \
       --governance_wasm_hash <hash3>
   ```

3. **Deploy cooperatives** (all use version 1)
   ```bash
   stellar contract invoke --id <factory> -- deploy_cooperative \
       --cooperative_id "coop-solar-ba" \
       ...
   ```

4. **To rotate hashes for future cooperatives**
   ```bash
   stellar contract invoke --id <factory> -- rotate_wasm_hashes \
       --token_wasm_hash <new_hash1> \
       --distribution_wasm_hash <new_hash2> \
       --governance_wasm_hash <new_hash3>
   # Returns: new version = 2
   ```

5. **Verify rotation occurred**
   ```bash
   stellar contract invoke --id <factory> -- get_hash_version
   # Returns: 2
   
   stellar contract invoke --id <factory> -- get_hashes_at_version --version 1
   # Returns: original hashes
   
   stellar contract invoke --id <factory> -- get_hashes_at_version --version 2
   # Returns: new hashes
   ```

## Security Considerations

### Authorization
- Only factory admin can initiate hash changes (Phase 1)
- Future Phase 2 multisig voting prevents unilateral admin changes
- require_auth() ensures the caller is authorized before proceeding

### Audit Trail
- Every rotation emitted as an event with both old and new hashes
- Event includes ledger sequence number for temporal ordering
- Off-chain monitoring can detect unexpected rotations

### Validation
- Hash values must be pre-installed on the network (Stellar limitation)
- Factory does not validate hash correctness; Stellar contract instantiation will fail if hash is invalid
- Cooperative deployments fail fast if hashes unavailable

### No In-Flight Vulnerabilities
- Atomic rotation: all three hashes change together or none do
- No intermediate state where token and distribution hashes are mismatched
- Existing cooperatives unaffected; no forced upgrades

## Future Enhancements

### Phase 2: Multisig Voting
- Proposal system with multi-step approval
- Community governance integration for decentralized upgrades
- Time delays between proposal and confirmation (e.g., 24 hours) for community review

### Phase 3: Staged Rollouts
- Gradual migration: new hashes activate only for new cooperatives
- Backward compatibility layer: old cooperatives can opt-in to upgrade
- Versioned child contracts coexisting on the same network

### Phase 4: Automated Verification
- Hash verification service: publish expected hashes on-chain
- Cryptographic commitment to source code releases
- Automated alerts if factory attempts to use unexpected hashes

## Glossary

| Term | Definition |
|------|-----------|
| **Hash Rotation** | Updating all three child WASM hashes and incrementing the version |
| **Hash Version** | Sequential number (1, 2, 3, ...) identifying a set of three hashes |
| **Activation** | The moment a new hash version becomes active for future deployments |
| **Phase 1** | Initial implementation with admin-only rotation, no multisig |
| **Phase 2** | Future extension with multisig voting for decentralized governance |
| **Bootstrap Hashes** | The three hashes set during factory initialization (version 1) |
| **Child Contracts** | The three deployed contracts: energy_token, energy_distribution, community_governance |

## References

- Original factory implementation: `apps/contracts/cooperative_factory/src/lib.rs`
- Child contract interfaces defined in factory module
- Soroban SDK event emission: `env.events().publish()`
- Stellar account authorization: `address.require_auth()`

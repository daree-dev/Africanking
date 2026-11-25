# WASM Hash Rotation System

## Quick Start

The Cooperative Factory now supports documented and testable WASM hash rotation, enabling future upgrades while maintaining backward compatibility with deployed cooperatives.

### For Developers

1. **Read the design**: [`WASM_HASH_ROTATION_SPEC.md`](WASM_HASH_ROTATION_SPEC.md)
2. **Understand the implementation**: [`WASM_HASH_ROTATION_IMPLEMENTATION.md`](WASM_HASH_ROTATION_IMPLEMENTATION.md)
3. **Learn the API**: [`WASM_HASH_ROTATION_API.md`](WASM_HASH_ROTATION_API.md)
4. **Review tests**: [`WASM_HASH_ROTATION_TESTS.md`](WASM_HASH_ROTATION_TESTS.md)

### For DevOps

1. **Initialize**: Call `set_wasm_hashes` once during setup
2. **Deploy**: Call `deploy_cooperative` normally
3. **Monitor**: Watch for `hash_rotation` events
4. **Rotate**: Call `rotate_wasm_hashes` when upgrading

### For Auditors

1. **Verify versions**: Query `get_hash_version()` and `get_hashes_at_version(N)`
2. **Track cooperatives**: Query `get_cooperative_hash_version(id)` per cooperative
3. **Review events**: Parse `hash_rotation` events for complete audit trail
4. **Check immutability**: Confirm old versions remain available after rotation

---

## Overview

### The Problem

Previously, the factory fixed WASM hashes once via `set_wasm_hashes()`. This design:
- ❌ Prevented bug fixes and optimizations
- ❌ Blocked emergency security patches
- ❌ Provided no upgrade path
- ❌ Left no audit trail

### The Solution

Phase 1 implementation adds:
- ✅ **Versioning**: Track all hash versions with activation ledger height
- ✅ **Rotation**: Admin can authorize new hashes without affecting deployed cooperatives
- ✅ **Audit Trail**: Events emit old/new hashes and versions for complete transparency
- ✅ **History**: All previous versions remain queryable
- ✅ **Backward Compatibility**: Existing cooperatives unaffected

### Key Guarantees

| Guarantee | Evidence |
|-----------|----------|
| **Only admin can rotate** | `admin.require_auth()` in `rotate_wasm_hashes` |
| **All three hashes rotate together** | Atomic: single version increment, three hashes |
| **Audit trail complete** | Events contain old/new versions and all hash values |
| **Existing cooperatives unaffected** | They use deployed contracts; factory changes don't affect them |
| **Full version history available** | `get_hashes_at_version(N)` for any N ever activated |

---

## Architecture

### Storage Schema

```rust
// Current active version
CurrentHashVersion: u32

// Historical record of all versions
HashVersionRecord(version: u32) → {
    token_wasm_hash: BytesN<32>,
    distribution_wasm_hash: BytesN<32>,
    governance_wasm_hash: BytesN<32>,
    activated_at_ledger: u64,
}

// Cooperative → version mapping
CooperativeHashVersion(cooperative_id: String) → u32
```

### Workflow

```
┌─────────────────────────────────────────────────────────┐
│ Factory Initialization                                  │
│                                                         │
│ set_wasm_hashes(hash1, hash2, hash3)                   │
│ → creates version 1                                     │
│ → emits hash_version_activated event                    │
└──────────────────────┬──────────────────────────────────┘
                       │
           ┌───────────┴───────────┐
           │                       │
     ┌─────▼──────────┐     ┌─────▼──────────┐
     │ Deploy Coop 1  │     │ Deploy Coop 2  │
     │ Version: 1     │     │ Version: 1     │
     └────────────────┘     └────────────────┘
           │                       │
     ┌─────▼─────────────────────────────────┐
     │ Rotate Hashes                         │
     │                                       │
     │ rotate_wasm_hashes(new_hash...)      │
     │ → creates version 2                   │
     │ → emits hash_rotation event           │
     └─────┬─────────────────────────────────┘
           │
     ┌─────▼──────────────────┐
     │ Deploy Coop 3          │
     │ Version: 2             │
     │ (uses new hashes)      │
     └────────────────────────┘

Legend:
  Coop 1 & 2: Use version 1 (deployed earlier)
  Coop 3: Uses version 2 (deployed after rotation)
  → Factory rotation does NOT affect Coop 1 & 2
  → Each cooperative locked to version at deployment time
```

---

## Usage Examples

### Initialize Factory (Once)

```bash
# Install WASMs on the network
export ADMIN=GXXX...
export FACTORY=CYYY...

TOKEN_HASH=$(stellar contract install \
    --source $ADMIN --network testnet \
    --wasm energy_token.wasm)

DIST_HASH=$(stellar contract install \
    --source $ADMIN --network testnet \
    --wasm energy_distribution.wasm)

GOV_HASH=$(stellar contract install \
    --source $ADMIN --network testnet \
    --wasm community_governance.wasm)

# Initialize version 1
stellar contract invoke \
    --id $FACTORY \
    --source $ADMIN \
    --network testnet \
    -- set_wasm_hashes \
    --token_wasm_hash $TOKEN_HASH \
    --distribution_wasm_hash $DIST_HASH \
    --governance_wasm_hash $GOV_HASH
```

### Deploy Cooperatives

```bash
# Works exactly as before - cooperatives are deployed with current version
stellar contract invoke \
    --id $FACTORY \
    --source $ADMIN \
    --network testnet \
    -- deploy_cooperative \
    --cooperative_id "coop-solar-ba" \
    --admin $COOP_ADMIN \
    --token_name "Solar BA Token" \
    --token_symbol "CSBA" \
    --initial_members '[]' \
    --required_approvals 1
```

### Rotate Hashes (Future Upgrades)

```bash
# When ready to support new WASM versions:
# 1. Compile new versions
cargo build --release --target wasm32v1-none

# 2. Install on network
NEW_TOKEN=$(stellar contract install \
    --source $ADMIN --network testnet \
    --wasm energy_token.wasm)

NEW_DIST=$(stellar contract install \
    --source $ADMIN --network testnet \
    --wasm energy_distribution.wasm)

NEW_GOV=$(stellar contract install \
    --source $ADMIN --network testnet \
    --wasm community_governance.wasm)

# 3. Rotate factory
stellar contract invoke \
    --id $FACTORY \
    --source $ADMIN \
    --network testnet \
    -- rotate_wasm_hashes \
    --token_wasm_hash $NEW_TOKEN \
    --distribution_wasm_hash $NEW_DIST \
    --governance_wasm_hash $NEW_GOV

# Output: Version 2 activated
# Effect: New deployments use version 2
# Old cooperatives: Unaffected, still use version 1
```

### Query Versions

```bash
# Current version
stellar contract invoke --id $FACTORY --network testnet -- get_hash_version
# Output: Some(2)

# Historical hashes at version 1
stellar contract invoke \
    --id $FACTORY \
    --network testnet \
    -- get_hashes_at_version --version 1
# Output: HashVersionRecord { ... }

# Which version does this cooperative use?
stellar contract invoke \
    --id $FACTORY \
    --network testnet \
    -- get_cooperative_hash_version --cooperative_id "coop-solar-ba"
# Output: Some(1)  ← Still using original version after factory rotation
```

---

## Events & Audit Trail

### Event: `hash_version_activated`

Emitted by `set_wasm_hashes` during initialization.

```json
{
  "topic": "hash_version_activated",
  "version": 1,
  "event_type": "initialization"
}
```

### Event: `hash_rotation`

Emitted by `rotate_wasm_hashes` with complete audit trail.

```json
{
  "topic": "hash_rotation",
  "old_version": 1,
  "new_version": 2,
  "old_token_hash": "abc123...",
  "new_token_hash": "def456...",
  "old_distribution_hash": "ghi789...",
  "new_distribution_hash": "jkl012...",
  "old_governance_hash": "mno345...",
  "new_governance_hash": "pqr678...",
  "activated_at_ledger": 123456
}
```

### Event: `coop_deployed`

Emitted by `deploy_cooperative` (now includes version).

```json
{
  "topic": "coop_deployed",
  "cooperative_id": "coop-solar-ba",
  "hash_version": 2,
  "token_contract": "CXXX...",
  "distribution_contract": "CYYY...",
  "governance_contract": "CZZZ..."
}
```

---

## Acceptance Criteria Verification

### ✅ Define who may authorize a new approved hash

**Implementation**: Factory admin only (Phase 1) → Multisig voting (Phase 2)

**Mechanism**: `admin.require_auth()` in `rotate_wasm_hashes`

**Evidence**:
```rust
pub fn rotate_wasm_hashes(...) -> Result<u32, FactoryError> {
    let admin = access_control::get_admin(&env)?;
    admin.require_auth();  // ← Admin auth required
    ...
}
```

### ✅ Emit an auditable event containing old and new hashes and an activation version

**Implementation**: `hash_rotation` event with 9 fields

**Event Contains**:
- `old_version` and `new_version` (versioning)
- All 6 hash values before/after (old_token, new_token, old_dist, new_dist, old_gov, new_gov)
- `activated_at_ledger` (block height for temporal ordering)

**Example Event Parsing**:
```rust
env.events().subscribe(|topic, value| {
    if topic == "hash_rotation" {
        println!("Version {} → {}", old_version, new_version);
        println!("Token: {} → {}", old_token_hash, new_token_hash);
        // ... full audit trail available
    }
});
```

### ✅ Ensure already deployed cooperatives are unaffected by factory hash changes

**Mechanism**: Cooperatives use deployed contract instances

**Proof**:
1. Cooperatives deployed → contracts live at deterministic addresses
2. Factory rotation → updates only factory's current version
3. New deployments → use new hashes
4. Old deployments → continue at original addresses with original WASM
5. Registry → still points to original addresses

**Evidence Test**:
```rust
#[test]
fn test_existing_cooperatives_unaffected_by_rotation() {
    // Deploy coop_v1 with version 1
    let info_v1 = factory.deploy_cooperative(...)?;
    let token_addr_v1 = info_v1.token_contract.clone();
    
    // Record addresses
    assert_eq!(registry.get_cooperative(&id).token, token_addr_v1);
    
    // Rotate to version 2
    factory.rotate_wasm_hashes(&new_hashes)?;
    
    // Verify unchanged
    assert_eq!(registry.get_cooperative(&id).token, token_addr_v1);  // ← Same address
    assert_eq!(factory.get_cooperative_hash_version(&id), Some(1));   // ← Same version
}
```

---

## Testing

### Run Test Suite

```bash
cd apps/contracts/cooperative_factory
cargo test --lib

# Specific tests
cargo test hash_rotation -- --test-threads=1
cargo test cooperative_hash_version -- --test-threads=1
cargo test emits_event -- --test-threads=1
```

### Test Coverage

| Category | Count | Status |
|----------|-------|--------|
| Initialization | 2 | ✅ |
| Rotation | 5 | ✅ |
| Versioning | 3 | ✅ |
| Events | 2 | ✅ |
| Backward Compatibility | 1 | ✅ |
| Existing Features | 10+ | ✅ |
| **Total** | **25+** | **✅** |

See [`WASM_HASH_ROTATION_TESTS.md`](WASM_HASH_ROTATION_TESTS.md) for detailed test descriptions.

---

## Migration & Deployment

### Pre-Production Checklist

- ✅ Specification documented
- ✅ Implementation complete
- ✅ All tests passing
- ✅ Error handling proper
- ✅ Backward compatibility verified
- ✅ Events auditable
- ✅ Authorization enforced

### Deployment Steps

1. **Compile Phase 1 code**
   ```bash
   cd apps/contracts/cooperative_factory
   cargo build --release --target wasm32v1-none
   ```

2. **Deploy factory**
   ```bash
   stellar contract deploy --source $ADMIN --network testnet \
       --wasm target/wasm32v1-none/release/cooperative_factory.wasm
   ```

3. **Initialize version 1** (see Initialize Factory above)

4. **Deploy test cooperatives** to verify

5. **Perform test rotation** to verify events and versioning

6. **Review event logs** to confirm audit trail

7. **Deploy to mainnet** (after testnet validation)

---

## Monitoring & Maintenance

### Post-Deployment Monitoring

```bash
# Watch for hash rotations
stellar account observe --id $FACTORY \
    --event-filter hash_rotation \
    --network mainnet

# Monitor adoption rate
# (How many new cooperatives use each version?)
for coop in $COOPERATIVE_LIST; do
    version=$(stellar contract invoke --id $FACTORY \
        -- get_cooperative_hash_version --cooperative_id $coop)
    echo "$coop: version $version"
done
```

### Alerting Rules

1. **Unexpected rotation**: Alert if `hash_rotation` event from non-admin account
2. **Failed rotation**: Alert if rotation fails but no explanation
3. **Version drift**: Alert if majority of cooperatives on different versions
4. **Admin compromise**: Alert if unauthorized auth detected

---

## Future Enhancements (Phase 2+)

### Phase 2: Multisig Voting

```rust
pub fn propose_hash_rotation(...) -> Result<String, FactoryError>
pub fn confirm_hash_rotation(proposal_id: &String) -> Result<u32, FactoryError>
```

**Features**:
- M-of-N voting among admin multisig
- Time delays for community review
- Proposal tracking and history

### Phase 3: Staged Rollouts

```rust
pub fn opt_in_upgrade(cooperative_id: &String) -> Result<(), FactoryError>
pub fn schedule_deprecation(version: u32, deprecation_height: u64) -> Result<(), FactoryError>
```

**Features**:
- Cooperative opt-in to new versions
- Gradual migration timeline
- Version deprecation with notice period

### Phase 4: Automated Verification

```rust
pub fn set_expected_hashes(hashes: (BytesN<32>, BytesN<32>, BytesN<32>)) -> Result<(), FactoryError>
```

**Features**:
- On-chain hash commitments
- Cryptographic verification
- Automated alerts if mismatch

---

## Documentation Index

| Document | Purpose |
|----------|---------|
| **WASM_HASH_ROTATION_SPEC.md** | Complete design specification with Phase 1 & 2 roadmap |
| **WASM_HASH_ROTATION_IMPLEMENTATION.md** | Implementation checklist, changes, backward compatibility |
| **WASM_HASH_ROTATION_API.md** | Complete API reference with examples and patterns |
| **WASM_HASH_ROTATION_TESTS.md** | Testing guide with 25+ test descriptions |
| **WASM_HASH_ROTATION_README.md** | This document - quick reference |

---

## Support & Questions

### Common Questions

**Q: Do I need to change my deployment scripts?**
- A: Only add one `set_wasm_hashes` call at factory initialization. Otherwise unchanged.

**Q: Will existing cooperatives break?**
- A: No. They use deployed contract instances. Factory changes don't affect them.

**Q: Can I downgrade to an old WASM version?**
- A: Not in Phase 1. Phase 2 will add selective version support. For now, rotation is one-way.

**Q: What if I make a mistake during rotation?**
- A: Create a new version with correct hashes. Old cooperatives unaffected.

**Q: How do I audit all rotations?**
- A: Query all `hash_rotation` events. Each contains old/new versions and all hashes.

### Getting Help

1. Review the appropriate documentation (see index above)
2. Check test cases in `src/lib.rs` for reference implementations
3. Run tests locally: `cargo test --lib`
4. File issue with: event logs, storage state, error messages

---

## License

Part of the Africanking project. See root LICENSE file.

---

## Implementation Date

Specification: November 2024
Phase 1 Implementation: November 2024
Status: Ready for integration testing

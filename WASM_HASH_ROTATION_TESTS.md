# WASM Hash Rotation - Testing Guide

This document describes the comprehensive test suite for the Phase 1 WASM hash rotation implementation.

## Test Categories

### 1. Initialization (Phase 1 Basic Setup)

#### `test_set_wasm_hashes_initializes_version_1`
- **Objective**: Verify that the first call to `set_wasm_hashes` creates version 1
- **Steps**:
  1. Create a fresh factory
  2. Call `set_wasm_hashes` with three valid WASM hashes
  3. Assert that `get_hash_version()` returns 1
  4. Assert that `get_hashes_at_version(1)` returns the stored hashes
- **Expected Result**: Version incremented to 1, hashes stored with activation ledger height

#### `test_set_wasm_hashes_fails_if_already_set`
- **Objective**: Prevent double-initialization (guards the transition to rotation-based updates)
- **Steps**:
  1. Set hashes once (version 1 created)
  2. Attempt to call `set_wasm_hashes` again
  3. Catch the returned error
- **Expected Result**: `FactoryError::HashesAlreadySet` returned

### 2. Hash Rotation

#### `test_rotate_wasm_hashes_increments_version`
- **Objective**: Verify that rotation increments the version counter
- **Steps**:
  1. Initialize with version 1
  2. Call `rotate_wasm_hashes` with new hashes
  3. Query `get_hash_version()`
- **Expected Result**: Version incremented from 1 to 2

#### `test_rotate_wasm_hashes_stores_history`
- **Objective**: Verify that old hash versions remain available for audit trails
- **Steps**:
  1. Initialize version 1 with token_hash_v1
  2. Rotate to version 2 with token_hash_v2
  3. Query `get_hashes_at_version(1)` → should return token_hash_v1
  4. Query `get_hashes_at_version(2)` → should return token_hash_v2
- **Expected Result**: Both versions available; history preserved

#### `test_rotate_wasm_hashes_requires_admin`
- **Objective**: Ensure only the factory admin can initiate rotation
- **Steps**:
  1. Create factory with admin A
  2. Create caller B (not admin)
  3. Attempt to call `rotate_wasm_hashes` without auth
  4. Verify error
- **Expected Result**: Transaction fails due to missing auth

#### `test_rotate_wasm_hashes_emits_event`
- **Objective**: Verify audit trail with old/new hash details
- **Steps**:
  1. Initialize version 1
  2. Rotate to version 2
  3. Parse emitted event
  4. Verify event contains:
     - `old_version: 1`
     - `new_version: 2`
     - `old_token_hash` (from v1)
     - `new_token_hash` (from v2)
     - `activated_at_ledger` (non-zero)
- **Expected Result**: Event structure matches specification with all required fields

### 3. Hash Versioning in Cooperatives

#### `test_deploy_uses_current_hash_version`
- **Objective**: Verify that new cooperatives use the current active version
- **Steps**:
  1. Deploy coop_1 with version 1 active
  2. Query `get_cooperative_hash_version("coop_1")` → returns 1
  3. Rotate to version 2
  4. Deploy coop_2
  5. Query `get_cooperative_hash_version("coop_2")` → returns 2
- **Expected Result**: Each cooperative records the version it was deployed with

#### `test_multiple_rotations_track_all_versions`
- **Objective**: Ensure complete version history survives multiple rotations
- **Steps**:
  1. Initialize version 1
  2. Rotate to version 2
  3. Rotate to version 3
  4. Query all three versions
- **Expected Result**: All versions 1, 2, 3 available via `get_hashes_at_version()`

#### `test_existing_cooperatives_unaffected_by_rotation`
- **Objective**: Demonstrate backward compatibility — deployed cooperatives continue unchanged
- **Steps**:
  1. Deploy coop_v1 (version 1) → creates token_addr_v1, dist_addr_v1
  2. Record addresses from registry
  3. Rotate factory hashes to version 2
  4. Query registry for coop_v1
  5. Verify addresses are unchanged
  6. Verify coop_v1 still associated with version 1
- **Expected Result**: Cooperative addresses and version unchanged; factory rotation does not affect deployed instances

### 4. Event Emission

#### `test_set_wasm_hashes_emits_event`
- **Objective**: Verify that initialization emits auditable event
- **Steps**:
  1. Call `set_wasm_hashes`
  2. Count events
  3. Filter for `hash_version_activated` symbol
- **Expected Result**: One event with `version: 1` and `event_type: "initialization"`

#### `test_deploy_cooperative_emits_event`
- **Objective**: Verify cooperative deployment records version in event
- **Steps**:
  1. Deploy cooperative
  2. Parse `coop_deployed` event
  3. Verify event contains `hash_version: N`
- **Expected Result**: Event includes the version used for deployment

### 5. Query Functions

#### `test_get_hash_version`
- **Objective**: Query current active version
- **Steps**:
  1. Before init: `get_hash_version()` → `None`
  2. After init: `get_hash_version()` → `Some(1)`
  3. After rotation: `get_hash_version()` → `Some(2)`
- **Expected Result**: Returns correct current version or None

#### `test_get_hashes_at_version`
- **Objective**: Historical hash lookup
- **Steps**:
  1. Query version 1 after init → returns `HashVersionRecord` with correct hashes
  2. Query non-existent version 99 → returns `None`
- **Expected Result**: Returns stored record or None as appropriate

#### `test_get_cooperative_hash_version`
- **Objective**: Determine which WASM version a cooperative uses
- **Steps**:
  1. Deploy cooperative → records version
  2. Query version for cooperative
  3. Query version for non-existent cooperative
- **Expected Result**: Returns version or None

### 6. Backward Compatibility

#### `test_get_wasm_hashes_returns_current_version`
- **Objective**: Verify legacy query function still works
- **Steps**:
  1. Call `get_wasm_hashes()` after init
  2. Assert returns tuple of three hashes (from current version)
- **Expected Result**: Returns hashes from `HashVersionRecord(current_version)`

#### `test_deploy_cooperative_loads_from_version_record`
- **Objective**: Verify deployment uses version-based storage, not deprecated keys
- **Steps**:
  1. Deploy cooperative successfully
  2. Verify via child contract that it has the expected WASM bytecode
- **Expected Result**: Child contracts deployed with hashes from `HashVersionRecord`, not `TokenWasm` key

## Running the Tests

### Build the Contract
```bash
cd apps/contracts/cooperative_factory
cargo build --release --target wasm32v1-none
```

### Run All Tests
```bash
cargo test --lib
```

### Run Specific Test Category
```bash
# Hash rotation tests
cargo test hash_rotation -- --test-threads=1

# Version tracking tests
cargo test cooperative_hash_version -- --test-threads=1

# Event tests
cargo test emits_event -- --test-threads=1
```

### Run with Output
```bash
cargo test -- --nocapture
```

## Test Snapshots

Test snapshots are stored in `test_snapshots/` and capture:
- Event emissions (topics and values)
- Storage state before/after each operation
- Authorization records
- Contract call sequences

These can be reviewed for regression detection if tests are modified.

## Acceptance Criteria Verification

### ✅ Define who may authorize a new approved hash

**Test Evidence**:
- `test_rotate_wasm_hashes_requires_admin` → Only factory admin can rotate
- Authorization model: Single admin in Phase 1, multisig in Phase 2
- Enforced via `admin.require_auth()` in `rotate_wasm_hashes`

### ✅ Emit an auditable event containing old and new hashes and an activation version

**Test Evidence**:
- `test_rotate_wasm_hashes_emits_event` → Event contains:
  - `old_version: u32`
  - `new_version: u32`
  - `old_token_hash: BytesN<32>`
  - `new_token_hash: BytesN<32>`
  - `old_distribution_hash: BytesN<32>`
  - `new_distribution_hash: BytesN<32>`
  - `old_governance_hash: BytesN<32>`
  - `new_governance_hash: BytesN<32>`
  - `activated_at_ledger: u64` (block height for ordering)

### ✅ Ensure already deployed cooperatives are unaffected by factory hash changes

**Test Evidence**:
- `test_existing_cooperatives_unaffected_by_rotation` → Demonstrates:
  - Cooperative addresses persist after factory hash rotation
  - Cooperative instance version recorded at deployment time
  - No auto-upgrade of deployed cooperatives
  - Future deployments use new version; old deployments unmodified

## Performance Considerations

### Storage Keys

The versioning system adds minimal storage overhead:
- `CurrentHashVersion`: 1 key (u32)
- `HashVersionRecord(N)`: 1 key per version (struct with 4 fields: 3×BytesN<32> + u64)
- `CooperativeHashVersion(id)`: 1 key per cooperative (u32)

### Gas Cost Impact

- `set_wasm_hashes`: +1 storage write for version + 1 for record vs original +3 writes
- `rotate_wasm_hashes`: 3 storage writes (version + record + deprecated keys for compatibility)
- `deploy_cooperative`: +1 storage write to record cooperative's version
- Queries: No additional writes

Estimated overhead: **minimal** (~10-15% more gas for initialization, negligible for queries)

## Edge Cases

### Version Overflow
- Rust u32 saturating_add used to prevent panic on u32::MAX rotations
- After 4 billion rotations, version stays at u32::MAX
- **Mitigation**: Acceptable; this is a 100+ year horizon at 1 rotation/week

### Concurrent Rotations
- Stellar's ledger closure prevents concurrent state mutations
- Only one admin can rotate per ledger
- **Result**: Version increments atomically

### Empty Initial Members with Multisig
- Tests verify that `deploy_cooperative` with `required_approvals > 1` requires empty initial_members
- This prevents seeding issues in multisig cooperatives
- Members can be added post-deployment via `add_members_multisig`

## Debugging Tips

### Inspect Version History
```rust
// In tests, query the full version history:
for version in 1..=current_version {
    if let Some(record) = factory.get_hashes_at_version(&version) {
        println!("Version {}: token_hash = {}", version, record.token_wasm_hash);
    }
}
```

### Trace Event Emissions
```rust
let all_events = env.events().all();
for (topics, value) in all_events {
    for topic in topics {
        if let soroban_sdk::Val::Symbol(sym) = topic {
            println!("Event: {:?}", sym);
        }
    }
}
```

### Verify Storage State
```rust
// Check storage keys directly in tests:
let stored_version: Option<u32> = env.storage()
    .instance()
    .get(&DataKey::CurrentHashVersion);
println!("Stored version: {:?}", stored_version);
```

## Regression Testing

After modifying the hash rotation code:

1. **Run full test suite**
   ```bash
   cargo test --lib -- --test-threads=1
   ```

2. **Verify event formats unchanged**
   ```bash
   cargo test --lib emits_event -- --nocapture
   ```

3. **Check backward compatibility**
   ```bash
   cargo test get_wasm_hashes
   ```

4. **Review snapshot changes**
   ```bash
   git diff test_snapshots/
   ```

## Integration Testing

For end-to-end testing on Stellar testnet:

1. Deploy factory contract
2. Call `set_wasm_hashes` to initialize version 1
3. Deploy multiple cooperatives (record their versions and addresses)
4. Query cooperatives in registry (verify addresses match)
5. Call `rotate_wasm_hashes` to create version 2
6. Deploy new cooperatives (verify they use version 2)
7. Query old cooperatives (verify they still use version 1)
8. Query event history (verify rotation events recorded)

## Future Test Enhancements (Phase 2)

- **Multisig Voting Tests**: Proposal/confirmation flow with M-of-N approvals
- **Time-Delay Tests**: Rotations delayed by N blocks for community review
- **Staged Rollout Tests**: Gradual migration of cooperatives to new versions
- **Failure Recovery Tests**: Rollback scenarios if new WASM has bugs

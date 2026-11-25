# WASM Hash Rotation - API Reference

## Function Reference

### Admin Functions

#### `set_wasm_hashes`

Initialize WASM hashes (version 1). **Call this once during factory setup.**

**Signature**:
```rust
pub fn set_wasm_hashes(
    env: Env,
    token_wasm_hash: BytesN<32>,
    distribution_wasm_hash: BytesN<32>,
    governance_wasm_hash: BytesN<32>,
) -> Result<u32, FactoryError>
```

**Parameters**:
- `token_wasm_hash`: SHA-256 hash of compiled `energy_token.wasm`
- `distribution_wasm_hash`: SHA-256 hash of compiled `energy_distribution.wasm`
- `governance_wasm_hash`: SHA-256 hash of compiled `community_governance.wasm`

**Returns**:
- `Ok(1)` - Successfully initialized version 1
- `Err(FactoryError::HashesAlreadySet)` - Already called once; use `rotate_wasm_hashes` for future changes

**Authorization**:
- Requires `admin.require_auth()` (factory admin only)

**Events Emitted**:
```
Topic: hash_version_activated
Data:
  version: u32 = 1
  event_type: Symbol = "initialization"
```

**Example**:
```bash
# Install WASMs on the network first
stellar contract install --source $ADMIN --network testnet \
    --wasm target/wasm32v1-none/release/energy_token.wasm
# Output: TOKEN_HASH

stellar contract install --source $ADMIN --network testnet \
    --wasm target/wasm32v1-none/release/energy_distribution.wasm
# Output: DIST_HASH

stellar contract install --source $ADMIN --network testnet \
    --wasm target/wasm32v1-none/release/community_governance.wasm
# Output: GOV_HASH

# Initialize factory with version 1
stellar contract invoke \
    --id $FACTORY_ID \
    --source $ADMIN \
    --network testnet \
    -- set_wasm_hashes \
    --token_wasm_hash $TOKEN_HASH \
    --distribution_wasm_hash $DIST_HASH \
    --governance_wasm_hash $GOV_HASH
# Output: 1 (version number)
```

**Error Handling**:
```rust
match factory.set_wasm_hashes(&t_hash, &d_hash, &g_hash) {
    Ok(version) => println!("Initialized version {}", version),
    Err(FactoryError::HashesAlreadySet) => {
        println!("Already initialized. Use rotate_wasm_hashes for updates.");
    },
    Err(e) => println!("Error: {:?}", e),
}
```

---

#### `rotate_wasm_hashes`

Update WASM hashes to a new version. **Call this to enable new cooperatives to use upgraded WASM.**

**Signature**:
```rust
pub fn rotate_wasm_hashes(
    env: Env,
    token_wasm_hash: BytesN<32>,
    distribution_wasm_hash: BytesN<32>,
    governance_wasm_hash: BytesN<32>,
) -> Result<u32, FactoryError>
```

**Parameters**: Same as `set_wasm_hashes`

**Returns**:
- `Ok(N)` - New version number (1 → 2 → 3 → ...)
- `Err(FactoryError::WasmHashesNotSet)` - `set_wasm_hashes` not called yet

**Authorization**:
- Requires `admin.require_auth()` (factory admin only)
- Phase 1: Single admin
- Phase 2: Multisig voting

**Events Emitted**:
```
Topic: hash_rotation
Data:
  old_version: u32
  new_version: u32
  old_token_hash: BytesN<32>
  new_token_hash: BytesN<32>
  old_distribution_hash: BytesN<32>
  new_distribution_hash: BytesN<32>
  old_governance_hash: BytesN<32>
  new_governance_hash: BytesN<32>
  activated_at_ledger: u64
```

**Example**:
```bash
# Compile new versions of contracts
cargo build --release --target wasm32v1-none

# Install new WASMs
stellar contract install --source $ADMIN --network testnet \
    --wasm target/wasm32v1-none/release/energy_token.wasm
# Output: NEW_TOKEN_HASH

# ... repeat for distribution and governance ...

# Rotate to new hashes
stellar contract invoke \
    --id $FACTORY_ID \
    --source $ADMIN \
    --network testnet \
    -- rotate_wasm_hashes \
    --token_wasm_hash $NEW_TOKEN_HASH \
    --distribution_wasm_hash $NEW_DIST_HASH \
    --governance_wasm_hash $NEW_GOV_HASH
# Output: 2 (new version number)
```

**When to Call**:
1. **Bug fixes**: When a bug is discovered in deployed WASM
2. **Optimizations**: When performance improvements are available
3. **Feature upgrades**: When new features are ready
4. **Security patches**: After security review completed

**What Changes**:
- ✅ Future deployments use new hashes
- ❌ Existing cooperatives **not affected** (use deployed contracts)
- ✅ All three hashes rotate together (atomic)

**What Stays Same**:
- Existing cooperative addresses
- Existing cooperative functionality
- Registry entries
- Member data in existing cooperatives

---

### Query Functions

#### `get_hash_version`

Get the current active WASM hash version.

**Signature**:
```rust
pub fn get_hash_version(env: Env) -> Option<u32>
```

**Returns**:
- `Some(1)` after first initialization
- `Some(N)` after N-1 rotations
- `None` if `set_wasm_hashes` not called

**Authorization**: None required (read-only)

**Example**:
```bash
stellar contract invoke --id $FACTORY_ID --network testnet -- get_hash_version
# Output: Some(2)
```

```rust
match factory.get_hash_version() {
    Some(version) => println!("Current version: {}", version),
    None => println!("Hashes not initialized"),
}
```

---

#### `get_hashes_at_version`

Look up WASM hashes for a specific historical version.

**Signature**:
```rust
pub fn get_hashes_at_version(
    env: Env,
    version: u32,
) -> Option<HashVersionRecord>
```

**Parameters**:
- `version`: Version number to query (1, 2, 3, ...)

**Returns**:
```rust
Some(HashVersionRecord {
    token_wasm_hash: BytesN<32>,
    distribution_wasm_hash: BytesN<32>,
    governance_wasm_hash: BytesN<32>,
    activated_at_ledger: u64,
})
```
or `None` if version never existed

**Authorization**: None required (read-only)

**Example**:
```rust
// Verify which WASM was used at version 1
if let Some(record) = factory.get_hashes_at_version(&1) {
    println!("Version 1:");
    println!("  Token:        {}", record.token_wasm_hash);
    println!("  Distribution: {}", record.distribution_wasm_hash);
    println!("  Governance:   {}", record.governance_wasm_hash);
    println!("  Activated at ledger: {}", record.activated_at_ledger);
}
```

**Use Cases**:
- Audit trail: "Which WASM was deployed at this ledger height?"
- Version history: "List all WASM versions"
- Verification: "Confirm this hash matches our source code"
- Debugging: "Did a rotation happen?"

---

#### `get_cooperative_hash_version`

Determine which WASM version a specific cooperative uses.

**Signature**:
```rust
pub fn get_cooperative_hash_version(
    env: Env,
    cooperative_id: String,
) -> Option<u32>
```

**Parameters**:
- `cooperative_id`: Cooperative ID string

**Returns**:
- `Some(version)` if cooperative deployed
- `None` if never deployed

**Authorization**: None required (read-only)

**Example**:
```bash
stellar contract invoke --id $FACTORY_ID --network testnet \
    -- get_cooperative_hash_version --cooperative_id "coop-solar-ba"
# Output: Some(1)
```

```rust
// Find all old-version cooperatives
let old_coops = vec!["coop-1", "coop-2"];
for coop_id in old_coops {
    match factory.get_cooperative_hash_version(&String::from_str(&env, coop_id)) {
        Some(version) => println!("{}: version {}", coop_id, version),
        None => println!("{}: not deployed", coop_id),
    }
}
```

**Use Cases**:
- Identify cooperatives using old WASM
- Plan migration strategy
- Audit: "Which version does this cooperative use?"
- Monitoring: "Track upgrade adoption"

---

#### `get_wasm_hashes` (legacy)

Get the currently active WASM hashes (backward compatible).

**Signature**:
```rust
pub fn get_wasm_hashes(env: Env) -> Option<(BytesN<32>, BytesN<32>, BytesN<32>)>
```

**Returns**:
- `Some((token_hash, distribution_hash, governance_hash))` - Current hashes
- `None` - Hashes not initialized

**Authorization**: None required (read-only)

**Example**:
```rust
if let Some((token, dist, gov)) = factory.get_wasm_hashes() {
    println!("Current WASMs:");
    println!("  Token:        {}", token);
    println!("  Distribution: {}", dist);
    println!("  Governance:   {}", gov);
}
```

**Note**: Returns hashes from the current active version. Use `get_hashes_at_version` to access historical versions.

---

#### `get_admin`

Get the factory admin address.

**Signature**:
```rust
pub fn get_admin(env: Env) -> Address
```

**Returns**: The admin address (can call `set_wasm_hashes` and `rotate_wasm_hashes`)

---

#### `get_registry`

Get the cooperative registry address.

**Signature**:
```rust
pub fn get_registry(env: Env) -> Address
```

**Returns**: The registry contract address

---

## Event Reference

### `hash_version_activated`

Emitted by `set_wasm_hashes` during initialization.

**Topics**:
- `hash_version_activated` (Symbol)

**Data**:
```
(
    "version" (Symbol),
    1 (u32),
    "event_type" (Symbol),
    "initialization" (Symbol),
)
```

---

### `hash_rotation`

Emitted by `rotate_wasm_hashes` with full audit trail.

**Topics**:
- `hash_rotation` (Symbol)

**Data**:
```
(
    "old_version" (Symbol),
    1 (u32),
    "new_version" (Symbol),
    2 (u32),
    "old_token_hash" (Symbol),
    <BytesN<32>> (old token hash),
    "new_token_hash" (Symbol),
    <BytesN<32>> (new token hash),
    "old_distribution_hash" (Symbol),
    <BytesN<32>> (old distribution hash),
    "new_distribution_hash" (Symbol),
    <BytesN<32>> (new distribution hash),
    "old_governance_hash" (Symbol),
    <BytesN<32>> (old governance hash),
    "new_governance_hash" (Symbol),
    <BytesN<32>> (new governance hash),
    "activated_at_ledger" (Symbol),
    123456 (u64 ledger sequence),
)
```

---

### `coop_deployed`

Emitted by `deploy_cooperative` (now includes version).

**Topics**:
- `coop_deployed` (Symbol)

**Data**:
```
(
    "cooperative_id" (Symbol),
    "coop-solar-ba" (String),
    "hash_version" (Symbol),
    1 (u32),
    "token_contract" (Symbol),
    <Address>,
    "distribution_contract" (Symbol),
    <Address>,
    "governance_contract" (Symbol),
    <Address>,
)
```

---

## Error Codes

| Code | Error | Cause | Solution |
|------|-------|-------|----------|
| 1 | `WasmHashesNotSet` | `set_wasm_hashes` not called | Call `set_wasm_hashes` first |
| 2 | `InitialMembersRequireSingleApproval` | Initial members with multisig quorum | Use `required_approvals == 1` or empty initial_members |
| 3 | `MemberPercentsMustSum100` | Member percentages don't sum to 100 | Adjust percentages |
| 4 | `InvalidRequiredApprovals` | `required_approvals == 0` | Use at least 1 |
| 5 | `TooManyInitialMembers` | More than 50 initial members | Add remaining members post-deploy |
| 20 | `HashesAlreadySet` | `set_wasm_hashes` called twice | Use `rotate_wasm_hashes` for updates |

---

## Usage Patterns

### Pattern 1: Initial Setup

```rust
// 1. Admin initializes factory with version 1 hashes
let version = factory.set_wasm_hashes(&token_hash, &dist_hash, &gov_hash)?;
assert_eq!(version, 1);

// 2. Deploy cooperatives (all use version 1)
let coop = factory.deploy_cooperative(...)?;

// 3. Verify
assert_eq!(factory.get_hash_version(), Some(1));
assert_eq!(factory.get_cooperative_hash_version(&coop_id), Some(1));
```

### Pattern 2: Hash Rotation

```rust
// 1. Install new WASMs on network
let new_token_hash = /* install new token WASM */;
let new_dist_hash = /* install new distribution WASM */;
let new_gov_hash = /* install new governance WASM */;

// 2. Admin rotates hashes
let new_version = factory.rotate_wasm_hashes(
    &new_token_hash,
    &new_dist_hash,
    &new_gov_hash,
)?;
assert_eq!(new_version, 2);

// 3. New deployments use version 2; old cooperatives unaffected
let new_coop = factory.deploy_cooperative(...)?;
assert_eq!(factory.get_cooperative_hash_version(&new_coop_id), Some(2));

// Old cooperatives still at version 1
assert_eq!(factory.get_cooperative_hash_version(&old_coop_id), Some(1));
```

### Pattern 3: Audit Trail

```rust
// Query version history
for version in 1..=factory.get_hash_version().unwrap_or(0) {
    if let Some(record) = factory.get_hashes_at_version(&version) {
        println!("Version {}: {} at ledger {}", 
            version,
            record.token_wasm_hash,
            record.activated_at_ledger,
        );
    }
}
```

### Pattern 4: Cooperative Inventory

```rust
// Find all cooperatives using old version
let current_version = factory.get_hash_version().unwrap();
for coop_id in &cooperative_list {
    if let Some(version) = factory.get_cooperative_hash_version(&coop_id) {
        if version < current_version {
            println!("Old coop: {} (v{})", coop_id, version);
        }
    }
}
```

---

## Stellar CLI Examples

### Initialize Factory

```bash
# Set up environment
export ADMIN=GXXX...  # Factory admin account
export FACTORY_ID=CXXX...
export NETWORK=testnet

# Install WASMs
TOKEN_HASH=$(stellar contract install \
    --source $ADMIN --network $NETWORK \
    --wasm energy_token.wasm | grep -o 'CXXX.*')
DIST_HASH=$(stellar contract install \
    --source $ADMIN --network $NETWORK \
    --wasm energy_distribution.wasm | grep -o 'CXXX.*')
GOV_HASH=$(stellar contract install \
    --source $ADMIN --network $NETWORK \
    --wasm community_governance.wasm | grep -o 'CXXX.*')

# Initialize version 1
stellar contract invoke \
    --id $FACTORY_ID \
    --source $ADMIN \
    --network $NETWORK \
    -- set_wasm_hashes \
    --token_wasm_hash $TOKEN_HASH \
    --distribution_wasm_hash $DIST_HASH \
    --governance_wasm_hash $GOV_HASH
```

### Rotate Hashes

```bash
# Install new WASMs
NEW_TOKEN=$(stellar contract install \
    --source $ADMIN --network $NETWORK \
    --wasm energy_token_v2.wasm | grep -o 'CXXX.*')

# ... install dist and gov similarly ...

# Rotate
stellar contract invoke \
    --id $FACTORY_ID \
    --source $ADMIN \
    --network $NETWORK \
    -- rotate_wasm_hashes \
    --token_wasm_hash $NEW_TOKEN \
    --distribution_wasm_hash $NEW_DIST \
    --governance_wasm_hash $NEW_GOV
```

### Query Versions

```bash
# Get current version
stellar contract invoke \
    --id $FACTORY_ID \
    --network $NETWORK \
    -- get_hash_version

# Get hashes at version 1
stellar contract invoke \
    --id $FACTORY_ID \
    --network $NETWORK \
    -- get_hashes_at_version --version 1

# Get cooperative version
stellar contract invoke \
    --id $FACTORY_ID \
    --network $NETWORK \
    -- get_cooperative_hash_version --cooperative_id "coop-solar-ba"
```

---

## Type Reference

### `HashVersionRecord`

```rust
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct HashVersionRecord {
    pub token_wasm_hash: BytesN<32>,
    pub distribution_wasm_hash: BytesN<32>,
    pub governance_wasm_hash: BytesN<32>,
    pub activated_at_ledger: u64,
}
```

**Fields**:
- `token_wasm_hash`: SHA-256 of energy_token.wasm
- `distribution_wasm_hash`: SHA-256 of energy_distribution.wasm
- `governance_wasm_hash`: SHA-256 of community_governance.wasm
- `activated_at_ledger`: Ledger sequence number when activated

---

## Best Practices

### ✅ DO

1. **Initialize once per factory**
   ```rust
   // Good
   factory.set_wasm_hashes(&h1, &h2, &h3)?;  // Once
   ```

2. **Use rotate_wasm_hashes for updates**
   ```rust
   // Good
   factory.rotate_wasm_hashes(&new_h1, &new_h2, &new_h3)?;
   ```

3. **Verify before rotating**
   ```rust
   // Good - Verify current version first
   let current = factory.get_hash_version();
   let new_version = factory.rotate_wasm_hashes(...)?;
   ```

4. **Monitor rotation events**
   ```
   // Good - Watch for hash_rotation events
   Listen for: Topic = "hash_rotation"
   Extract: old_version, new_version, all hashes
   Alert: If unexpected rotation detected
   ```

5. **Record version at deployment**
   ```rust
   // Good - Version automatically recorded in deploy_cooperative event
   let version = factory.get_cooperative_hash_version(&id)?;
   ```

### ❌ DON'T

1. **Don't call set_wasm_hashes twice**
   ```rust
   // Bad - Will fail
   factory.set_wasm_hashes(&h1, &h2, &h3)?;
   factory.set_wasm_hashes(&h1, &h2, &h3)?;  // Error!
   ```

2. **Don't expect old cooperatives to upgrade**
   ```rust
   // Bad assumption
   factory.rotate_wasm_hashes(...)?;
   // Old cooperative still uses old WASM!
   ```

3. **Don't rotate all hashes independently**
   ```rust
   // Bad - Must rotate all three together
   factory.rotate_wasm_hashes(&new_token, &old_dist, &old_gov)?;
   // If this succeeds, inconsistency possible
   ```

4. **Don't ignore rotation events**
   ```
   // Bad - No audit trail
   Off-chain system: Doesn't monitor hash_rotation events
   Risk: Undetected unauthorized rotation
   ```

5. **Don't deploy with invalid hashes**
   ```bash
   # Bad - Hash must be pre-installed on network
   stellar contract invoke -- rotate_wasm_hashes \
       --token_wasm_hash INVALID_HASH
   # Deployment will fail when WASM referenced
   ```

---

## Troubleshooting

### "WasmHashesNotSet"
**Cause**: `set_wasm_hashes` not called yet
**Solution**: Initialize first
```bash
stellar contract invoke --id $FACTORY_ID -- set_wasm_hashes ...
```

### "HashesAlreadySet"
**Cause**: Tried to call `set_wasm_hashes` twice
**Solution**: Use `rotate_wasm_hashes` for updates
```bash
stellar contract invoke --id $FACTORY_ID -- rotate_wasm_hashes ...
```

### "Authorization failed"
**Cause**: Not admin or missing signature
**Solution**: Use admin account for rotation
```bash
stellar contract invoke --id $FACTORY_ID --source $ADMIN -- rotate_wasm_hashes ...
```

### "MemberPercentsMustSum100"
**Cause**: Initial member percentages invalid
**Solution**: Ensure percentages sum to exactly 100
```rust
let members = vec![
    Member { address: a1, percent: 60 },  // 60 + 40 = 100 ✓
    Member { address: a2, percent: 40 },
];
```

---

## Support

For questions or issues:
1. Review `WASM_HASH_ROTATION_SPEC.md` for design details
2. Check `WASM_HASH_ROTATION_TESTS.md` for examples
3. Examine test cases in `src/lib.rs` for reference implementations
4. File an issue with event logs and storage state

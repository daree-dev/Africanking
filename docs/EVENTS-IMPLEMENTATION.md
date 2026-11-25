# Event Implementation Guide

> Reference implementation details for consuming Africanking events on Stellar.

**Version:** 1.0  
**Contracts Updated:** energy_token, energy_distribution, community_governance, cooperative_factory (v1.0)

---

## Summary of Changes

All four contracts now emit stable, indexed events for off-chain reconstruction.

| Contract | Events Added | Fields in Payload | Indexed Topics |
|----------|--------------|-------------------|-----------------|
| energy_distribution | member_added, member_removed, generation_recorded, contract_paused, contract_unpaused | 6–7 | 2–3 |
| energy_token | token_minted, token_burned, minter_granted, minter_revoked, contract_paused, contract_unpaused | 5–6 | 2–3 |
| cooperative_factory | cooperative_deployed | 7 | 1 |
| community_governance | proposal_created | 5 | 2–3 |

---

## Implementation Details by Contract

### energy_distribution Contract

#### `member_added` Event

**When:** Emitted for each member during `add_members_multisig()`.

**Indexed Topics:**
1. Event discriminator: `"member_added"` (Symbol)
2. `distribution_contract_id` (Address)
3. `member_address` (Address)

**Payload Fields:**
```rust
(
    distribution_contract: Address,
    member_address: Address,
    percent: u32,
    batch_sequence: u32,
    batch_total: u32,
    timestamp_ledger: u64,
)
```

**Code Location:** `energy_distribution/src/lib.rs`, `add_members_multisig()` method, loop around line ~80.

**Indexer Usage:**
- Query by distribution_contract to list all current members
- Query by member_address to find all cooperatives a person belongs to
- Use batch_sequence + batch_total to atomically process member replacements

---

#### `member_removed` Event

**When:** Emitted for each old member when `add_members_multisig()` replaces the member set.

**Indexed Topics:**
1. Event discriminator: `"member_removed"` (Symbol)
2. `distribution_contract_id` (Address)
3. `member_address` (Address)

**Payload Fields:**
```rust
(
    distribution_contract: Address,
    member_address: Address,
    timestamp_ledger: u64,
)
```

**Indexer Usage:**
- Marks member as inactive/removed
- Correlates with subsequent `member_added` events (atomic batch)

---

#### `generation_recorded` Event

**When:** Emitted once per call to `record_generation()`.

**Indexed Topics:**
1. Event discriminator: `"generation_recorded"` (Symbol)
2. `distribution_contract_id` (Address)

**Payload Fields:**
```rust
(
    distribution_contract: Address,
    kwh_generated: i128,
    allocation: Vec<(Address, u32, i128)>,  // (member, percent, tokens_minted)
    total_tokens_minted: i128,
    timestamp_ledger: u64,
)
```

**Indexer Usage:**
- Accumulate `kwh_generated` by cooperative for monthly/yearly reports
- Track member earnings per distribution event
- Verify: `sum(allocation[].tokens_minted) == total_tokens_minted`
- Correlate with current member list to flag anomalies

---

#### `contract_paused` Event

**When:** Emitted during `pause()` (Pausable trait).

**Indexed Topics:**
1. Event discriminator: `"contract_paused"` (Symbol)
2. `distribution_contract_id` (Address)

**Payload Fields:**
```rust
(
    contract_address: Address,
    paused_by: Address,
    reason: Symbol,  // e.g., "admin_pause"
    timestamp_ledger: u64,
)
```

---

#### `contract_unpaused` Event

**When:** Emitted during `unpause()` (Pausable trait).

**Indexed Topics:**
1. Event discriminator: `"contract_unpaused"` (Symbol)
2. `distribution_contract_id` (Address)

**Payload Fields:**
```rust
(
    contract_address: Address,
    unpaused_by: Address,
    timestamp_ledger: u64,
)
```

---

### energy_token Contract

#### `token_minted` Event

**When:** Emitted during `mint_energy()` (called by distribution contract).

**Indexed Topics:**
1. Event discriminator: `"token_minted"` (Symbol)
2. `token_contract_id` (Address)
3. `to_address` (Address)

**Payload Fields:**
```rust
(
    token_contract: Address,
    to: Address,
    amount: i128,
    minter: Address,
    cooperative_id: String,
    timestamp_ledger: u64,
)
```

**Indexer Usage:**
- Track member earning history (member → token amounts minted)
- Verify source (should always be distribution_contract for energy generation)

---

#### `token_burned` Event

**When:** Emitted during `burn_energy()` (manual burn by holder).

**Indexed Topics:**
1. Event discriminator: `"token_burned"` (Symbol)
2. `token_contract_id` (Address)
3. `from_address` (Address)

**Payload Fields:**
```rust
(
    token_contract: Address,
    from: Address,
    amount: i128,
    cooperative_id: String,
    reason: Symbol,  // e.g., "retirement"
    timestamp_ledger: u64,
)
```

**Indexer Usage:**
- Track certificate retirements
- Correlate with minting for member balance reconciliation

---

#### `minter_granted` Event

**When:** Emitted during `grant_minter()`.

**Indexed Topics:**
1. Event discriminator: `"minter_granted"` (Symbol)
2. `token_contract_id` (Address)
3. `minter_address` (Address)

**Payload Fields:**
```rust
(
    token_contract: Address,
    minter: Address,
    granted_by: Address,
    cooperative_id: String,
    timestamp_ledger: u64,
)
```

---

#### `minter_revoked` Event

**When:** Emitted during `revoke_minter()`.

**Indexed Topics:**
1. Event discriminator: `"minter_revoked"` (Symbol)
2. `token_contract_id` (Address)
3. `minter_address` (Address)

**Payload Fields:**
```rust
(
    token_contract: Address,
    minter: Address,
    revoked_by: Address,
    cooperative_id: String,
    timestamp_ledger: u64,
)
```

---

#### `contract_paused` and `contract_unpaused` (EnergyToken)

Same format as energy_distribution, but indexed by token_contract_id instead of distribution_contract_id.

---

### cooperative_factory Contract

#### `cooperative_deployed` Event

**When:** Emitted once at the end of `deploy_cooperative()`.

**Indexed Topics:**
1. Event discriminator: `"cooperative_deployed"` (Symbol)

**Payload Fields:**
```rust
(
    cooperative_id: String,
    token_contract: Address,
    distribution_contract: Address,
    governance_contract: Address,
    admin: Address,
    token_name: String,
    token_symbol: String,
    required_approvals: u32,
    initial_members_count: u32,
    timestamp_ledger: u64,
)
```

**Indexer Usage:**
- Primary entry point for indexer: query all `cooperative_deployed` events
- Maps cooperative_id to all three contract addresses
- Establishes baseline admin, approval quorum, member count

---

#### `wasm_updated` Event

**When:** Emitted during `set_wasm_hashes()`.

**Indexed Topics:**
1. Event discriminator: `"wasm_updated"` (Symbol)

**Payload Fields:**
```rust
(
    token_wasm_hash: BytesN<32>,
    distribution_wasm_hash: BytesN<32>,
    governance_wasm_hash: BytesN<32>,
    updated_by: Address,
    timestamp_ledger: u64,
)
```

---

### community_governance Contract

#### `proposal_created` Event

**When:** Emitted during `create_proposal()`.

**Indexed Topics:**
1. Event discriminator: `"proposal_created"` (Symbol)
2. `governance_contract_id` (Address)
3. `proposer_address` (Address)

**Payload Fields:**
```rust
(
    governance_contract: Address,
    proposal_id: u32,
    proposer: Address,
    title: String,
    timestamp_ledger: u64,
)
```

**Indexer Usage:**
- Track proposals per cooperative
- Link to member base (verify proposer is a member)

---

## Code Locations

### Where Events Are Emitted

**energy_distribution/src/lib.rs:**
- Line ~82–110: `member_added` events in loop
- Line ~63–70: `member_removed` events in loop
- Line ~125–145: `generation_recorded` event
- Line ~185–215: `contract_paused` / `contract_unpaused` events

**energy_token/src/lib.rs:**
- Line ~65–85: `token_minted` event
- Line ~93–113: `token_burned` event
- Line ~125–145: `minter_granted` event
- Line ~160–180: `minter_revoked` event
- Line ~240–270: `contract_paused` / `contract_unpaused` events

**cooperative_factory/src/lib.rs:**
- Line ~290–310: `cooperative_deployed` event (at end of function)
- Line ~185–195: `wasm_updated` event

**community_governance/src/lib.rs:**
- Line ~65–85: `proposal_created` event

---

## Event Payload Serialization

All events are published using Soroban's `env.events().publish()`:

```rust
env.events().publish(
    (topic_0, topic_1, topic_2, ...),
    (field1, field2, field3, ...)
);
```

**Topics (indexed):**
- Always Symbols or Addresses (hashable types)
- Used for fast filtering

**Data Payload (not indexed):**
- Can be any Soroban type: primitives, Vecs, Structs, Addresses, Strings, etc.
- Automatically serialized to XDR binary when logged

---

## Querying Events from Stellar RPC

### Using js-stellar-sdk

```javascript
import { Server } from "@stellar-sdk";

const server = new Server("https://soroban-testnet.stellar.org");

// Query events for a contract
const events = await server
  .getEvents({
    filters: [
      {
        type: "contract",
        contractIds: ["CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC5"],
      },
    ],
  })
  .call();

// Filter by event type name
const memberAdded = events.records.filter((e) => {
  return (
    e.type === "contract" &&
    e.contractEvent &&
    e.contractEvent.topic &&
    e.contractEvent.topic[0] === "AAAADwAAAAZtZW1iZXJfYWRkZWQ=" // base64("member_added")
  );
});
```

### Decoding Payloads

Payloads are XDR-encoded. Use `SorobanDataBuilder` or `xdr` library:

```javascript
const xdr = require("stellar-base");

const eventData = events.records[0].contractEvent.data;
const decoded = xdr.ScVal.fromXDR(eventData, "base64");
// decoded is now a ScVal structure
// Extract fields using decoded.struct() or decoded.vec() etc.
```

---

## Validation Checks

Indexers should perform these checks for data integrity:

### For `member_added`

```
✓ batch_sequence < batch_total
✓ sum(all percent in batch) == 100
✓ member_address != 0x0
✓ contract address matches known distribution contract
```

### For `generation_recorded`

```
✓ allocation.length > 0
✓ sum(allocation[].percent) == 100
✓ sum(allocation[].tokens_minted) == total_tokens_minted
✓ Each member in allocation exists in current member list (or flag anomaly)
```

### For `token_minted`

```
✓ amount > 0
✓ to != 0x0
✓ minter == distribution_contract (or flag unusual minter)
✓ token_contract address matches expected cooperative token
```

---

## Migration from Pre-Event Contracts

If indexing a cooperative deployed with an older contract version (before this event spec):

1. **Query contract state directly:**
   ```javascript
   const members = await distributionContract.get_member_list();
   const totalGenerated = await distributionContract.get_total_generated();
   ```

2. **Establish baseline in indexer:**
   - Create a "legacy_deployment" record (pre-event)
   - Populate members and generation from on-chain state

3. **Switch to event-driven updates:**
   - After contract is upgraded or redeploys, all updates come from events

---

## Future Extensions

### Planned Events (v1.1+)

- `membership_percent_changed` — if membership updates support in-place percent changes
- `token_transferred` — index SEP-41 Transfer events
- `proposal_voted` — when voting is implemented
- `proposal_finalized` — when voting reaches quorum
- `fee_distributed` — if cooperative fee model is added

### Breaking Changes (v2.0+)

- Event names are locked for v1
- Any format change requires a new version (e.g., `member_added_v2`)
- Old version continues to be emitted alongside new version for 2–3 contract releases

---

## Troubleshooting

### Events not appearing in RPC

**Symptom:** `getEvents()` returns empty list  
**Checks:**
1. Contract address is correct (double-check format)
2. Function that emits event actually executed (check on-chain state changed)
3. Ledger block is not too old (Soroban events have TTL)
4. RPC endpoint is synced (try `getLatestLedger()`)

### Payload decode fails

**Symptom:** XDR decode errors  
**Checks:**
1. Use correct XDR schema (match Soroban version)
2. Event data not empty (some RPC versions return null for empty payloads)
3. Field order matches contract code (struct fields are ordered in XDR)

### Member allocation sums don't match

**Symptom:** `sum(tokens_minted) != total_tokens_minted`  
**Cause:** Integer division rounding (100 kWh / 3 members = 33 + 33 + 33 = 99)  
**Fix:** Expect rounding in indexer, verify within tolerance (e.g., ±1 stroop)

---

## Deployment Checklist

Before releasing this event spec:

- [ ] All four contract types emit events (token, distribution, governance, factory)
- [ ] Events tested in Soroban testnet
- [ ] Payloads are deterministic (no randomness, no timestamp variations)
- [ ] Event names are finalized (no future renaming v1 → v2 without deprecation)
- [ ] Off-chain indexer code passes all fixtures
- [ ] RPC queries return complete events within reasonable latency
- [ ] Documentation published for indexer developers


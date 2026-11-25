# Stable Event Formats & Versioning

> Off-chain APIs need stable event formats to reconstruct cooperative, member allocation, and transaction history.

**Last Updated:** November 2025  
**Version:** 1.0  
**Contracts:** `energy_token`, `energy_distribution`, `community_governance`, `cooperative_factory`

---

## Table of Contents

1. [Design Principles](#design-principles)
2. [Event Versioning Strategy](#event-versioning-strategy)
3. [Event Catalog](#event-catalog)
4. [Indexing Patterns](#indexing-patterns)
5. [Data Reconstruction Examples](#data-reconstruction-examples)
6. [Testing Strategy](#testing-strategy)

---

## Design Principles

### 1. Off-Chain Reconstruction
Events must contain sufficient data for off-chain APIs to rebuild the full state of:
- **Cooperative registry** (which cooperatives exist, their contracts)
- **Member allocation** (who belongs to which cooperative, their ownership %)
- **Generation history** (kwh per cooperative, per period)
- **Transaction ledger** (token movements, burns, member changes)

### 2. Topic Indexing
Each event's first topic (Topic[0]) is a *discriminator* that identifies the event type uniquely, enabling efficient filtering by indexers.

Indexed topics:
- **Topic[0]**: Event discriminator (e.g., `keccak256("member_added")` truncated or just symbol)
- **Topic[1] (optional)**: Primary aggregate (e.g., `cooperative_id`, `member_address`)
- **Topic[2] (optional)**: Secondary aggregate (e.g., `distribution_contract`)

### 3. No External Validation
Events must be **self-contained**: an indexer should not need to call the contract to verify or reconstruct state. All relevant context is in the event payload.

### 4. Version Stability
Once a version is published, **the format is frozen**. Breaking changes get new event names (e.g., `member_added_v2`) or new contracts. This prevents indexers from breaking.

---

## Event Versioning Strategy

### Single Versioning per Event Type

Each event type gets ONE version identifier at definition. Events do NOT carry a version field — the version is part of the event name.

**Examples:**
- `coop_deployed` (v1) — immutable after release
- If breaking changes are needed: `coop_deployed_v2` (new event, different format)

### Version Numbering
- v1 = first stable release
- v2, v3, ... = breaking changes only
- Non-breaking changes (new optional fields) stay at current version

### Deprecation Path
1. New version introduced alongside old version
2. Old version still emitted for 1–2 contract versions (deprecated flag in docs)
3. Old version removed in major contract update

---

## Event Catalog

### Energy Distribution Contract

#### `member_added`
- **Event Name:** `member_added`
- **Emitted by:** `EnergyDistribution::add_members_multisig()`
- **Topic[0]:** `keccak256("member_added")`
- **Topic[1]:** `distribution_contract_id` (address, indexed)
- **Topic[2]:** `member_address` (address, indexed)
- **Payload:**
  ```json
  {
    "distribution_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    "member_address": "GBRPYHIL2CI3FIQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW2QC6GEDI",
    "percent": 60,
    "batch_sequence": 0,
    "batch_total": 2,
    "timestamp_ledger": 1234567
  }
  ```
- **Indexing Strategy:**
  - By `distribution_contract` → list all members of a cooperative
  - By `member_address` → find all cooperatives a person belongs to
  - `batch_sequence` + `batch_total` → atomically process multi-member adds
- **Reconstruction:** Indexer maintains a table: `(distribution_contract, member_address) → percent`. This state should match `get_member_list()` on-chain.

---

#### `member_removed`
- **Event Name:** `member_removed`
- **Emitted by:** `EnergyDistribution::add_members_multisig()` (when members are replaced/updated)
- **Topic[0]:** `keccak256("member_removed")`
- **Topic[1]:** `distribution_contract_id` (address, indexed)
- **Topic[2]:** `member_address` (address, indexed)
- **Payload:**
  ```json
  {
    "distribution_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    "member_address": "GBRPYHIL2CI3FIQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW2QC6GEDI",
    "timestamp_ledger": 1234568
  }
  ```
- **Indexing Strategy:** Remove entries from the indexer's member table.
- **Atomicity:** `member_removed` events for the old member set, then `member_added` for the new set, all in the same transaction.

---

#### `generation_recorded`
- **Event Name:** `generation_recorded`
- **Emitted by:** `EnergyDistribution::record_generation()`
- **Topic[0]:** `keccak256("generation_recorded")`
- **Topic[1]:** `distribution_contract_id` (address, indexed)
- **Payload:**
  ```json
  {
    "distribution_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    "kwh_generated": 1000000000,
    "allocation": [
      {
        "member_address": "GBRPYHIL2CI3FIQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW2QC6GEDI",
        "percent": 60,
        "tokens_minted": 600000000
      },
      {
        "member_address": "GBSAY3V5SPQPYOVRN5BYDSGC6ETYQ7P74CBIHZXUXVXCHMPCVZ2X2BAN",
        "percent": 40,
        "tokens_minted": 400000000
      }
    ],
    "total_tokens_minted": 1000000000,
    "timestamp_ledger": 1234569
  }
  ```
- **Indexing Strategy:**
  - Accumulate `kwh_generated` by cooperative for monthly/yearly reports
  - Track token allocation per member per distribution event
  - Verify: `sum(allocation[].tokens_minted) == total_tokens_minted`
- **Reconstruction:**
  - Query events by `distribution_contract` to build generation timeline
  - Correlate with `member_added`/`member_removed` to understand who received what

---

#### `contract_paused`
- **Event Name:** `contract_paused`
- **Emitted by:** `Pausable::pause()`
- **Topic[0]:** `keccak256("contract_paused")`
- **Topic[1]:** `distribution_contract_id` (address, indexed)
- **Payload:**
  ```json
  {
    "contract_address": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    "paused_by": "GBRPYHIL2CI3FIQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW2QC6GEDI",
    "reason": "emergency_circuit_breaker",
    "timestamp_ledger": 1234570
  }
  ```
- **Indexing Strategy:** Mark cooperative as paused; block new member/generation operations until `contract_unpaused`.

---

#### `contract_unpaused`
- **Event Name:** `contract_unpaused`
- **Emitted by:** `Pausable::unpause()`
- **Topic[0]:** `keccak256("contract_unpaused")`
- **Topic[1]:** `distribution_contract_id` (address, indexed)
- **Payload:**
  ```json
  {
    "contract_address": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    "unpaused_by": "GBRPYHIL2CI3FIQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW2QC6GEDI",
    "timestamp_ledger": 1234571
  }
  ```

---

#### `contract_upgraded`
- **Event Name:** `contract_upgraded`
- **Emitted by:** `Upgradeable::upgrade()`
- **Topic[0]:** `keccak256("contract_upgraded")`
- **Topic[1]:** `distribution_contract_id` (address, indexed)
- **Payload:**
  ```json
  {
    "contract_address": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    "old_wasm_hash": "0x1234...abcd",
    "new_wasm_hash": "0x5678...efgh",
    "upgraded_by": "GBRPYHIL2CI3FIQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW2QC6GEDI",
    "timestamp_ledger": 1234572
  }
  ```

---

### Energy Token Contract

#### `token_minted`
- **Event Name:** `token_minted`
- **Emitted by:** `EnergyToken::mint_energy()`
- **Topic[0]:** `keccak256("token_minted")`
- **Topic[1]:** `token_contract_id` (address, indexed)
- **Topic[2]:** `to_address` (address, indexed)
- **Payload:**
  ```json
  {
    "token_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    "to": "GBRPYHIL2CI3FIQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW2QC6GEDI",
    "amount": 600000000,
    "minter": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC5",
    "cooperative_id": "coop-buenos-aires",
    "timestamp_ledger": 1234569
  }
  ```
- **Indexing Strategy:** Track token movements to build member's generation reward history.

---

#### `token_burned`
- **Event Name:** `token_burned`
- **Emitted by:** `EnergyToken::burn_energy()`
- **Topic[0]:** `keccak256("token_burned")`
- **Topic[1]:** `token_contract_id` (address, indexed)
- **Topic[2]:** `from_address` (address, indexed)
- **Payload:**
  ```json
  {
    "token_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    "from": "GBRPYHIL2CI3FIQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW2QC6GEDI",
    "amount": 600000000,
    "cooperative_id": "coop-buenos-aires",
    "reason": "certificate_retired",
    "timestamp_ledger": 1234600
  }
  ```
- **Indexing Strategy:** Track certificate retirements; correlate with token minting for bookkeeping.

---

#### `minter_granted`
- **Event Name:** `minter_granted`
- **Emitted by:** `EnergyToken::grant_minter()`
- **Topic[0]:** `keccak256("minter_granted")`
- **Topic[1]:** `token_contract_id` (address, indexed)
- **Topic[2]:** `minter_address` (address, indexed)
- **Payload:**
  ```json
  {
    "token_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    "minter": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC5",
    "granted_by": "GBRPYHIL2CI3FIQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW2QC6GEDI",
    "cooperative_id": "coop-buenos-aires",
    "timestamp_ledger": 1234573
  }
  ```

---

#### `minter_revoked`
- **Event Name:** `minter_revoked`
- **Emitted by:** `EnergyToken::revoke_minter()`
- **Topic[0]:** `keccak256("minter_revoked")`
- **Topic[1]:** `token_contract_id` (address, indexed)
- **Topic[2]:** `minter_address` (address, indexed)
- **Payload:**
  ```json
  {
    "token_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    "minter": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC5",
    "revoked_by": "GBRPYHIL2CI3FIQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW2QC6GEDI",
    "cooperative_id": "coop-buenos-aires",
    "timestamp_ledger": 1234574
  }
  ```

---

#### `contract_paused` (EnergyToken)
- Same format as Energy Distribution `contract_paused`, but for token contract.

---

#### `contract_unpaused` (EnergyToken)
- Same format as Energy Distribution `contract_unpaused`, but for token contract.

---

#### `contract_upgraded` (EnergyToken)
- Same format as Energy Distribution `contract_upgraded`, but for token contract.

---

### Cooperative Factory Contract

#### `cooperative_deployed`
- **Event Name:** `cooperative_deployed`
- **Emitted by:** `CooperativeFactory::deploy_cooperative()`
- **Topic[0]:** `keccak256("cooperative_deployed")`
- **Topic[1]:** `cooperative_id` (string, hashed to `bytes32` for indexing)
- **Payload:**
  ```json
  {
    "cooperative_id": "coop-buenos-aires",
    "token_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    "distribution_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC5",
    "governance_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC6",
    "admin": "GBRPYHIL2CI3FIQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW2QC6GEDI",
    "token_name": "CoopSolar Buenos Aires",
    "token_symbol": "CSBA",
    "required_approvals": 1,
    "initial_members_count": 2,
    "timestamp_ledger": 1234565
  }
  ```
- **Indexing Strategy:**
  - Maps `cooperative_id` → all three contract addresses (lookup table)
  - Entry point for indexer: query all `cooperative_deployed` to build registry
  - Verify: query all `generation_recorded` for each `distribution_contract`

---

#### `wasm_updated`
- **Event Name:** `wasm_updated`
- **Emitted by:** `CooperativeFactory::set_wasm_hashes()`
- **Topic[0]:** `keccak256("wasm_updated")`
- **Payload:**
  ```json
  {
    "token_wasm_hash": "0x1234...abcd",
    "distribution_wasm_hash": "0x5678...efgh",
    "governance_wasm_hash": "0x9abc...ijkl",
    "updated_by": "GBRPYHIL2CI3FIQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW2QC6GEDI",
    "timestamp_ledger": 1234564
  }
  ```
- **Indexing Strategy:** Audit trail for WASM upgrades on the factory (less critical, mainly for security review).

---

### Community Governance Contract

#### `proposal_created`
- **Event Name:** `proposal_created`
- **Emitted by:** `CommunityGovernance::create_proposal()`
- **Topic[0]:** `keccak256("proposal_created")`
- **Topic[1]:** `governance_contract_id` (address, indexed)
- **Topic[2]:** `proposer_address` (address, indexed)
- **Payload:**
  ```json
  {
    "governance_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC6",
    "proposal_id": 1,
    "proposer": "GBRPYHIL2CI3FIQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW2QC6GEDI",
    "title": "Approve Q1 2026 budget allocation",
    "timestamp_ledger": 1234590
  }
  ```

---

#### `proposal_voted`
- **Event Name:** `proposal_voted` (future)
- **Emitted by:** `CommunityGovernance::vote()` (not yet implemented)
- **Topic[0]:** `keccak256("proposal_voted")`
- **Topic[1]:** `governance_contract_id` (address, indexed)
- **Topic[2]:** `voter_address` (address, indexed)
- **Payload:**
  ```json
  {
    "governance_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC6",
    "proposal_id": 1,
    "voter": "GBRPYHIL2CI3FIQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW2QC6GEDI",
    "in_favor": true,
    "timestamp_ledger": 1234591
  }
  ```

---

## Indexing Patterns

### Pattern 1: Cooperative Registry Reconstruction
```
Events: cooperative_deployed
Query: ALL cooperative_deployed events (sorted by timestamp_ledger)
Result:
  cooperative_id → {
    token_contract,
    distribution_contract,
    governance_contract,
    admin,
    created_at: timestamp_ledger
  }
```

### Pattern 2: Member Allocation Snapshot
```
Events: member_added, member_removed, generation_recorded
Query: ALL member_added + member_removed for distribution_contract X
Result:
  distribution_contract → {
    members: [
      { address, percent, added_at, removed_at (or null) },
      ...
    ]
  }
```

### Pattern 3: Generation Timeline
```
Events: generation_recorded (filtered by distribution_contract)
Query: ALL generation_recorded for distribution_contract X (sorted by timestamp_ledger)
Result:
  generation_timeline: [
    { kwh, allocation, timestamp_ledger },
    ...
  ]
  total_kwh = SUM(generation_recorded.kwh_generated)
  per_member_total = SUM(allocation[member].tokens_minted)
```

### Pattern 4: Member Earning History
```
Events: token_minted (filtered by token_contract and to_address)
Query: ALL token_minted for to_address Y
Result:
  member_earnings: [
    { amount, source (minter), timestamp_ledger },
    ...
  ]
  total_earned = SUM(token_minted.amount)
```

### Pattern 5: Contract State Machine
```
Events: contract_paused, contract_unpaused, contract_upgraded
Query: ALL pause/unpause/upgrade events for contract X (sorted by timestamp_ledger)
Result:
  current_state: paused | active
  wasm_history: [ { version, timestamp_ledger }, ... ]
```

---

## Data Reconstruction Examples

### Scenario 1: Indexer Syncs from Block 0

**Step 1: Build Registry**
```
SELECT * FROM events WHERE type='cooperative_deployed'
→ Populates: cooperatives[coop_id] = { token, distribution, governance, admin }
```

**Step 2: Build Member Allocation**
```
FOR EACH cooperative:
  SELECT * FROM events 
    WHERE type IN ('member_added', 'member_removed')
    AND distribution_contract = coop.distribution_contract
    ORDER BY timestamp_ledger ASC
  → Populates: members[distribution_contract][address] = { percent, active_since, removed_at }
```

**Step 3: Build Generation History**
```
FOR EACH cooperative:
  SELECT * FROM events 
    WHERE type='generation_recorded'
    AND distribution_contract = coop.distribution_contract
    ORDER BY timestamp_ledger ASC
  → Populates: generation[coop_id] = [ { kwh, allocation, timestamp } ]
```

### Scenario 2: Off-Chain API Rebuilds Member State After Contract Upgrade

```
Query events:
  1. cooperative_deployed → find distribution_contract address
  2. member_added + member_removed → build member list
  3. contract_upgraded → verify WASM matches expected version
  4. generation_recorded → verify member allocations match current member list

Anomalies to flag:
  - generation_recorded.allocation includes members not in current member list
  - member_removed happened after last generation
  - required_approvals changed (not supported yet)
```

---

## Testing Strategy

### Test 1: Event Emission Correctness
- Verify each operation emits the correct event with correct payload
- Check that all indexed topics are set
- Validate payload field types and ranges

### Test 2: Event Atomicity
- When `add_members_multisig()` replaces member set:
  - All old members get `member_removed` in one transaction
  - All new members get `member_added` in one transaction
  - Indexer sees atomic swap, not intermediate states

### Test 3: Indexer Fixtures
- Provide off-chain reproducible event sequences for each cooperative operation
- Verify indexer can rebuild state from fixtures

### Test 4: Backward Compatibility
- If a contract upgrade changes event format, verify:
  - Old version events are still indexed correctly
  - New version events have same/compatible topics
  - Indexer migration path is documented

---

## Implementation Notes

### In Contracts

1. Use `env.events().publish()` to emit events in Soroban
2. Event name = first argument to `publish()` as Symbol
3. Indexed topics = second argument tuple
4. Data payload = third argument (can be a struct)
5. All timestamps in events use `env.ledger().timestamp()` (block ledger time, not unix time)

### In Indexer

1. Poll Stellar RPC or use event stream subscription
2. Filter events by contract address and event name
3. Decode payloads from event data
4. Write to indexing database (SQL or document store)
5. Provide REST API to query reconstructed state

---

## Future Extensions

1. **Multi-Sig Approvals:** Track which approvers signed each `add_members_multisig()` call
2. **Fee Distribution:** Add events for fee accrual and distribution (if added to contracts)
3. **Token Transfers:** Index SEP-41 Transfer events from token contract
4. **Governance Voting:** Add `proposal_voted` and `proposal_finalized` events
5. **Certificate Lifecycle:** Add events for certificate creation, transfer, and retirement


# Events Quick Start

> Get off-chain indexing running in 30 minutes.

**Documents to Read First:**
1. This file (5 min read)
2. [EVENTS-SPECIFICATION.md](./EVENTS-SPECIFICATION.md) (10 min)
3. [INDEXER-FIXTURES.md](./INDEXER-FIXTURES.md) (10 min)

---

## What Changed

Africanking contracts now emit stable events for every state change. Off-chain APIs can rebuild the full cooperative state from these events without querying the contracts.

| Aspect | Before | After |
|--------|--------|-------|
| State Reconstruction | Poll contract state repeatedly | Listen to events, single pass |
| Data Freshness | Latency = polling interval | Latency = block production time (~5s on Testnet) |
| Scalability | O(contracts) RPC calls per update | O(1) event stream subscription |
| Auditability | No history, only current state | Full transaction history on-chain |

---

## Event Types (Quick Reference)

### Generation & Allocation

| Event | Emitted By | Payload | Use For |
|-------|-----------|---------|---------|
| `member_added` | `add_members_multisig()` | address, percent, batch info | Tracking member history |
| `member_removed` | `add_members_multisig()` | address | Removing inactive members |
| `generation_recorded` | `record_generation()` | kWh, allocation array | Monthly generation reports |
| `token_minted` | `mint_energy()` | member, amount, cooperative_id | Member earning history |
| `token_burned` | `burn_energy()` | member, amount | Certificate retirements |

### Administrative

| Event | Emitted By | Use For |
|-------|-----------|---------|
| `contract_paused` | `pause()` | Emergency halt flag |
| `contract_unpaused` | `unpause()` | Resume marker |
| `contract_upgraded` | `upgrade()` | WASM version tracking |
| `minter_granted` | `grant_minter()` | Access control audit |
| `minter_revoked` | `revoke_minter()` | Access control audit |
| `cooperative_deployed` | `deploy_cooperative()` | Cooperative registry |

---

## Indexer Development Workflow

### Phase 1: Offline Development (Use Fixtures)

**Objective:** Build and test state reconstruction logic without hitting live testnet.

**Steps:**

1. **Load fixture** (from `INDEXER-FIXTURES.md`):
   ```json
   [
     { "type": "cooperative_deployed", "ledger": 1000, "payload": {...} },
     { "type": "member_added", "ledger": 1000, "payload": {...} },
     { "type": "generation_recorded", "ledger": 1010, "payload": {...} },
     ...
   ]
   ```

2. **Process events in order:**
   ```python
   for event in fixture_events:
       if event['type'] == 'cooperative_deployed':
           db.insert('cooperatives', event['payload'])
       elif event['type'] == 'member_added':
           db.insert('member_allocations', event['payload'])
       # ... handle other event types
   ```

3. **Verify state matches expected output** (from fixture doc):
   ```python
   assert db.query('cooperatives')['coop-id'] == expected_state['cooperative']
   assert db.query('members')['count'] == 3
   ```

4. **Test edge cases:**
   - Member replacement (Fixture 2)
   - Pause/resume (Fixture 3)
   - Token burns (Fixture 4)

---

### Phase 2: Live Testnet (Subscribe to Events)

**Objective:** Connect to real contracts and validate against fixture expectations.

**Steps:**

1. **Get contract addresses** (from cooperative deployment):
   ```
   token_contract = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4"
   distribution_contract = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC5"
   ```

2. **Query RPC for events:**
   ```javascript
   const server = new Server("https://soroban-testnet.stellar.org");
   const events = await server.getEvents({
     filters: [
       {
         type: "contract",
         contractIds: [distribution_contract],
       },
     ],
   }).call();
   ```

3. **Decode events:**
   ```javascript
   for (const event of events.records) {
     const [topic0, topic1, topic2] = event.contractEvent.topic;
     const data = event.contractEvent.data;
     const payload = decodeXdr(data);
     
     await processEvent({
       type: decodeTopic(topic0),
       contract: topic1,
       indexed2: topic2,
       payload: payload,
       ledger: event.ledger,
     });
   }
   ```

4. **Expose REST API:**
   ```
   GET /api/cooperatives/:cooperative_id
   GET /api/members/:member_address/cooperatives
   GET /api/cooperatives/:cooperative_id/generation
   ```

---

## Minimal Indexer Example (Node.js)

```javascript
import { Server } from "@stellar-sdk";
import Database from "better-sqlite3";

const db = new Database("indexer.db");
const server = new Server("https://soroban-testnet.stellar.org");

// Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS cooperatives (
    cooperative_id TEXT PRIMARY KEY,
    token_contract TEXT,
    distribution_contract TEXT,
    created_at INTEGER
  );
  
  CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    distribution_contract TEXT,
    member_address TEXT,
    percent INTEGER,
    added_at INTEGER,
    removed_at INTEGER,
    UNIQUE(distribution_contract, member_address)
  );
  
  CREATE TABLE IF NOT EXISTS generation (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    distribution_contract TEXT,
    ledger INTEGER,
    kwh_generated INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);

async function indexEvents() {
  const events = await server
    .getEvents({
      filters: [
        {
          type: "contract",
          // Add your contract addresses here
        },
      ],
    })
    .call();

  for (const event of events.records) {
    const topicSymbol = decodeTopicSymbol(event.contractEvent.topic[0]);
    const payload = decodePayload(event.contractEvent.data);

    if (topicSymbol === "cooperative_deployed") {
      db.prepare(`
        INSERT OR REPLACE INTO cooperatives 
        (cooperative_id, token_contract, distribution_contract, created_at)
        VALUES (?, ?, ?, ?)
      `).run(
        payload.cooperative_id,
        payload.token_contract,
        payload.distribution_contract,
        event.ledger
      );
    } else if (topicSymbol === "member_added") {
      db.prepare(`
        INSERT OR REPLACE INTO members
        (distribution_contract, member_address, percent, added_at)
        VALUES (?, ?, ?, ?)
      `).run(
        payload.distribution_contract,
        payload.member_address,
        payload.percent,
        event.ledger
      );
    } else if (topicSymbol === "generation_recorded") {
      db.prepare(`
        INSERT INTO generation
        (distribution_contract, ledger, kwh_generated)
        VALUES (?, ?, ?)
      `).run(
        payload.distribution_contract,
        event.ledger,
        payload.kwh_generated
      );
    }
  }
}

// Run every block
setInterval(indexEvents, 5000);
```

---

## API Response Examples

### Cooperative Details

```bash
$ curl https://your-indexer.com/api/cooperatives/coop-buenos-aires
```

```json
{
  "cooperative_id": "coop-buenos-aires",
  "token_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  "distribution_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC5",
  "governance_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC6",
  "admin": "GBRPYHIL2CI3FIQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW2QC6GEDI",
  "created_at": 1000,
  "total_kwh_generated": 300000000,
  "current_members": [
    {
      "address": "GBRPYHIL2CI3FIQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW2QC6GEDI",
      "percent": 100,
      "total_tokens_earned": 300000000
    }
  ],
  "paused": false,
  "paused_at": null
}
```

### Member Profile

```bash
$ curl https://your-indexer.com/api/members/GBRPYHIL2CI3FIQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW2QC6GEDI/cooperatives
```

```json
[
  {
    "cooperative_id": "coop-buenos-aires",
    "token_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    "percent": 100,
    "total_tokens_earned": 300000000,
    "joined_at": 1000
  }
]
```

### Generation Timeline

```bash
$ curl https://your-indexer.com/api/cooperatives/coop-buenos-aires/generation?from=1000&to=2000
```

```json
[
  {
    "ledger": 1010,
    "kwh_generated": 100000000,
    "timestamp": 1234567890,
    "allocation": [
      {
        "member_address": "GBRPYHIL2CI3FIQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW2QC6GEDI",
        "percent": 100,
        "tokens_minted": 100000000
      }
    ]
  },
  {
    "ledger": 1020,
    "kwh_generated": 200000000,
    "timestamp": 1234567895,
    "allocation": [
      {
        "member_address": "GBRPYHIL2CI3FIQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW2QC6GEDI",
        "percent": 100,
        "tokens_minted": 200000000
      }
    ]
  }
]
```

---

## Common Indexer Patterns

### Pattern: Rebuild State from Genesis

```python
# 1. Query all cooperative_deployed events
coops = get_events_by_type('cooperative_deployed')

# 2. For each cooperative, build member history
for coop in coops:
    member_adds = get_events_by_type_and_contract(
        'member_added', 
        coop.distribution_contract
    )
    member_removes = get_events_by_type_and_contract(
        'member_removed',
        coop.distribution_contract
    )
    
    # Apply in ledger order
    current_members = {}
    for event in sorted(member_adds + member_removes):
        if event.type == 'member_added':
            current_members[event.payload.member_address] = {
                'percent': event.payload.percent,
                'joined_at': event.ledger
            }
        else:  # member_removed
            del current_members[event.payload.member_address]
    
    # Store current_members snapshot
    db.set(f'coop:{coop.id}:members', current_members)

# 3. For each cooperative, sum generation
for coop in coops:
    generation_events = get_events_by_type_and_contract(
        'generation_recorded',
        coop.distribution_contract
    )
    total_kwh = sum(e.payload.kwh_generated for e in generation_events)
    db.set(f'coop:{coop.id}:total_kwh', total_kwh)
```

### Pattern: Detect Pause Windows

```python
pauses = get_events_by_type('contract_paused')
unpauses = get_events_by_type('contract_unpaused')

for pause in pauses:
    corresponding_unpause = next(
        u for u in unpauses if u.ledger > pause.ledger
    )
    
    # Flag all generation events in this window as blocked
    blocked_generation = get_events_by_type_in_ledger_range(
        'generation_recorded',
        pause.ledger,
        corresponding_unpause.ledger
    )
    
    # This should be empty; flag as anomaly if not
    if blocked_generation:
        log_anomaly(f'Generation during pause: {blocked_generation}')
```

### Pattern: Member Earning Reconciliation

```python
def reconcile_member(member_address, cooperative_id):
    # 1. Get all mints for this member
    mints = get_events_by_type_and_indexed(
        'token_minted',
        'to_address',
        member_address
    )
    total_minted = sum(m.payload.amount for m in mints)
    
    # 2. Get all burns for this member
    burns = get_events_by_type_and_indexed(
        'token_burned',
        'from_address',
        member_address
    )
    total_burned = sum(b.payload.amount for b in burns)
    
    # 3. Query on-chain balance
    on_chain_balance = token_contract.balance(member_address)
    
    # 4. Verify: total_minted - total_burned == on_chain_balance
    expected = total_minted - total_burned
    if on_chain_balance != expected:
        log_anomaly(f'Balance mismatch: on-chain={on_chain_balance}, expected={expected}')
    
    return {
        'minted': total_minted,
        'burned': total_burned,
        'current_balance': on_chain_balance,
        'reconciled': on_chain_balance == expected
    }
```

---

## Deployment Steps

1. **Upgrade Contracts:**
   ```bash
   cd apps/contracts
   cargo build --release --target wasm32v1-none
   stellar contract install --network testnet \
       --source <admin> \
       --wasm target/wasm32v1-none/release/energy_distribution.wasm
   # → <new_distribution_wasm_hash>
   
   stellar contract invoke --id <factory> -- set_wasm_hashes \
       --token_wasm_hash <token_hash> \
       --distribution_wasm_hash <new_distribution_hash> \
       --governance_wasm_hash <governance_hash>
   ```

2. **Deploy Indexer:**
   ```bash
   npm install  # deps
   npm run build
   npm run start
   # Indexer now listening to Stellar RPC
   ```

3. **Verify Indexer:**
   ```bash
   curl http://localhost:3000/health
   # Should return: { "status": "ok", "last_indexed_ledger": 1234567 }
   ```

---

## Testing Checklist

- [ ] Offline indexer passes all fixtures (Fixture 1–4)
- [ ] Live indexer connects to Testnet RPC
- [ ] Events appear in indexer DB within 10 seconds of block production
- [ ] API responses match expected schema
- [ ] Member balance reconciliation passes for 100% of queries
- [ ] Pause/unpause state machine enforced (operations blocked during pause)
- [ ] Generation history timeline is monotonic (ascending ledgers)

---

## Troubleshooting

| Problem | Diagnosis | Solution |
|---------|-----------|----------|
| Indexer stuck at ledger 100 | RPC connection dropped | Reconnect with exponential backoff |
| Events have empty payloads | XDR decoding fails | Check Soroban SDK version matches |
| Member allocation sum incorrect | Integer division rounding | Accept ±1 stroop tolerance |
| Pause event not found | Contract not paused yet | Check if events are only emitted on operational contracts |
| API returns 404 for coop | Cooperative not in DB yet | Query RPC directly for `cooperative_deployed` events |

---

## Next Steps

1. **Read detailed spec:** [EVENTS-SPECIFICATION.md](./EVENTS-SPECIFICATION.md)
2. **Review fixtures:** [INDEXER-FIXTURES.md](./INDEXER-FIXTURES.md)
3. **Check implementation:** [EVENTS-IMPLEMENTATION.md](./EVENTS-IMPLEMENTATION.md)
4. **Clone indexer repo:** (reference implementation coming)
5. **Deploy to Testnet:** Test against live cooperative contracts
6. **Integrate with API:** Use indexer as backend for `/api/cooperatives`, `/api/members`

---

## Support

- **Question about event format?** See [EVENTS-SPECIFICATION.md](./EVENTS-SPECIFICATION.md)
- **Need test data?** See [INDEXER-FIXTURES.md](./INDEXER-FIXTURES.md)
- **Implementation question?** See [EVENTS-IMPLEMENTATION.md](./EVENTS-IMPLEMENTATION.md)
- **Report a bug?** File issue in repo with fixture that breaks indexer


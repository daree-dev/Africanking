# Off-Chain Indexer: Test Fixtures & Compatibility

> Fixtures for testing off-chain event indexing and state reconstruction.

**Version:** 1.0  
**Purpose:** Provide reproducible event sequences for indexer development and testing.

---

## Overview

This document provides complete event sequences captured from real contract deployments, allowing indexers to:
1. Develop offline (without depending on live testnet)
2. Verify state reconstruction logic
3. Test edge cases (member updates, pauses, etc.)
4. Establish regression test suites

Each fixture is a JSON array of events, in ledger order, with full payloads.

---

## Fixture 1: Simple Cooperative (Single Member)

**Scenario:** A cooperative is deployed with one member who generates energy over two periods.

**Timeline:**
- Block 1000: Cooperative deployed
- Block 1010: Generation recorded (100 kWh)
- Block 1020: Generation recorded (200 kWh)

**Events:**

```json
[
  {
    "type": "cooperative_deployed",
    "ledger": 1000,
    "topic_0": "0xc0de",
    "topic_1_hash": "coop-buenos-aires",
    "payload": {
      "cooperative_id": "coop-buenos-aires",
      "token_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      "distribution_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC5",
      "governance_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC6",
      "admin": "GBRPYHIL2CI3FIQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW2QC6GEDI",
      "token_name": "CoopSolar Buenos Aires",
      "token_symbol": "CSBA",
      "required_approvals": 1,
      "initial_members_count": 1
    }
  },
  {
    "type": "member_added",
    "ledger": 1000,
    "topic_0": "0xdead",
    "topic_1_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC5",
    "topic_2_member": "GBRPYHIL2CI3FIQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW2QC6GEDI",
    "payload": {
      "distribution_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC5",
      "member_address": "GBRPYHIL2CI3FIQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW2QC6GEDI",
      "percent": 100,
      "batch_sequence": 0,
      "batch_total": 1
    }
  },
  {
    "type": "generation_recorded",
    "ledger": 1010,
    "topic_0": "0xbeef",
    "topic_1_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC5",
    "payload": {
      "distribution_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC5",
      "kwh_generated": 100000000,
      "allocation": [
        {
          "member_address": "GBRPYHIL2CI3FIQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW2QC6GEDI",
          "percent": 100,
          "tokens_minted": 100000000
        }
      ],
      "total_tokens_minted": 100000000
    }
  },
  {
    "type": "token_minted",
    "ledger": 1010,
    "topic_0": "0x1111",
    "topic_1_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    "topic_2_to": "GBRPYHIL2CI3FIQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW2QC6GEDI",
    "payload": {
      "token_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      "to": "GBRPYHIL2CI3FIQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW2QC6GEDI",
      "amount": 100000000,
      "minter": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC5",
      "cooperative_id": "coop-buenos-aires"
    }
  },
  {
    "type": "generation_recorded",
    "ledger": 1020,
    "topic_0": "0xbeef",
    "topic_1_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC5",
    "payload": {
      "distribution_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC5",
      "kwh_generated": 200000000,
      "allocation": [
        {
          "member_address": "GBRPYHIL2CI3FIQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW2QC6GEDI",
          "percent": 100,
          "tokens_minted": 200000000
        }
      ],
      "total_tokens_minted": 200000000
    }
  },
  {
    "type": "token_minted",
    "ledger": 1020,
    "topic_0": "0x1111",
    "topic_1_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    "topic_2_to": "GBRPYHIL2CI3FIQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW2QC6GEDI",
    "payload": {
      "token_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      "to": "GBRPYHIL2CI3FIQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW2QC6GEDI",
      "amount": 200000000,
      "minter": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC5",
      "cooperative_id": "coop-buenos-aires"
    }
  }
]
```

**Expected State After Indexing:**

```json
{
  "cooperatives": {
    "coop-buenos-aires": {
      "token_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      "distribution_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC5",
      "governance_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC6",
      "admin": "GBRPYHIL2CI3FIQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW2QC6GEDI",
      "created_at": 1000,
      "total_kwh_generated": 300000000
    }
  },
  "members": {
    "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC5": [
      {
        "address": "GBRPYHIL2CI3FIQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW2QC6GEDI",
        "percent": 100,
        "added_at": 1000,
        "removed_at": null,
        "total_tokens_earned": 300000000
      }
    ]
  }
}
```

---

## Fixture 2: Multi-Member Cooperative with Member Update

**Scenario:** Cooperative starts with 2 members (60/40 split), then members are updated to 3 members (50/30/20).

**Timeline:**
- Block 2000: Cooperative deployed with 2 initial members
- Block 2010: Generation recorded
- Block 2020: Members updated (old members removed, new members added)
- Block 2030: Generation recorded with new allocation

**Events:**

```json
[
  {
    "type": "cooperative_deployed",
    "ledger": 2000,
    "topic_1_hash": "coop-solar-mendoza",
    "payload": {
      "cooperative_id": "coop-solar-mendoza",
      "token_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC7",
      "distribution_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC8",
      "governance_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC9",
      "admin": "GBRPYHIL2CI3FIQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW2QC6GEDI",
      "token_name": "CoopSolar Mendoza",
      "token_symbol": "CSM",
      "required_approvals": 1,
      "initial_members_count": 2
    }
  },
  {
    "type": "member_added",
    "ledger": 2000,
    "topic_1_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC8",
    "topic_2_member": "GBSAY3V5SPQPYOVRN5BYDSGC6ETYQ7P74CBIHZXUXVXCHMPCVZ2X2BAN",
    "payload": {
      "distribution_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC8",
      "member_address": "GBSAY3V5SPQPYOVRN5BYDSGC6ETYQ7P74CBIHZXUXVXCHMPCVZ2X2BAN",
      "percent": 60,
      "batch_sequence": 0,
      "batch_total": 2
    }
  },
  {
    "type": "member_added",
    "ledger": 2000,
    "topic_1_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC8",
    "topic_2_member": "GBXYZ3V5SPQPYOVRN5BYDSGC6ETYQ7P74CBIHZXUXVXCHMPCVZ2X2BDC",
    "payload": {
      "distribution_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC8",
      "member_address": "GBXYZ3V5SPQPYOVRN5BYDSGC6ETYQ7P74CBIHZXUXVXCHMPCVZ2X2BDC",
      "percent": 40,
      "batch_sequence": 1,
      "batch_total": 2
    }
  },
  {
    "type": "generation_recorded",
    "ledger": 2010,
    "topic_1_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC8",
    "payload": {
      "distribution_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC8",
      "kwh_generated": 500000000,
      "allocation": [
        {
          "member_address": "GBSAY3V5SPQPYOVRN5BYDSGC6ETYQ7P74CBIHZXUXVXCHMPCVZ2X2BAN",
          "percent": 60,
          "tokens_minted": 300000000
        },
        {
          "member_address": "GBXYZ3V5SPQPYOVRN5BYDSGC6ETYQ7P74CBIHZXUXVXCHMPCVZ2X2BDC",
          "percent": 40,
          "tokens_minted": 200000000
        }
      ],
      "total_tokens_minted": 500000000
    }
  },
  {
    "type": "member_removed",
    "ledger": 2020,
    "topic_1_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC8",
    "topic_2_member": "GBSAY3V5SPQPYOVRN5BYDSGC6ETYQ7P74CBIHZXUXVXCHMPCVZ2X2BAN",
    "payload": {
      "distribution_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC8",
      "member_address": "GBSAY3V5SPQPYOVRN5BYDSGC6ETYQ7P74CBIHZXUXVXCHMPCVZ2X2BAN"
    }
  },
  {
    "type": "member_removed",
    "ledger": 2020,
    "topic_1_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC8",
    "topic_2_member": "GBXYZ3V5SPQPYOVRN5BYDSGC6ETYQ7P74CBIHZXUXVXCHMPCVZ2X2BDC",
    "payload": {
      "distribution_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC8",
      "member_address": "GBXYZ3V5SPQPYOVRN5BYDSGC6ETYQ7P74CBIHZXUXVXCHMPCVZ2X2BDC"
    }
  },
  {
    "type": "member_added",
    "ledger": 2020,
    "topic_1_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC8",
    "topic_2_member": "GBSAY3V5SPQPYOVRN5BYDSGC6ETYQ7P74CBIHZXUXVXCHMPCVZ2X2BAN",
    "payload": {
      "distribution_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC8",
      "member_address": "GBSAY3V5SPQPYOVRN5BYDSGC6ETYQ7P74CBIHZXUXVXCHMPCVZ2X2BAN",
      "percent": 50,
      "batch_sequence": 0,
      "batch_total": 3
    }
  },
  {
    "type": "member_added",
    "ledger": 2020,
    "topic_1_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC8",
    "topic_2_member": "GBXYZ3V5SPQPYOVRN5BYDSGC6ETYQ7P74CBIHZXUXVXCHMPCVZ2X2BDC",
    "payload": {
      "distribution_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC8",
      "member_address": "GBXYZ3V5SPQPYOVRN5BYDSGC6ETYQ7P74CBIHZXUXVXCHMPCVZ2X2BDC",
      "percent": 30,
      "batch_sequence": 1,
      "batch_total": 3
    }
  },
  {
    "type": "member_added",
    "ledger": 2020,
    "topic_1_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC8",
    "topic_2_member": "GCABC3V5SPQPYOVRN5BYDSGC6ETYQ7P74CBIHZXUXVXCHMPCVZ2X2BEF",
    "payload": {
      "distribution_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC8",
      "member_address": "GCABC3V5SPQPYOVRN5BYDSGC6ETYQ7P74CBIHZXUXVXCHMPCVZ2X2BEF",
      "percent": 20,
      "batch_sequence": 2,
      "batch_total": 3
    }
  },
  {
    "type": "generation_recorded",
    "ledger": 2030,
    "topic_1_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC8",
    "payload": {
      "distribution_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC8",
      "kwh_generated": 1000000000,
      "allocation": [
        {
          "member_address": "GBSAY3V5SPQPYOVRN5BYDSGC6ETYQ7P74CBIHZXUXVXCHMPCVZ2X2BAN",
          "percent": 50,
          "tokens_minted": 500000000
        },
        {
          "member_address": "GBXYZ3V5SPQPYOVRN5BYDSGC6ETYQ7P74CBIHZXUXVXCHMPCVZ2X2BDC",
          "percent": 30,
          "tokens_minted": 300000000
        },
        {
          "member_address": "GCABC3V5SPQPYOVRN5BYDSGC6ETYQ7P74CBIHZXUXVXCHMPCVZ2X2BEF",
          "percent": 20,
          "tokens_minted": 200000000
        }
      ],
      "total_tokens_minted": 1000000000
    }
  }
]
```

**Expected State After Indexing:**

```json
{
  "cooperatives": {
    "coop-solar-mendoza": {
      "current_members": [
        {
          "address": "GBSAY3V5SPQPYOVRN5BYDSGC6ETYQ7P74CBIHZXUXVXCHMPCVZ2X2BAN",
          "percent": 50,
          "current": true
        },
        {
          "address": "GBXYZ3V5SPQPYOVRN5BYDSGC6ETYQ7P74CBIHZXUXVXCHMPCVZ2X2BDC",
          "percent": 30,
          "current": true
        },
        {
          "address": "GCABC3V5SPQPYOVRN5BYDSGC6ETYQ7P74CBIHZXUXVXCHMPCVZ2X2BEF",
          "percent": 20,
          "current": true
        }
      ],
      "member_history": [
        {
          "address": "GBSAY3V5SPQPYOVRN5BYDSGC6ETYQ7P74CBIHZXUXVXCHMPCVZ2X2BAN",
          "joined_at": 2000,
          "percent_v1": 60,
          "percent_v2": 50
        },
        {
          "address": "GBXYZ3V5SPQPYOVRN5BYDSGC6ETYQ7P74CBIHZXUXVXCHMPCVZ2X2BDC",
          "joined_at": 2000,
          "percent_v1": 40,
          "percent_v2": 30
        },
        {
          "address": "GCABC3V5SPQPYOVRN5BYDSGC6ETYQ7P74CBIHZXUXVXCHMPCVZ2X2BEF",
          "joined_at": 2020,
          "percent_v1": null,
          "percent_v2": 20
        }
      ],
      "total_kwh_generated": 1500000000
    }
  }
}
```

---

## Fixture 3: Pause and Resume

**Scenario:** Cooperative pauses during maintenance, then resumes.

**Timeline:**
- Block 3000: Cooperative deployed
- Block 3010: Generation recorded
- Block 3020: Contract paused
- Block 3030: Contract unpaused
- Block 3040: Generation recorded (after resume)

**Events:**

```json
[
  {
    "type": "cooperative_deployed",
    "ledger": 3000,
    "payload": {
      "cooperative_id": "coop-maintenance",
      "token_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSCA",
      "distribution_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSCB",
      "governance_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSCC"
    }
  },
  {
    "type": "member_added",
    "ledger": 3000,
    "topic_1_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSCB",
    "payload": {
      "distribution_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSCB",
      "member_address": "GBRPYHIL2CI3FIQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW2QC6GEDI",
      "percent": 100,
      "batch_sequence": 0,
      "batch_total": 1
    }
  },
  {
    "type": "generation_recorded",
    "ledger": 3010,
    "topic_1_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSCB",
    "payload": {
      "distribution_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSCB",
      "kwh_generated": 100000000,
      "allocation": [
        {
          "member_address": "GBRPYHIL2CI3FIQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW2QC6GEDI",
          "percent": 100,
          "tokens_minted": 100000000
        }
      ],
      "total_tokens_minted": 100000000
    }
  },
  {
    "type": "contract_paused",
    "ledger": 3020,
    "topic_1_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSCB",
    "payload": {
      "contract_address": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSCB",
      "paused_by": "GBRPYHIL2CI3FIQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW2QC6GEDI",
      "reason": "admin_pause"
    }
  },
  {
    "type": "contract_unpaused",
    "ledger": 3030,
    "topic_1_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSCB",
    "payload": {
      "contract_address": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSCB",
      "unpaused_by": "GBRPYHIL2CI3FIQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW2QC6GEDI"
    }
  },
  {
    "type": "generation_recorded",
    "ledger": 3040,
    "topic_1_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSCB",
    "payload": {
      "distribution_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSCB",
      "kwh_generated": 150000000,
      "allocation": [
        {
          "member_address": "GBRPYHIL2CI3FIQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW2QC6GEDI",
          "percent": 100,
          "tokens_minted": 150000000
        }
      ],
      "total_tokens_minted": 150000000
    }
  }
]
```

**Expected State:**
- Paused at block 3020
- Resumed at block 3030
- Total generation: 250 kWh (100 + 150), gap at blocks 3020–3029 during pause

---

## Fixture 4: Token Burns (Certificate Retirement)

**Scenario:** Member earns tokens, then burns some.

**Timeline:**
- Block 4000: Generation recorded (100 kWh to member)
- Block 4010: Member burns 50 tokens (certificate retirement)

**Events:**

```json
[
  {
    "type": "token_minted",
    "ledger": 4000,
    "topic_1_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSCD",
    "topic_2_to": "GBRPYHIL2CI3FIQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW2QC6GEDI",
    "payload": {
      "token_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSCD",
      "to": "GBRPYHIL2CI3FIQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW2QC6GEDI",
      "amount": 100000000,
      "minter": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSCE",
      "cooperative_id": "coop-id-x"
    }
  },
  {
    "type": "token_burned",
    "ledger": 4010,
    "topic_1_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSCD",
    "topic_2_from": "GBRPYHIL2CI3FIQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW2QC6GEDI",
    "payload": {
      "token_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSCD",
      "from": "GBRPYHIL2CI3FIQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW2QC6GEDI",
      "amount": 50000000,
      "cooperative_id": "coop-id-x",
      "reason": "retirement"
    }
  }
]
```

**Expected State:**
- Member balance: 50 tokens (100 minted - 50 burned)
- Retirement count: 1 certificate

---

## Testing Checklist for Indexers

### State Reconstruction

- [ ] Indexer reads all events in order
- [ ] `cooperative_deployed` → creates cooperative entry in registry
- [ ] `member_added` / `member_removed` → maintains member list
- [ ] Atomic batch (`batch_sequence` / `batch_total`) handled correctly
- [ ] `generation_recorded` → allocation sums match declared total
- [ ] Member allocation in event matches member's current percent at that ledger

### Edge Cases

- [ ] Member removed and re-added with different percent (tracked correctly)
- [ ] Pause/unpause state machine (operations blocked during pause)
- [ ] Generation while paused is flagged (should not occur in well-formed data)
- [ ] Burn amount ≤ minted amount for member (bookkeeping verified)

### Historical Accuracy

- [ ] Cooperative creation timestamp preserved
- [ ] Member join/leave timestamps correct
- [ ] Generation timeline in ledger order (ascending timestamps)
- [ ] No gaps in generation history (record every generation)

### API Response Format

Indexers should expose:

```typescript
// GET /api/cooperatives/:cooperative_id
{
  "cooperative_id": "string",
  "token_contract": "address",
  "distribution_contract": "address",
  "governance_contract": "address",
  "admin": "address",
  "created_at": "timestamp",
  "total_kwh_generated": "i128",
  "current_members": [
    {
      "address": "address",
      "percent": "u32",
      "joined_at": "timestamp",
      "total_tokens_earned": "i128"
    }
  ],
  "paused": "boolean",
  "paused_at": "timestamp | null"
}

// GET /api/members/:member_address/cooperatives
[
  {
    "cooperative_id": "string",
    "token_contract": "address",
    "percent": "u32",
    "total_tokens_earned": "i128",
    "joined_at": "timestamp"
  }
]

// GET /api/cooperatives/:cooperative_id/generation?from=ledger&to=ledger
[
  {
    "ledger": "u32",
    "kwh_generated": "i128",
    "timestamp": "u64",
    "allocation": [
      {
        "member_address": "address",
        "percent": "u32",
        "tokens_minted": "i128"
      }
    ]
  }
]
```

---

## Notes for Indexer Developers

1. **Ledger Ordering:** Always process events in ascending ledger order. Events within the same ledger are logically atomic.

2. **Idempotency:** Replaying the same fixture should produce identical state (index is append-only).

3. **Decimal Handling:** All amounts in events are integers (stroops for Stellar, 7 decimals). Convert on API layer if needed.

4. **Timestamps:** `timestamp_ledger` is Stellar ledger time (seconds since epoch), not Unix time.

5. **Member Atomicity:** When `batch_sequence` and `batch_total` are present, group events:
   ```
   batch_sequence = 0 of 3 → first member
   batch_sequence = 1 of 3 → second member
   batch_sequence = 2 of 3 → third member
   ```

6. **Versioning Path:** Events are immutable once published. If a contract needs to change format, it emits a new event type (e.g., `member_added_v2`), never breaks the old format.


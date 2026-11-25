# Africanking Event Specification

> Off-chain APIs need stable event formats to reconstruct cooperative, member allocation, and transaction history.

**Status:** ✅ Implemented in contracts v1.0  
**Updated:** November 2025  
**Audience:** Off-chain indexer developers, API teams

---

## 📚 Documentation Structure

### For Quick Start (5–15 minutes)
→ **[EVENTS-QUICKSTART.md](./EVENTS-QUICKSTART.md)**
- Event types at a glance
- Minimal indexer example
- Common patterns
- Troubleshooting

### For Detailed Specification (20–30 minutes)
→ **[EVENTS-SPECIFICATION.md](./EVENTS-SPECIFICATION.md)**
- Event catalog (all event types, payloads, topics)
- Indexing patterns (5 fundamental patterns)
- Versioning strategy
- Data reconstruction examples
- Future extensions

### For Test Fixtures (10–20 minutes)
→ **[INDEXER-FIXTURES.md](./INDEXER-FIXTURES.md)**
- 4 reproducible event fixtures
- Expected state snapshots
- Testing checklist for indexers
- Common edge cases

### For Implementation Details (15–20 minutes)
→ **[EVENTS-IMPLEMENTATION.md](./EVENTS-IMPLEMENTATION.md)**
- Code locations in contracts
- Contract-by-contract event reference
- Event serialization details
- RPC query examples
- Validation rules
- Migration path for older contracts

---

## 🎯 What This Solves

**Before:** Off-chain APIs must poll contract state repeatedly
```
Client API → Query Contract 1 → Query Contract 2 → ...
           ↓ (latency = polling interval, O(n) RPCs)
           Stale data, inefficient
```

**After:** Off-chain APIs listen to events (single pass, event-driven)
```
Stellar RPC → Event Stream → Indexer DB → API
                             ↓ (latency = block time, O(1) subscriptions)
                             Fresh, scalable
```

---

## ✨ Key Features

### 1. **Stable Event Formats**
- Event names and payloads locked at version 1.0
- Breaking changes get new event names (v2+)
- Indexers never break

### 2. **Indexed Topics**
- Each event has discriminator (Topic[0])
- Primary aggregate indexed (Topic[1])
- Fast filtering: `events.where(type=member_added).where(contract=X)`

### 3. **Self-Contained Payloads**
- No need to call contracts to understand events
- Full context in event data
- Anomalies flagged via indexer validation

### 4. **Atomicity**
- Multi-member updates use `batch_sequence`/`batch_total`
- Member replacements are atomic swaps
- No intermediate states visible to indexers

### 5. **Auditability**
- All state changes are events
- Full history on-chain forever
- Replay from block 0 → current state

---

## 🚀 Event Types (Summary)

### Generation & Allocation
| Event | Contracts | Frequency |
|-------|-----------|-----------|
| `cooperative_deployed` | factory | Once per cooperative |
| `member_added` | distribution | Per member during setup/update |
| `member_removed` | distribution | Per member during update |
| `generation_recorded` | distribution | Once per generation event (1–2x/day) |
| `token_minted` | token | Once per generation (via distribution) |
| `token_burned` | token | Per certificate retirement |

### Administrative
| Event | Contracts | Frequency |
|-------|-----------|-----------|
| `contract_paused` | distribution, token | Emergency only |
| `contract_unpaused` | distribution, token | After pause resolution |
| `contract_upgraded` | distribution, token | During WASM updates |
| `minter_granted` | token | Per access grant |
| `minter_revoked` | token | Per access revocation |
| `proposal_created` | governance | Per governance proposal |

---

## 📋 Indexer Responsibilities

**Must Handle:**
1. Subscribe to Stellar events (by contract address)
2. Decode XDR event payloads
3. Store events in database (or reconstruct on-demand)
4. Validate event integrity (sums, ranges, invariants)
5. Expose REST API with query results

**Must Not Assume:**
1. Events come from a trusted source (validate XDR)
2. Contract was not paused when event emitted (check state)
3. Member balance = sum of mints - burns (integer division may cause 1-stroop discrepancies)
4. All members in event exist on-chain (may have been removed in later transaction)

---

## 💡 Use Cases

### Use Case 1: Monthly Generation Report
```
1. Query cooperative_deployed for coop_id
2. Filter generation_recorded events by distribution_contract
3. Sum kwh_generated and member allocations
4. Report: "July 2025: 5000 kWh generated across 3 members"
```

### Use Case 2: Member Onboarding
```
1. Watch for member_added events for a contract
2. Create member profile record
3. Query token contract for initial balance
4. Send welcome email with contract address
```

### Use Case 3: Certificate Retirement Proof
```
1. Query token_burned events for a member
2. Correlate with minting history (from token_minted events)
3. Display: "Retired 500 kWh on [date] via certificate burn"
4. Provide on-chain txn hash as proof
```

### Use Case 4: Cooperative Health Dashboard
```
1. Query all cooperatives (cooperative_deployed events)
2. For each, fetch current member list (member_added/removed)
3. Fetch generation timeline (generation_recorded)
4. Calculate uptime (contract_paused/unpaused events)
5. Display: Health score, member count, generation trend, uptime %
```

---

## 🔧 Implementation Stack

**Recommended (not prescriptive):**

| Layer | Technology | Alternative |
|-------|-----------|-------------|
| **RPC** | Stellar soroban-testnet.stellar.org | Any Stellar node |
| **Event Subscription** | js-stellar-sdk / stellar-py | Direct Horizon API |
| **XDR Decoding** | stellar-base | Manual parsing |
| **Database** | PostgreSQL or SQLite | MongoDB, DynamoDB |
| **API** | Express.js / FastAPI | Django, Next.js |
| **Deployment** | Docker + Kubernetes | Vercel, Railway |

---

## 🧪 Testing

### Phase 1: Offline (Fixtures)
- Load event JSON from `INDEXER-FIXTURES.md`
- Process through indexer
- Verify state matches expected output
- No network required, 100% reproducible

### Phase 2: Live Testnet
- Deploy indexer against Stellar Testnet
- Query events for known cooperatives
- Verify API responses match Phase 1
- Test pause/resume, member updates
- Measure event latency (should be ~block time)

### Phase 3: Validation
- Run reconciliation checks (e.g., balance = mints - burns)
- Compare against on-chain state (via RPC queries)
- Flag anomalies (member in event but not in current list)
- Monitor for data gaps (missed events)

---

## 🔄 Versioning & Migration

### Version 1.0 (Current)
- Initial stable release
- Event names locked
- Payloads frozen

### Version 1.1+ (Future, Non-Breaking)
- New optional fields in payloads
- New event types (not renaming old ones)
- Indexers with 1.0 logic still work

### Version 2.0 (Future, Breaking)
- Old event name emitted alongside new name during grace period
- Example: `member_added_v1` and `member_added_v2` both emitted
- Indexers must upgrade to v2 within grace period
- v1 event name discontinued

### Migration Path for Indexer Developers
```
Current indexer reads: member_added → stores in DB
Contract emits: member_added (v1.0) + member_added_v2 (breaking change)
Indexer behavior: Reads both, same DB table (backward compatible)
Grace period: 2–3 contract releases (~6 months)
Deadline: Upgrade indexer to only read v2 format
```

---

## 🚨 Common Pitfalls

### ❌ Pitfall 1: Assuming Current State = Event History
**Wrong:** "If I see a member_added event, that member exists in current state"  
**Reality:** Member may have been removed in a later event  
**Fix:** Track member_added/member_removed in timeline, compute current state from full history

### ❌ Pitfall 2: Integer Division Rounding
**Wrong:** "allocation[A] + allocation[B] should equal total_tokens_minted"  
**Reality:** 100 kWh / 3 members = 33.33 kWh each → 33 + 33 + 33 = 99 (rounding)  
**Fix:** Expect ±1 stroop tolerance, verify within bounds

### ❌ Pitfall 3: Trusting Event Topic Order
**Wrong:** "topic[2] is always member_address"  
**Reality:** Only topic[0] is guaranteed to be discriminator; topic indices vary by event  
**Fix:** Read EVENTS-SPECIFICATION.md for each event's topic order

### ❌ Pitfall 4: Processing Events Out of Order
**Wrong:** "Events come from RPC in block order, so I can process incrementally"  
**Reality:** RPC may return events in arbitrary order; must sort by ledger first  
**Fix:** Sort all events by `ledger` before processing

### ❌ Pitfall 5: Assuming Cooperative Always Has Members
**Wrong:** "If I see generation_recorded, there are members in allocation"  
**Reality:** Code validation prevents this, but defensively assume possible  
**Fix:** Handle empty allocation gracefully; flag as anomaly

---

## 📞 Support & Questions

| Question | Reference |
|----------|-----------|
| "What are all the event types?" | [EVENTS-SPECIFICATION.md](./EVENTS-SPECIFICATION.md) → Event Catalog |
| "How do I rebuild state from events?" | [EVENTS-SPECIFICATION.md](./EVENTS-SPECIFICATION.md) → Data Reconstruction Examples |
| "Show me test data" | [INDEXER-FIXTURES.md](./INDEXER-FIXTURES.md) |
| "Where are events emitted in contracts?" | [EVENTS-IMPLEMENTATION.md](./EVENTS-IMPLEMENTATION.md) → Code Locations |
| "How do I query events from RPC?" | [EVENTS-IMPLEMENTATION.md](./EVENTS-IMPLEMENTATION.md) → Querying Events |
| "What's the step-by-step tutorial?" | [EVENTS-QUICKSTART.md](./EVENTS-QUICKSTART.md) |

---

## 📄 Document Index

| Document | Length | Content | Audience |
|----------|--------|---------|----------|
| **EVENTS-QUICKSTART.md** | 10 min | Tutorial, patterns, examples | All developers |
| **EVENTS-SPECIFICATION.md** | 25 min | Formal spec, all events, versioning | Indexer teams |
| **INDEXER-FIXTURES.md** | 15 min | Test fixtures, edge cases | QA, indexer devs |
| **EVENTS-IMPLEMENTATION.md** | 20 min | Code details, RPC queries, validation | Indexer architects |
| **EVENTS-README.md** | This file | Overview, links, quick reference | All audiences |

---

## 🎓 Learning Path

**Complete Beginner:**
1. Read EVENTS-QUICKSTART.md (5 min)
2. Load Fixture 1 and trace through it (5 min)
3. Skim EVENTS-SPECIFICATION.md (5 min)
4. Try minimal indexer example from QUICKSTART (10 min)
→ **Total: 25 minutes to "hello world"**

**Indexer Developer:**
1. Read EVENTS-SPECIFICATION.md fully (25 min)
2. Review all 4 fixtures in INDEXER-FIXTURES.md (15 min)
3. Implement offline indexer test suite (1–2 hours)
4. Connect to Testnet and validate (30 min)
→ **Total: 2–3 hours to production-ready**

**Contract Developer:**
1. Read EVENTS-IMPLEMENTATION.md (20 min)
2. Review code locations for each event (10 min)
3. Understand validation rules (10 min)
→ **Total: 40 minutes to understand what contracts emit**

---

## ✅ Checklist: Ready to Deploy Indexer?

Before going live:

- [ ] Offline indexer passes all 4 fixtures
- [ ] API responses match expected schema
- [ ] Member balance reconciliation passes for N random members
- [ ] Generation timeline is monotonic (ascending ledgers)
- [ ] Pause/unpause state machine enforced
- [ ] Indexer recovers from RPC connection loss
- [ ] Docs link included in codebase
- [ ] Rate limiting in place for public API
- [ ] Error logging configured
- [ ] Health check endpoint returns current ledger

---

## 📝 Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | Nov 2025 | Initial stable release; all events implemented |

---

## 📄 License

These documents and the referenced contract implementations are part of Africanking and follow the same license (Apache 2.0).

---

**Last updated:** November 2025  
**Next review:** May 2026 (or when v1.1+ is planned)


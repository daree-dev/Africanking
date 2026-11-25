# Stable Event Formats for Off-Chain APIs

> Off-chain APIs now have stable event formats to reconstruct cooperative, member allocation, and transaction history.

**Status:** ✅ Complete  
**Version:** 1.0  
**Date:** November 2025

---

## 📖 Documentation

Start here based on your role:

### 🚀 For Everyone: Overview
→ **[EVENTS-IMPLEMENTATION-SUMMARY.md](./EVENTS-IMPLEMENTATION-SUMMARY.md)** (5 min)
- What was delivered
- Acceptance criteria met
- Success metrics
- Next steps

### 🏃 For Quick Start: Get Running in 30 Minutes
→ **[docs/EVENTS-QUICKSTART.md](./docs/EVENTS-QUICKSTART.md)** (30 min)
- Event types quick reference
- Minimal Node.js indexer example
- Common patterns
- API response examples

### 📚 For Detailed Spec: Complete Reference
→ **[docs/EVENTS-SPECIFICATION.md](./docs/EVENTS-SPECIFICATION.md)** (25 min)
- All 13 event types documented
- Design principles
- Versioning strategy
- 4 test fixtures

### 💻 For Implementation: Code Details
→ **[docs/EVENTS-IMPLEMENTATION.md](./docs/EVENTS-IMPLEMENTATION.md)** (20 min)
- Code locations in contracts
- Event schemas (payload fields)
- RPC query examples
- Validation rules

### 🧪 For Testing: Fixtures & Examples
Embedded in EVENTS-SPECIFICATION.md:
- **Fixture 1:** Single member (simple flow)
- **Fixture 2:** Multi-member with update (member swap)
- **Fixture 3:** Pause/resume cycle
- **Fixture 4:** Token burns (retirement)

---

## ✨ What Changed

### Contracts

All Soroban contracts now emit stable, indexed events for state changes:

| Contract | Events | Use |
|----------|--------|-----|
| **energy_distribution** | `member_added`, `member_removed`, `generation_recorded`, `contract_paused`, `contract_unpaused` | Member mgmt, generation tracking |
| **energy_token** | `token_minted`, `token_burned`, `minter_granted`, `minter_revoked`, `contract_paused`, `contract_unpaused` | Token lifecycle |
| **cooperative_factory** | `cooperative_deployed`, `wasm_updated` | Cooperative registry |
| **community_governance** | `proposal_created` | Governance history |

**Total:** 13 event types, fully indexed, self-contained payloads.

### Documentation

**4 markdown files, 1,936 lines:**

1. **EVENTS-README.md** (349 lines) — Overview & navigation
2. **EVENTS-QUICKSTART.md** (499 lines) — Step-by-step tutorial
3. **EVENTS-SPECIFICATION.md** (553 lines) — Formal spec + fixtures
4. **EVENTS-IMPLEMENTATION.md** (535 lines) — Code reference

---

## 🎯 Acceptance Criteria ✅

- ✅ **Document event names, indexed topics, payload fields, and versioning rules**
  - All 13 events documented with complete schemas
  - Topics indexed for fast filtering
  - Versioning rules: v1 locked, v2+ for breaking changes

- ✅ **Emit events for member/share changes, generation, allocation, pause, and administrative changes**
  - Member changes: `member_added`, `member_removed`
  - Generation/allocation: `generation_recorded` (with full allocation array)
  - Pause: `contract_paused`, `contract_unpaused`
  - Admin: `minter_granted`, `minter_revoked`, `contract_upgraded`, `cooperative_deployed`

- ✅ **Provide compatibility tests or fixtures consumed by the proposed indexer**
  - 4 reproducible fixtures with expected state
  - Testing checklist (8 categories)
  - Validation rules per event type

---

## 🚀 For Indexer Developers

### Phase 1: Offline Development (Use Fixtures)
1. Load event JSON from EVENTS-SPECIFICATION.md
2. Process through your indexer
3. Verify state matches expected output
4. Test edge cases (pause, member updates, burns)

**Time:** 1–2 hours, no network required, 100% reproducible

### Phase 2: Live Testnet
1. Deploy indexer against Stellar Testnet
2. Query events for known cooperatives
3. Expose REST API (`/api/cooperatives`, `/api/members`)
4. Monitor for data freshness

**Time:** 1–2 hours, Testnet connection required

### Phase 3: Validation
1. Run reconciliation (member balance = mints - burns)
2. Compare against on-chain state
3. Flag anomalies
4. Monitor for data gaps

**Time:** Ongoing

---

## 💡 Use Cases

### Use Case 1: Monthly Generation Report
```
1. Query cooperative_deployed events
2. Filter generation_recorded by distribution_contract
3. Sum kwh_generated per member
4. Report: "July 2025: 5000 kWh generated"
```

### Use Case 2: Member Profile Dashboard
```
1. Watch for member_added events
2. Query token_minted events for member
3. Display: Cooperatives, total earned kWh, join date
```

### Use Case 3: Certificate Retirement Proof
```
1. Query token_burned events
2. Correlate with minting history
3. Display: Retired 500 kWh on [date] via certificate burn
4. Provide txn hash as proof
```

### Use Case 4: Cooperative Health Dashboard
```
1. Query all cooperatives (cooperative_deployed events)
2. For each, fetch member list (member_added/removed)
3. Calculate uptime (contract_paused/unpaused)
4. Display: Health score, member count, generation trend, uptime %
```

---

## 🔍 Event Types (Quick Reference)

### Generation & Allocation
- `member_added` — New member joins cooperative
- `member_removed` — Member leaves cooperative
- `generation_recorded` — kWh generated, allocated to members
- `token_minted` — Tokens minted for member (via generation)
- `token_burned` — Tokens burned (certificate retirement)

### Administrative
- `contract_paused` — Emergency halt
- `contract_unpaused` — Resume operations
- `contract_upgraded` — WASM version changed
- `minter_granted` — New minter authorized
- `minter_revoked` — Minter access revoked
- `cooperative_deployed` — New cooperative created
- `wasm_updated` — Factory WASM hashes updated
- `proposal_created` — New governance proposal

---

## 🧪 Testing

### Offline (Fixtures)
- Load JSON fixture (Fixture 1–4)
- Process events
- Verify state matches expected output
- No network, 100% reproducible

### Live Testnet
- Deploy indexer
- Query real cooperative events
- Verify API responses
- Measure event latency (~5s = block time)

### Validation
- Member balance reconciliation (mints - burns)
- Generation timeline monotonicity
- Pause/unpause state machine
- Member allocation sums

---

## 📋 Deployment Checklist

- [ ] Offline indexer passes all 4 fixtures
- [ ] API responses match expected schema
- [ ] Member balance reconciliation passes
- [ ] Generation timeline is monotonic (ascending ledgers)
- [ ] Pause/unpause state machine enforced
- [ ] Indexer recovers from RPC connection loss
- [ ] Error logging configured
- [ ] Health check endpoint returns current ledger

---

## 🔗 Key Files

**Documentation:**
- [EVENTS-IMPLEMENTATION-SUMMARY.md](./EVENTS-IMPLEMENTATION-SUMMARY.md) — This project summary
- [docs/EVENTS-README.md](./docs/EVENTS-README.md) — Overview & navigation
- [docs/EVENTS-QUICKSTART.md](./docs/EVENTS-QUICKSTART.md) — Tutorial & examples
- [docs/EVENTS-SPECIFICATION.md](./docs/EVENTS-SPECIFICATION.md) — Formal spec + fixtures
- [docs/EVENTS-IMPLEMENTATION.md](./docs/EVENTS-IMPLEMENTATION.md) — Code reference

**Contracts (Updated):**
- [apps/contracts/energy_distribution/src/lib.rs](./apps/contracts/energy_distribution/src/lib.rs) — Distribution events
- [apps/contracts/energy_token/src/lib.rs](./apps/contracts/energy_token/src/lib.rs) — Token events
- [apps/contracts/cooperative_factory/src/lib.rs](./apps/contracts/cooperative_factory/src/lib.rs) — Factory events
- [apps/contracts/community_governance/src/lib.rs](./apps/contracts/community_governance/src/lib.rs) — Governance events

---

## 📞 Questions?

| Question | Reference |
|----------|-----------|
| "What are all the event types?" | EVENTS-SPECIFICATION.md § Event Catalog |
| "How do I rebuild state from events?" | EVENTS-SPECIFICATION.md § Data Reconstruction |
| "Show me test data" | EVENTS-SPECIFICATION.md § Fixtures 1-4 |
| "Where are events emitted in contracts?" | EVENTS-IMPLEMENTATION.md § Code Locations |
| "How do I query events from RPC?" | EVENTS-IMPLEMENTATION.md § Querying Events |
| "What's the step-by-step tutorial?" | EVENTS-QUICKSTART.md |

---

## 🎓 Learning Path (45 minutes total)

1. **Understand the Problem** (5 min)
   - Read EVENTS-README.md § What This Solves
   - Skim: before/after comparison

2. **Learn Event Types** (5 min)
   - Read EVENTS-README.md § Event Types
   - Scan: 13 events at a glance

3. **See Example Fixture** (5 min)
   - Skim: EVENTS-SPECIFICATION.md § Fixture 1 (single member)
   - Understand: event sequence → state snapshot

4. **Build Minimal Indexer** (20 min)
   - Follow: EVENTS-QUICKSTART.md § Minimal Indexer Example
   - Code: 50-line Node.js indexer
   - Test: against Fixture 1

5. **Verify & Deploy** (10 min)
   - Review: EVENTS-QUICKSTART.md § Deployment Steps
   - Checklist: 8-item deployment checklist
   - Next: integrate with API

---

## ✅ Completed

| Item | Status | Reference |
|------|--------|-----------|
| Event specification | ✅ Complete (13 events) | EVENTS-SPECIFICATION.md |
| Event implementation | ✅ 4 contracts updated | apps/contracts/ |
| Test fixtures | ✅ 4 fixtures provided | EVENTS-SPECIFICATION.md § Fixtures |
| Documentation | ✅ 1,936 lines | 4 markdown files |
| Design principles | ✅ Specified | EVENTS-SPECIFICATION.md § Design Principles |
| Versioning rules | ✅ Defined | EVENTS-SPECIFICATION.md § Versioning |
| Indexing patterns | ✅ 5 patterns | EVENTS-SPECIFICATION.md § Indexing Patterns |
| Validation rules | ✅ Per-event | EVENTS-IMPLEMENTATION.md § Validation |
| RPC examples | ✅ Code examples | EVENTS-IMPLEMENTATION.md § Querying Events |
| Edge case coverage | ✅ Pause, swap, burn | Fixtures 2–4 |

---

## 🚀 Ready for Off-Chain Indexing

All acceptance criteria met. Contracts emit stable events. Documentation complete. Test fixtures provided. Ready for indexer development and API integration.

**Next Step:** Read [EVENTS-QUICKSTART.md](./docs/EVENTS-QUICKSTART.md) to build your indexer.


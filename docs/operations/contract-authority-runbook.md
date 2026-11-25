# Contract Authority & Upgrade Runbook

> Scope: `energy_token`, `energy_distribution`, `community_governance`, `cooperative_factory`
> (`apps/contracts/`). Applies to every network, but **production (Stellar public network)
> requirements are mandatory** and testnet shortcuts are called out explicitly.

BeEnergy is a cooperative-management tool: generation credits are assigned to cooperative
members according to their participation. The tokens are internal accounting units for the
cooperative. Nothing in this runbook makes them an external certificate marketplace instrument,
and nothing here claims I-REC, ESG, or any third-party certification.

**Never paste secret keys, seed phrases, DFNS credentials, or signed-but-unsubmitted XDR into
this document, tickets, chat, or commit history.** Public keys and contract IDs are fine.
The testnet addresses in `docs/5-CONTRACTS.md` are demo deployments controlled by a single key;
they are **not** a template for a production deployment.

---

## 1. Authority map (what the code actually enforces)

| Capability | Contract / entrypoint | On-chain check | Notes |
|---|---|---|---|
| Admin | `energy_token`, `energy_distribution` (`access_control::set_admin` in constructor) | `admin.require_auth()` | One admin `Address` per contract instance. |
| Mint credits | `energy_token.mint_energy(to, amount, minter)` | `#[only_role(minter, "minter")]` + `#[when_not_paused]` | Role granted to the distribution contract at construction, and to the platform minter account via `grant_minter`. |
| Grant / revoke minter | `energy_token.grant_minter`, `revoke_minter` | admin auth + `#[when_not_paused]` | **Cannot be called while paused** (see §5). |
| Record generation & allocate to members | `energy_distribution.record_generation(kwh)` | admin auth + `#[when_not_paused]` | Mints `kwh * percent / 100` to each member through the token contract. |
| Change member split | `energy_distribution.add_members_multisig(approvers, members, percents)` | every approver `require_auth`, `approvers.len() >= required_approvals` | `required_approvals` is fixed at construction. |
| Pause / unpause | `pause(caller)`, `unpause(caller)` on token and distribution | `caller.require_auth()` and `caller == admin` | Pause authority **is** the admin. There is no separate pauser role today. |
| Upgrade WASM | `upgrade(new_wasm_hash, operator)` on token and distribution | `operator.require_auth()` and `operator == admin` | Upgrade authority **is** the admin. |
| Factory WASM hashes & deploys | `cooperative_factory.set_wasm_hashes`, `deploy_cooperative` | factory admin auth | Controls which code every new cooperative gets. |
| Governance | `community_governance.initialize`, `create_proposal` | admin / proposer auth | Skeleton only; no voting authority yet. |

Off-chain holders of authority:

| Key / credential | Where it lives | What it can do |
|---|---|---|
| `MINTER_SECRET_KEY` | API server environment (hot key) | Sign `mint_energy` / `burn_energy` for custodial flows, only while it holds the minter role. |
| `SUPER_ADMIN_ADDRESSES` | API server environment | Off-chain admin UI permissions. Grants **no** on-chain power. |
| DFNS credentials | API server environment | Provision member wallets. No contract authority. |

### Operational roles

| Role | Holds | Must not hold |
|---|---|---|
| **Cooperative Admin Council** | Signer seats on the contract admin multisig account (token + distribution). | The hot minter key. |
| **Platform Operator** | `MINTER_SECRET_KEY`, deployment credentials for the API. | A majority of admin multisig weight. |
| **Release Manager** | Builds WASM, publishes hashes, prepares upgrade transactions. | Ability to approve their own upgrade alone. |
| **Emergency Responder (on-call)** | One admin multisig signer seat + this runbook. | Ability to upgrade alone. |
| **Member approvers** | The `approvers` used for `add_members_multisig`. | — |

Separation goal: no single person can mint unbounded credits **and** change code **and** hide it.

---

## 2. Multisig expectations

Soroban `require_auth()` on a classic `G…` account is satisfied when signatures meet the
account's **medium threshold**. Use that to put the contract admin behind a multisig without
any contract change.

Production requirements:

1. The contract `admin` for token and distribution is a dedicated Stellar account, used for
   nothing else (no payments, no trustlines beyond what is required).
2. That account has its master key weight set to `0` and at least **3 signers held by different
   people on different devices**, with medium and high thresholds set to require **2 of 3** (or
   a stricter M-of-N). Hardware wallets are preferred.
3. The `cooperative_factory` admin is a separate multisig account with the same rules.
4. `energy_distribution.required_approvals` must be `>= 2` in production. The testnet demo uses
   `1`; that is acceptable only on testnet.
5. Signer list, weights and thresholds are recorded (public keys only) in the deployment
   manifest or the operations log, and reviewed quarterly.

Known limitation: pause and upgrade share the same admin address, so they share the same
threshold. Splitting a lower-threshold pauser from a higher-threshold upgrader requires a contract
change (a dedicated pauser role) and is out of scope for this runbook.

---

## 3. Key rotation

| What | How | Cadence |
|---|---|---|
| Admin multisig signer | `SetOptions` on the admin account from a quorum of current signers: add new signer, verify, remove old signer. The contract `admin` address does not change, so no contract call is needed. | On staff change, suspected exposure, or every 12 months. |
| Contract admin address itself | Prefer signer rotation above. If the address must change, use the OpenZeppelin access-control admin transfer exposed by the deployed WASM (two-step transfer + accept). Confirm the exact entrypoint names with `stellar contract info interface --id <CONTRACT_ID> --network <net>` before preparing transactions, and rehearse on testnet first (§6). | Exceptional. |
| `MINTER_SECRET_KEY` | 1. Create the new account and fund it. 2. Admin multisig calls `grant_minter(new)`. 3. Deploy the API with the new secret. 4. Confirm a mint succeeds. 5. Admin multisig calls `revoke_minter(old)`. 6. Verify `is_minter(old) == false`. | Every 90 days and on any exposure. |
| `JWT_SECRET`, DFNS, Supabase service key | Standard secret rotation in the hosting provider; no on-chain step. | Per provider policy. |

Every rotation produces an operations log entry with the date, the public keys involved, the
transaction hashes, and the two people who performed and verified it.

---

## 4. Lost or compromised key response

| Situation | Immediate action | Follow-up |
|---|---|---|
| One admin multisig signer lost | Remaining quorum removes the lost signer with `SetOptions` and adds a replacement. | Review thresholds still satisfy §2. |
| Admin multisig signer **compromised** | Same as above, **immediately**. One signer cannot act alone, so pausing is optional. | Check recent admin-authorized transactions for that account. |
| Admin quorum lost (cannot reach threshold) | No on-chain recovery exists: pause, unpause, upgrade, `grant_minter`/`revoke_minter` and `record_generation` become permanently unavailable. | Deploy new contracts through the factory with a new multisig admin, snapshot member balances from indexed history, reissue with board approval, and publish the old contract ID as deprecated. Record the migration in the operations log. |
| `MINTER_SECRET_KEY` compromised | Call `revoke_minter(compromised)` from the admin multisig **without pausing first** (revoke is blocked while paused). Remove the secret from the API environment. | Reconcile `mint_log` against indexed `mint` events to find unauthorized mints; handle them with a board-approved corrective burn or re-allocation. |
| API server compromised | Rotate `MINTER_SECRET_KEY` as above, rotate all server secrets, and set the API to read-only (remove `MINTER_SECRET_KEY`) until the investigation is complete. | — |

---

## 5. Emergency pause

Who may pause: the admin multisig (any quorum). The on-call Emergency Responder holds one seat
and must reach one more signer.

Pause when:
- mints or allocations are observed that do not match approved generation records;
- a contract vulnerability is reported or suspected;
- the admin or minter keys are suspected compromised **and** revocation alone is insufficient.

Procedure:
1. Open an incident and notify the Admin Council.
2. Prepare `pause(admin)` on **both** `energy_distribution` and `energy_token`. Simulate first.
3. Collect signatures, submit, and verify `paused() == true` on both contracts.
4. Disable write routes in the API (remove `MINTER_SECRET_KEY` or set the API to read-only).
5. Post an incident note for cooperative members.

Effects while paused: `mint_energy`, `burn_energy`, `transfer`, `transfer_from`, `burn`,
`burn_from`, `record_generation`, `add_members_multisig`, **`grant_minter` and `revoke_minter`**
are blocked. Read-only calls keep working.

Because revoke is blocked while paused, revoke a compromised minter **before** pausing. If
already paused: unpause → `revoke_minter` → pause, as three back-to-back transactions with
signatures collected in advance.

Unpause needs the same quorum, plus a written root-cause note and verification that the
original trigger is resolved.

---

## 6. Upgrades

`upgrade(new_wasm_hash, operator)` replaces the contract code in place. Contract ID, storage and
balances are kept. The constructor does **not** run again.

### 6.1 Pre-upgrade verification

- [ ] Change is merged to `main` with review from someone other than the Release Manager.
- [ ] `cd apps/contracts && cargo test` passes, including the authorization tests listed in §7.
- [ ] WASM is built reproducibly from the tagged commit with the pinned toolchain
      (`rust-toolchain.toml`) and target `wasm32v1-none`. Two people build independently and get
      the **same SHA-256 hash**.
- [ ] Storage compatibility review: no `DataKey` variant removed, renamed or reordered, no type
      change for an existing key, and no new required key without a migration path. Any new
      instance key has a safe default for already-deployed contracts.
- [ ] Public interface diff (`stellar contract info interface`) has been reviewed. Removed or
      changed entrypoints are listed, along with the API routes and indexer filters they affect.
- [ ] Events: any change to event topics or data is reflected in the event indexer.
- [ ] The WASM is uploaded (`stellar contract upload`) and the returned hash matches the
      reproducible build.

### 6.2 Approval

- Written approval in the operations log from at least two Admin Council members, naming the
  contract IDs, the old WASM hash, the new WASM hash, and the commit.
- The approval and the multisig signatures are separate acts. Signers check the hash in the
  transaction they sign against the approved hash.

### 6.3 Testnet rehearsal (mandatory before production)

1. Deploy the **currently deployed production WASM** to testnet, using a testnet multisig admin
   with the same threshold shape.
2. Seed realistic state: members with percents, several `record_generation` calls, transfers,
   burns, a granted minter.
3. Snapshot state: `balance` for each member, `total_supply`, `get_total_generated`,
   `get_member_list`, `is_minter`, `admin`, `paused`.
4. Run `upgrade(new_hash, admin)` with the multisig.
5. Re-read the snapshot and compare it. Every value must be identical unless the release notes
   say otherwise.
6. Exercise the authorization paths again: non-admin `pause`/`upgrade` fails, minter can mint,
   revoked minter cannot mint, and the paused contract blocks writes.
7. Run the API against the rehearsal contracts, with one mint and one retire through the API, and
   confirm the indexer sees the events.
8. Attach the transaction hashes and the snapshot diff to the approval record.

Testnet keys used for the rehearsal are disposable and must never be reused on the public
network.

### 6.4 Production execution

1. Announce a maintenance window. Optionally pause first if the upgrade changes write paths.
2. Submit `upgrade` for `energy_token` and `energy_distribution` separately and verify each.
3. Repeat the §6.3 step 3 snapshot comparison on production.
4. Update the deployment manifest (`version`, `wasmHash`) and redeploy the API so the
   configuration fingerprint reflects the new version.

### 6.5 Rollback limitations

- Rollback = `upgrade(previous_hash, admin)`. This works **only** if the new version has not
  written storage that the old version cannot read. If the new version migrated or added data,
  rolling back can corrupt reads. Treat any release with a storage migration as **not
  rollback-safe** and say so in the approval record.
- Rollback does not undo transactions that ran on the new version. Mints, burns, transfers and
  events stay on-chain.
- If the admin quorum is lost after an upgrade, no rollback is possible (§4).
- The factory keeps its own WASM hashes. Roll it back separately with `set_wasm_hashes`, or new
  cooperatives will keep getting the new code.

---

## 7. Validation of this runbook

Review this runbook against the contract authorization tests whenever contract code changes:

| Runbook claim | Test(s) |
|---|---|
| Only admin grants/revokes minter | `energy_token`: `test_grant_minter_not_admin`, `test_revoke_minter_not_admin`, `test_grant_and_revoke_minter` |
| Non-minters and revoked minters cannot mint | `test_non_minter_cannot_mint`, `test_revoked_minter_cannot_mint` |
| Only admin can pause/unpause | `test_admin_can_pause`, `test_non_admin_cannot_pause`, `test_non_admin_cannot_unpause` (token and distribution) |
| Pause blocks writes | `test_mint_fails_when_paused`, `test_burn_fails_when_paused`, `test_transfer_fails_when_paused`, `test_record_generation_fails_when_paused`, `test_add_members_fails_when_paused` |
| Operations resume after unpause | `test_operations_resume_after_unpause` (token and distribution) |
| Only admin can upgrade | `test_upgrade_requires_admin` |
| Only factory admin deploys | `cooperative_factory`: `test_only_factory_admin_can_deploy` |

If a claim in this runbook is not covered by a test, add the test before relying on the claim in
production. A staged upgrade rehearsal (§6.3) must be completed and recorded at least once
before the first production deployment, and before every production upgrade after that.

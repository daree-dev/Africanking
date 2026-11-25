# Operational runbooks

This document covers the three incident classes operators encounter most: meter feed stoppage, pending chain transactions, and data corrections. Each section follows the same structure: detection → triage → safe retry → escalation → member communication.

**General rule:** no direct database edits that bypass the application's audit trail or chain reconciliation. If a fix cannot be applied through the API or approved operator tooling, it requires cooperative approval and must be logged in the incident record before execution.

---

## Incident class 1 — Meter feed stopped

**Definition:** a registered meter has not submitted a reading within its expected window (default: 24 h for daily reporting meters).

### Detection

The API records each reading's `created_at` and the meter's `last_seen_at`. An absence alert fires when:

```
now() - meter.last_seen_at > meter.expected_interval_hours * 1.5
```

Operators can check the current state:

```bash
# List meters with no reading in the last 48 h (dry run — read only)
curl -s "$API_URL/api/meters?stale=48h" \
  -H "Authorization: Bearer $OPERATOR_JWT" | jq '.[] | {id, name, last_seen_at}'
```

### Triage

1. Check the meter's network connectivity separately (IoT gateway logs, not this platform).
2. Confirm the meter's `active` flag is `true` in the platform:
   ```bash
   curl -s "$API_URL/api/meters/<METER_ID>" \
     -H "Authorization: Bearer $OPERATOR_JWT" | jq '{id, active, last_seen_at}'
   ```
3. If the meter is active but silent, classify as a device-side failure. No platform action needed until readings resume.
4. If the meter was recently registered or reconfigured, verify the meter's API key is valid and the endpoint URL points to the correct environment (`/api/meters/readings`).

### Safe retry

When device-side connectivity is restored, readings resume automatically. The platform accepts backdated readings:

```bash
# Submit a backdated reading (replace values as appropriate)
curl -X POST "$API_URL/api/meters/readings" \
  -H "Authorization: Bearer $METER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "meter_id": "<METER_ID>",
    "kwh_injected": 42.5,
    "reading_date": "2026-01-15T14:00:00Z",
    "power_w": 3200
  }'
```

Readings submitted out of order are stored with their declared `reading_date`. The generation history UI renders them in chronological order.

### Escalation

If a meter is silent for more than 7 days:

1. Notify the cooperative admin via the platform's notification system.
2. If the gap will affect a certification period, notify the core team so the period can be held open pending the readings.
3. Mark the meter as `needs_review` in the platform (requires cooperative admin role):
   ```bash
   curl -X PATCH "$API_URL/api/meters/<METER_ID>" \
     -H "Authorization: Bearer $COOP_ADMIN_JWT" \
     -H "Content-Type: application/json" \
     -d '{"needs_review": true, "review_note": "Silent since 2026-01-15"}'
   ```

### Member communication

Inform cooperative members that readings for the affected period are pending. Do not issue or allocate generation credits for a period until all contributing meters have submitted (or been explicitly excluded with cooperative approval).

---

## Incident class 2 — Transaction pending on chain

**Definition:** a mint, burn, or distribution transaction submitted to Stellar Testnet has not reached a final status (success or failed) within 30 seconds of submission.

### Detection

Transactions are tracked in the platform database with a `stellar_tx_hash` and a `chain_status` column (`pending`, `success`, `failed`). A background job polls Horizon every 10 s and updates status.

Check for stuck transactions:

```bash
# List transactions pending for more than 5 minutes
curl -s "$API_URL/api/admin/transactions?status=pending&older_than=5m" \
  -H "Authorization: Bearer $OPERATOR_JWT" | jq '.[] | {id, type, stellar_tx_hash, created_at}'
```

### Triage

1. Look up the transaction on Horizon directly:
   ```bash
   curl -s "https://horizon-testnet.stellar.org/transactions/<TX_HASH>" \
     | jq '{successful, ledger, envelope_xdr}'
   ```
2. If Horizon returns `successful: true` but the platform still shows `pending`, the status polling job has fallen behind. Trigger a manual sync:
   ```bash
   curl -X POST "$API_URL/api/admin/sync-tx-status" \
     -H "Authorization: Bearer $OPERATOR_JWT" \
     -d '{"tx_hash": "<TX_HASH>"}'
   ```
3. If Horizon returns no result, the transaction may not have been submitted (network error at submission time). Check the application logs for the original submission error.
4. If Horizon returns a failure code, see the **Failed transaction** path below.

### Failed transaction

A failed transaction does **not** automatically retry. Steps:

1. Identify the failure reason from the Horizon result code (e.g. `op_bad_auth`, `tx_insufficient_fee`).
2. Correct the root cause (re-fund the account, fix the sequence number, etc.).
3. Re-submit through the platform API — do not reuse the original XDR, as the sequence number will be stale:
   ```bash
   # Re-trigger a mint for a specific reading batch (cooperative admin + operator required)
   curl -X POST "$API_URL/api/certificates/mint" \
     -H "Authorization: Bearer $COOP_ADMIN_JWT" \
     -H "Content-Type: application/json" \
     -d '{"reading_ids": ["<READING_ID_1>", "<READING_ID_2>"]}'
   ```
4. Record the original failed hash and the replacement hash in the incident log.

### Escalation

If a transaction remains unresolved for more than 1 hour:

- Notify the core team. Chain issues on Testnet may require waiting for network recovery.
- If the transaction involves a cooperative allocation, notify the cooperative admin and hold further allocations until resolved.

### Member communication

Do not communicate individual transaction hashes to members. Communicate at the level of the generation credit: "Your credits for period X are being processed and will appear within Y hours."

---

## Incident class 3 — Corrected reading affects an issued allocation

**Definition:** a meter reading that has already been used to allocate generation credits is found to be incorrect (over-reported, under-reported, or attributed to the wrong period).

### Detection

Cooperative admins flag a reading as disputed:

```bash
curl -X PATCH "$API_URL/api/meters/readings/<READING_ID>" \
  -H "Authorization: Bearer $COOP_ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"disputed": true, "dispute_note": "Inverter SCADA reported 10% lower than submitted"}'
```

The platform marks downstream certificates as `under_review` and blocks their further use until the dispute is resolved.

### Triage

1. Confirm the correct value with the meter operator (check inverter SCADA, distribution company meter record, or utility bill).
2. Determine the magnitude of the correction:
   - **Minor adjustment (≤ 5% of the allocated amount):** proceed with correction after cooperative admin approval.
   - **Material adjustment (> 5%):** requires documented cooperative approval before any on-chain action.

### Reconciliation (dry run first)

The reconciliation command shows what would change without committing anything:

```bash
# Dry run — shows delta, does not write
curl -X POST "$API_URL/api/admin/reconcile-reading" \
  -H "Authorization: Bearer $OPERATOR_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "reading_id": "<READING_ID>",
    "corrected_kwh": 38.2,
    "dry_run": true
  }'
```

Review the output: `affected_certificates`, `delta_kwh`, `members_affected`. Confirm with the cooperative admin before proceeding.

### Applying the correction

If the certificates for the affected period have **not yet been minted on chain**:

```bash
# Update reading and re-calculate allocation (requires cooperative admin approval)
curl -X POST "$API_URL/api/admin/reconcile-reading" \
  -H "Authorization: Bearer $OPERATOR_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "reading_id": "<READING_ID>",
    "corrected_kwh": 38.2,
    "dry_run": false,
    "approval_ref": "<COOP_APPROVAL_ID>"
  }'
```

If the certificates have **already been minted on chain**, on-chain data cannot be altered. The correct procedure is:

1. Burn the over-issued tokens on-chain (cooperative admin signs the burn transaction through the platform UI — there is no CLI shortcut for this).
2. Mint new tokens with the corrected amount.
3. Record both the burn and mint hashes in the incident log alongside the approval reference.

**Prohibited:** editing the `kwh_injected` column directly in the database, adjusting on-chain balances without a matching platform event, or closing the dispute without documenting the resolution.

### Escalation

Corrections affecting more than one cooperative member's allocation require cooperative approval (majority vote if the cooperative's governance contract is active). Log the governance proposal ID in the incident record.

### Member communication

Notify affected members via the platform's notification system. The message should state:

- The corrected period
- The original and corrected kWh amounts for their share
- Whether their credit balance changed and by how much
- The approval reference

Do not share raw database IDs or transaction hashes in member-facing messages.

---

## Staging rehearsal note

Before this runbook is used in production, run through at least one complete scenario (recommended: Incident class 2, failed transaction) in the staging environment. Record any steps that differ from the above and update this document. The runbook version that ships to production must reflect the actual staging observations.

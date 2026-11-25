# Security Architecture & Threat Model

This document is the maintained threat model for the cooperative energy platform. It covers the trust boundaries between cooperative data, wallet identity, service-role database access, and the server-side minter key.

**Product direction:** generation credits are assigned to cooperative members. This is a cooperative-management tool — it is **not** an external certificate marketplace and makes **no** claim of I-REC/ESG certification.

## 1. Assets

| Asset | Where it lives | Sensitivity |
| --- | --- | --- |
| Cooperative membership records | `members` table (service-role access) | High — PII + authorization source |
| Generation credit assignments | `credits` / `assignments` tables | High — economic value |
| Ingestion batches (meter/telemetry data) | `ingestions` table + storage | Medium — integrity-critical |
| Review decisions | `reviews` table | High — audit trail |
| Wallet identity / signatures | auth layer, `wallets` table | High — authentication root |
| Minter key (server-side) | server env / secret store | Critical — can mint credits |
| Service-role DB key | server env / secret store | Critical — bypasses RLS |

## 2. Trust boundaries

1. **Browser ↔ API** — untrusted client; all input validated server-side.
2. **API ↔ Database** — service-role key bypasses row-level security; every query must scope by cooperative/tenant explicitly.
3. **API ↔ Minter** — the minter key is server-only and never exposed to clients.
4. **Wallet ↔ Auth** — signatures verified server-side before any privileged action.
5. **Operator ↔ Admin** — administrative actions require elevated role checks.

## 3. Threat actors

- **Anonymous internet user** — no credentials.
- **Authenticated member of cooperative A** — may attempt cross-tenant access to cooperative B.
- **Malicious/compromised client** — replays or forges requests.
- **Insider operator** — has legitimate admin tooling, may over-reach.
- **External attacker with leaked secret** — holds a service-role or minter key.

## 4. Abuse cases, mitigations, and verification

### Authentication
- **Abuse:** forged wallet signature grants membership; replay of a signed message.
- **Mitigation:** server-side signature verification with nonce/expiry; wallet bound to member record.
- **Verification:** auth route tests covering invalid signature and replayed nonce; operational alert on verification failures.

### Ingestion
- **Abuse:** member of cooperative A submits telemetry tagged for cooperative B; malformed batch poisons credits.
- **Mitigation:** ingestion route derives `cooperative_id` from the authenticated session, never from the request body; schema validation before persistence.
- **Verification:** ingestion route test asserting cross-tenant payload is rejected; schema-validation unit tests.

### Review
- **Abuse:** reviewer approves their own submission; review of another tenant's batch.
- **Mitigation:** review policy forbids self-approval and enforces tenant scoping; review decisions are append-only.
- **Verification:** review policy tests for self-approval rejection and cross-tenant denial; audit-log assertions.

### Minting
- **Abuse:** client triggers minting directly; minter key leaked; credits minted for wrong cooperative.
- **Mitigation:** minting only via server-side contract method gated on an approved review; minter key held in secret store, rotated on suspicion; mint amount and tenant checked against the approved review record.
- **Verification:** contract method tests asserting mint requires an approved review and correct tenant; operational control: key rotation runbook + access audit.

### Administration
- **Abuse:** member escalates to admin; admin action on another cooperative's data.
- **Mitigation:** role checks on every admin route; service-role queries always filter by `cooperative_id`; admin actions logged.
- **Verification:** admin route tests for role enforcement and tenant scoping; audit-log review as an operational control.

## 5. Review process

Re-review this threat model whenever a **new data source** or **new privileged action** is introduced (new route, new contract method, new secret, new table with service-role access). The reviewer must:

1. Add the new asset/boundary/abuse case to the relevant section above.
2. Link each high-risk scenario to an automated test or an operational control.
3. Confirm no migration or rollout step weakens an existing boundary; document any migration/rollout requirement in the PR.

## 6. Rollout & data preservation

This document introduces no schema or data changes. Any future migration referenced here must preserve existing cooperative data and be documented in the corresponding PR before merge.

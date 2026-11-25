# Threat Model: Tenant Boundaries and Privileged Workflows

Status: Reviewed
Owner: Security architecture
Scope: Cooperative data platform (cooperative management, generation credits, wallet identity, service-role database access, server-side minter key).

This document is a maintained threat model. It is **not** a claim of I-REC/ESG certification and does not describe an external certificate marketplace. Generation credits are assigned to cooperative members under cooperative management.

## 1. Assets

| Asset | Description | Sensitivity |
| --- | --- | --- |
| Cooperative membership data | Members, roles, and cooperative-to-member associations | High (tenant boundary) |
| Generation credit records | Credits assigned to cooperative members | High (value-bearing) |
| Wallet identity | Wallet addresses linked to members/cooperatives | High (authn/authz) |
| Service-role database credentials | Server-side DB access bypassing row-level security | Critical |
| Minter key | Server-side key that signs/authorizes minting | Critical |
| Audit/export data | Cooperative audit exports | Medium–High |

## 2. Trust boundaries

1. **Client ↔ API**: untrusted browser/wallet client to server routes. All input untrusted.
2. **API ↔ Database (service role)**: server code using service-role credentials; bypasses RLS, so tenant scoping must be enforced in application code.
3. **API ↔ Minter**: server-side minter key; only privileged minting workflow may invoke it.
4. **Cooperative ↔ Cooperative (tenant boundary)**: one cooperative's members/data must never be readable or writable by another.
5. **Member ↔ Reviewer/Admin**: role boundary between ordinary members, reviewers, and administrators.

## 3. Threat actors

- **Anonymous external attacker**: no account, probes public routes.
- **Authenticated member (malicious/curious)**: valid wallet, attempts cross-tenant access or privilege escalation.
- **Compromised client**: stolen session/wallet signature replayed.
- **Insider/operator**: has or seeks service-role or minter access.
- **Supply-chain attacker**: malicious dependency or leaked secret.

## 4. Abuse cases and mitigations by workflow

### Authentication
- Abuse: forged/replayed wallet signature; session fixation; identity spoofing across cooperatives.
- Mitigations: signature verification with nonce/expiry; session bound to verified wallet; membership lookup scoped to cooperative.
- Verification evidence: auth route tests covering invalid/replayed signatures; session tests.

### Ingestion (new data sources)
- Abuse: injecting records into another cooperative; oversized/malformed payloads; unvalidated external source.
- Mitigations: schema validation at ingestion route; cooperative id derived from authenticated context, never from client body; per-source allowlist.
- Verification evidence: ingestion route tests asserting cross-tenant writes are rejected; validation tests.

### Review
- Abuse: member approving own submission; reviewer acting outside assigned cooperative.
- Mitigations: role check on review route; reviewer-cooperative scoping; separation of submitter/reviewer.
- Verification evidence: review policy tests for role and tenant enforcement.

### Minting
- Abuse: unauthorized mint; minting credits to wrong cooperative; minter key misuse.
- Mitigations: minting only via privileged server route; minter key never exposed to client; credit assignment validated against cooperative membership; idempotency to prevent double-mint.
- Verification evidence: minting route tests for authorization and tenant scoping; contract method tests for access control and idempotency.

### Administration
- Abuse: privilege escalation to admin; service-role misuse; bulk export of other tenants' data.
- Mitigations: explicit admin role checks; service-role usage confined to server modules; audit logging of privileged actions; export scoped to caller's cooperative.
- Verification evidence: admin route authorization tests; audit-export scoping tests; static checks in CI for service-role/minter key usage.

## 5. Concrete mapping (routes, policies, contract methods)

| Workflow | Surface | Mitigation | Verification |
| --- | --- | --- | --- |
| Authentication | auth routes | signature + nonce verification, session binding | auth route tests |
| Ingestion | ingestion routes | schema validation, server-derived cooperative id | ingestion tests |
| Review | review routes / review policy | role + tenant scoping | review policy tests |
| Minting | minting route / minter contract method | privileged-only, idempotent, tenant-scoped | minting + contract tests |
| Administration | admin routes / export | admin role check, audit log, tenant-scoped export | admin + export tests |
| Data access | service-role DB module | confined usage, app-level tenant scoping | CI static checks |

## 6. Review process

- Re-review this model whenever a **new data source** or **new privileged action** (route, policy, or contract method) is introduced.
- Each high-risk scenario must link to an automated test or an operational control before merge.
- Record review date and reviewer in the PR that introduces the change.

## 7. Rollout and data preservation

This is a documentation change only. No schema, data, or migration changes are required; existing data is preserved. Future changes that alter trust boundaries must document migration/rollout requirements in the same PR.

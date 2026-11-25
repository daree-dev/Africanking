# Cooperative Tenancy and Data Ownership

This document defines the ownership boundary for cooperative records. It is the
single source of truth for how resources are scoped, how ownership is derived,
and how authorization is enforced. It complements the domain glossary and field
mapping; it does not introduce an external certificate marketplace or any
I-REC/ESG certification claim. Generation credits are assigned to cooperative
members.

## Ownership graph

Every resource belongs to exactly one cooperative. Ownership is derived from the
resource's parent chain, never from a client-supplied cooperative ID.

```
Cooperative (tenant root)
├── Membership (user ↔ cooperative, role)
│   └── Member (cooperative member profile)
│       └── CreditAssignment (generation credits assigned to a member)
├── Meter (physical/logical meter owned by the cooperative)
│   └── Reading (meter reading, immutable once recorded)
└── AuditEvent (append-only record of changes within the cooperative)
```

Ownership rules:

- **Cooperative** is the tenant root. It owns members, meters, and audit events.
- **Membership** links a user to a cooperative and carries the role used for
authorization. A user may hold memberships in multiple cooperatives; each
membership is scoped to one cooperative.
- **Member** is a cooperative-scoped profile. It is reachable only through its
cooperative.
- **Meter** belongs to one cooperative. Its `cooperativeId` is set from the
creating membership, not from request input.
- **Reading** belongs to a meter; its cooperative is derived as
`reading.meter.cooperative`. Readings are immutable and never re-parented.
- **CreditAssignment** belongs to a member; its cooperative is derived as
`credit.member.cooperative`. Credits are assigned to members, not to external
parties.
- **AuditEvent** belongs to the cooperative whose action produced it and is
append-only. It records actor, resource, and derived cooperative.

## Deriving ownership

Ownership is always resolved server-side from the authenticated session:

1. Resolve the acting user from the session.
2. Resolve the user's membership(s) for the target cooperative.
3. Derive the resource's cooperative from its parent chain (see graph above).
4. Reject the request unless the derived cooperative matches an active
membership for the user.

Client-supplied `cooperativeId` values are treated as hints at most and are
never trusted for authorization. If a request includes a cooperative ID that
does not match the derived ownership, the request is rejected.

## Roles: platform vs cooperative

| Role | Scope | Can do | Cannot do |
| --- | --- | --- | --- |
| Platform administrator | Cross-tenant (platform) | Manage cooperatives, provision tenants, view platform-level audit | Act as a cooperative member; read member-scoped data without an explicit, audited support action |
| Cooperative administrator | One cooperative | Manage members, meters, and credit assignments within their cooperative; view that cooperative's audit events | Access another cooperative's records; change platform-level settings |
| Cooperative member | One cooperative | View their own member profile, meters, readings, and assigned credits | Manage other members; access another cooperative's records |

Platform administrators are not cooperative administrators. Platform access is
cross-tenant and limited to tenant lifecycle operations; cooperative data access
requires an explicit, audited support action. Cooperative administrators and
members are always scoped to a single cooperative via membership.

## Enforcement

- Every API route resolves the acting membership before touching data.
- Queries are filtered by the derived cooperative, not by request parameters.
- Cross-cooperative access returns `404` (not `403`) to avoid leaking existence.
- Audit events are written for membership, meter, reading, and credit changes.

## Validation

Tests must prove a user cannot access another cooperative's records:

- A member of cooperative A cannot read, update, or delete cooperative B's
members, meters, readings, or credits.
- A cooperative administrator of A cannot manage B's members or meters.
- A request with a spoofed `cooperativeId` for B while authenticated to A is
rejected.
- A platform administrator cannot read member-scoped data without an audited
support action.

## Migration and rollout

Risk: high. Existing data must be preserved.

- Backfill `cooperativeId` on meters and audit events from existing parent
relationships before enforcing derived ownership.
- Backfill memberships for existing users so role checks have a source.
- Roll out enforcement behind a flag: derive ownership and log mismatches first,
then reject mismatches once logs are clean.
- No destructive migrations; add nullable columns, backfill, then tighten.

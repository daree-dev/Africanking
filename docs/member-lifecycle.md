# Member Lifecycle and Historical Preservation

This document defines how cooperative members join, change roles, become
inactive, and leave. It is part of the cooperative-management product
direction: generation credits are assigned to cooperative members. This is
**not** an external certificate marketplace and makes **no** claim of
I-REC/ESG certification.

## Membership states

| State        | Meaning                                                                 |
| ------------ | ----------------------------------------------------------------------- |
| `invited`    | Member record created, not yet active. No allocations permitted.        |
| `active`     | Full member. May hold roles and receive generation-credit allocations.  |
| `suspended`  | Temporarily inactive. Retains history; no new allocations.              |
| `departed`   | Left the cooperative. Terminal state; history retained.                 |

`departed` is terminal. A departed member may only be re-admitted by creating
a new membership record (a new `memberId`), never by mutating the old one.

## Effective dates

Every state change carries an `effectiveDate` (ISO `YYYY-MM-DD`).

- A transition applies to allocations and reports dated **on or after** its
  `effectiveDate`.
- Allocations and reports dated **before** the `effectiveDate` are unaffected.
- `effectiveDate` must not precede the member's `joinedOn` date.
- `effectiveDate` must not precede the `effectiveDate` of the member's most
  recent transition (transitions are monotonic in time).

## Permitted transitions

| From        | To          | Operation        |
| ----------- | ----------- | ---------------- |
| `invited`   | `active`    | `join`           |
| `active`    | `suspended` | `suspend`        |
| `suspended` | `active`    | `reinstate`      |
| `active`    | `departed`  | `depart`         |
| `suspended` | `departed`  | `depart`         |

Role changes (`changeRole`) are permitted only while `active` and are recorded
as audited events without changing membership state.

All other transitions are invalid and must be rejected, including:

- `invited` → `suspended` / `departed`
- `active` → `active` (no-op join)
- `departed` → any state
- any transition whose `effectiveDate` violates the rules above

## Audited operations

Each operation appends an immutable audit event:

```ts
type MemberEvent = {
  memberId: string;
  type: 'join' | 'changeRole' | 'suspend' | 'reinstate' | 'depart';
  effectiveDate: string; // YYYY-MM-DD
  fromState: MembershipState;
  toState: MembershipState;
  role?: MemberRole;     // present for changeRole
  actorId: string;
  recordedAt: string;    // ISO timestamp
};
```

Operations exposed by the member service:

- `join(memberId, effectiveDate, actorId)`
- `changeRole(memberId, role, effectiveDate, actorId)`
- `suspend(memberId, effectiveDate, actorId)`
- `reinstate(memberId, effectiveDate, actorId)`
- `depart(memberId, effectiveDate, actorId)`

Each operation validates the transition and effective-date rules, appends an
event, and updates the member's current state. Invalid transitions return an
error and append nothing.

## Historical preservation

Allocations and reports reference members by `memberId` and are **never**
deleted or rewritten when a member becomes `suspended` or `departed`.

- Historical allocations remain attributed to the member as of their own
  `effectiveDate`.
- Reports generated for periods before a transition are stable and reproduce
  identically after the transition.
- Inactive members (`suspended`, `departed`) are excluded from *new* allocation
  runs but remain visible in historical views.

## Validation

Tests must cover:

- Valid transitions for each row in the permitted-transitions table.
- Invalid transitions (e.g. `departed` → `active`, `invited` → `departed`).
- Effective-date boundaries: a transition dated `D` affects allocations on `D`
  but not on `D-1`; dates before `joinedOn` or before the prior transition are
  rejected.
- Retained history: allocations and reports created before a `suspend` or
  `depart` are unchanged afterward.

## Migration and rollout

- Existing members without a state default to `active` with `joinedOn` as the
  effective date of an implicit `join` event.
- Existing allocations and reports require no changes; they already reference
  members by `memberId`.
- Rollout: deploy the state field and audit log first (backfill implicit join
  events), then enable the lifecycle operations. No destructive migration is
  required.

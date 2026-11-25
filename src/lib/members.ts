/**
 * Cooperative member lifecycle.
 *
 * Members join, change roles, become suspended/inactive, and depart without
 * deleting historical readings or allocations that reference them. Historical
 * records are preserved by keeping member records (never hard-deleting) and by
 * snapshotting the member's role/state onto allocations at creation time.
 *
 * Generation credits are assigned to cooperative members; this is not an
 * external certificate marketplace or a claim of I-REC/ESG certification.
 */

export type MembershipState =
  | "invited"
  | "active"
  | "suspended"
  | "inactive"
  | "departed";

export type MemberRole = "member" | "operator" | "admin";

export interface MemberRecord {
  id: string;
  cooperativeId: string;
  displayName: string;
  state: MembershipState;
  role: MemberRole;
  /** ISO date (YYYY-MM-DD) the current state/role took effect. */
  effectiveFrom: string;
  /** ISO date the member departed, if applicable. */
  departedAt?: string;
}

export interface MemberAuditEntry {
  memberId: string;
  cooperativeId: string;
  operation: MemberOperation;
  fromState: MembershipState;
  toState: MembershipState;
  fromRole: MemberRole;
  toRole: MemberRole;
  effectiveFrom: string;
  recordedAt: string;
  actorId: string;
  reason?: string;
}

export type MemberOperation =
  | "join"
  | "role-change"
  | "suspend"
  | "reactivate"
  | "depart";

/**
 * Permitted state transitions. A member may only move along these edges.
 * Departed is terminal; history is retained rather than deleted.
 */
export const PERMITTED_TRANSITIONS: Record<MembershipState, MembershipState[]> = {
  invited: ["active", "departed"],
  active: ["suspended", "inactive", "departed"],
  suspended: ["active", "inactive", "departed"],
  inactive: ["active", "departed"],
  departed: [],
};

export class MemberLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemberLifecycleError";
  }
}

function assertIsoDate(value: string, field: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new MemberLifecycleError(`${field} must be an ISO date (YYYY-MM-DD)`);
  }
}

function assertEffectiveDate(current: string, next: string): void {
  assertIsoDate(next, "effectiveFrom");
  if (next < current) {
    throw new MemberLifecycleError(
      `effectiveFrom ${next} precedes current effective date ${current}`,
    );
  }
}

function assertTransition(from: MembershipState, to: MembershipState): void {
  if (!PERMITTED_TRANSITIONS[from].includes(to)) {
    throw new MemberLifecycleError(
      `transition ${from} -> ${to} is not permitted`,
    );
  }
}

function audit(
  member: MemberRecord,
  operation: MemberOperation,
  fromState: MembershipState,
  fromRole: MemberRole,
  actorId: string,
  recordedAt: string,
  reason?: string,
): MemberAuditEntry {
  return {
    memberId: member.id,
    cooperativeId: member.cooperativeId,
    operation,
    fromState,
    toState: member.state,
    fromRole,
    toRole: member.role,
    effectiveFrom: member.effectiveFrom,
    recordedAt,
    actorId,
    reason,
  };
}

export interface JoinInput {
  id: string;
  cooperativeId: string;
  displayName: string;
  role?: MemberRole;
  effectiveFrom: string;
  actorId: string;
  recordedAt: string;
}

export function joinMember(input: JoinInput): {
  member: MemberRecord;
  audit: MemberAuditEntry;
} {
  assertIsoDate(input.effectiveFrom, "effectiveFrom");
  const member: MemberRecord = {
    id: input.id,
    cooperativeId: input.cooperativeId,
    displayName: input.displayName,
    state: "active",
    role: input.role ?? "member",
    effectiveFrom: input.effectiveFrom,
  };
  return {
    member,
    audit: audit(
      member,
      "join",
      "invited",
      "member",
      input.actorId,
      input.recordedAt,
    ),
  };
}

export interface ChangeRoleInput {
  role: MemberRole;
  effectiveFrom: string;
  actorId: string;
  recordedAt: string;
  reason?: string;
}

export function changeMemberRole(
  member: MemberRecord,
  input: ChangeRoleInput,
): { member: MemberRecord; audit: MemberAuditEntry } {
  if (member.state === "departed") {
    throw new MemberLifecycleError("cannot change role of a departed member");
  }
  assertEffectiveDate(member.effectiveFrom, input.effectiveFrom);
  const fromRole = member.role;
  const updated: MemberRecord = {
    ...member,
    role: input.role,
    effectiveFrom: input.effectiveFrom,
  };
  return {
    member: updated,
    audit: audit(
      updated,
      "role-change",
      member.state,
      fromRole,
      input.actorId,
      input.recordedAt,
      input.reason,
    ),
  };
}

export interface StateChangeInput {
  effectiveFrom: string;
  actorId: string;
  recordedAt: string;
  reason?: string;
}

function transitionState(
  member: MemberRecord,
  to: MembershipState,
  operation: MemberOperation,
  input: StateChangeInput,
): { member: MemberRecord; audit: MemberAuditEntry } {
  assertTransition(member.state, to);
  assertEffectiveDate(member.effectiveFrom, input.effectiveFrom);
  const updated: MemberRecord = {
    ...member,
    state: to,
    effectiveFrom: input.effectiveFrom,
    ...(to === "departed" ? { departedAt: input.effectiveFrom } : {}),
  };
  return {
    member: updated,
    audit: audit(
      updated,
      operation,
      member.state,
      member.role,
      input.actorId,
      input.recordedAt,
      input.reason,
    ),
  };
}

export function suspendMember(
  member: MemberRecord,
  input: StateChangeInput,
): { member: MemberRecord; audit: MemberAuditEntry } {
  return transitionState(member, "suspended", "suspend", input);
}

export function reactivateMember(
  member: MemberRecord,
  input: StateChangeInput,
): { member: MemberRecord; audit: MemberAuditEntry } {
  return transitionState(member, "active", "reactivate", input);
}

export function departMember(
  member: MemberRecord,
  input: StateChangeInput,
): { member: MemberRecord; audit: MemberAuditEntry } {
  return transitionState(member, "departed", "depart", input);
}

/**
 * A historical allocation references a member by id and snapshots the role and
 * state at allocation time, so later lifecycle changes never rewrite history.
 */
export interface AllocationSnapshot {
  memberId: string;
  role: MemberRole;
  state: MembershipState;
  effectiveFrom: string;
}

export function snapshotForAllocation(member: MemberRecord): AllocationSnapshot {
  return {
    memberId: member.id,
    role: member.role,
    state: member.state,
    effectiveFrom: member.effectiveFrom,
  };
}

/**
 * Whether a member is eligible to receive new generation credits. Inactive,
 * suspended, and departed members keep their history but receive no new
 * allocations.
 */
export function isEligibleForAllocation(member: MemberRecord): boolean {
  return member.state === "active";
}

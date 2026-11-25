/**
 * Cooperative tenancy and data ownership enforcement.
 *
 * Ownership graph (see docs/domain/tenancy.md for the diagram):
 *
 *   Cooperative (tenant root)
 *     ├─ CooperativeMember (user ↔ cooperative, role: admin | member)
 *     ├─ Meter (owned by cooperative, optionally assigned to a member)
 *     │    └─ Reading (owned by the meter's cooperative)
 *     ├─ Credit (generation credit assigned to a cooperative member)
 *     └─ AuditEvent (owned by the cooperative that produced it)
 *
 * Platform administrators are NOT cooperative members. They operate above the
 * tenant boundary (support/ops) and are never derived from a cooperative ID.
 * Cooperative administrators are members with role "admin" and are scoped to
 * exactly one cooperative. Members are scoped to their own cooperative and may
 * only see their own member-scoped resources where applicable.
 *
 * Ownership is always derived from the authenticated principal's membership
 * records — never from a client-supplied cooperative ID.
 */

export type CooperativeRole = "admin" | "member";

export type PrincipalKind = "platform_admin" | "cooperative_user";

export interface Membership {
  cooperativeId: string;
  userId: string;
  role: CooperativeRole;
}

export interface Principal {
  userId: string;
  kind: PrincipalKind;
  /** Memberships loaded server-side from the database, not from the request. */
  memberships: Membership[];
}

export type ResourceKind =
  | "cooperative"
  | "member"
  | "meter"
  | "reading"
  | "credit"
  | "audit_event";

export interface ResourceRef {
  kind: ResourceKind;
  /** Cooperative that owns the resource, resolved server-side. */
  cooperativeId: string;
  /** For member-scoped resources (e.g. a member's own credits). */
  memberUserId?: string;
}

export type Action = "read" | "write" | "admin";

export interface AccessDecision {
  allowed: boolean;
  reason: string;
}

const ALLOW: AccessDecision = { allowed: true, reason: "allowed" };

function deny(reason: string): AccessDecision {
  return { allowed: false, reason };
}

/**
 * Resolve the cooperative a principal belongs to for a given resource.
 * Returns undefined when the principal has no membership in that cooperative.
 */
export function membershipFor(
  principal: Principal,
  cooperativeId: string,
): Membership | undefined {
  return principal.memberships.find((m) => m.cooperativeId === cooperativeId);
}

/**
 * Derive the set of cooperative IDs a principal may act within. This is the
 * single source of truth for tenancy; callers must not accept a cooperative ID
 * from the client and trust it.
 */
export function ownedCooperativeIds(principal: Principal): string[] {
  return Array.from(new Set(principal.memberships.map((m) => m.cooperativeId)));
}

/**
 * Enforce that a resource belongs to a cooperative the principal owns.
 * Platform administrators bypass the tenant boundary for support operations.
 */
export function canAccess(
  principal: Principal,
  resource: ResourceRef,
  action: Action,
): AccessDecision {
  if (principal.kind === "platform_admin") {
    return ALLOW;
  }

  const membership = membershipFor(principal, resource.cooperativeId);
  if (!membership) {
    return deny("principal is not a member of the owning cooperative");
  }

  if (action === "admin" && membership.role !== "admin") {
    return deny("cooperative admin role required");
  }

  // Member-scoped resources (e.g. a member's own credits) are visible to the
  // owning member and to cooperative admins, but not to other members.
  if (
    resource.memberUserId !== undefined &&
    membership.role !== "admin" &&
    resource.memberUserId !== principal.userId
  ) {
    return deny("resource is scoped to another member");
  }

  return ALLOW;
}

/**
 * Guard for routes that receive a cooperative ID from the client. The ID is
 * only used to look up the resource; authorization is derived from the
 * principal's memberships, so a forged ID cannot grant access.
 */
export function assertCooperativeAccess(
  principal: Principal,
  cooperativeId: string,
  action: Action = "read",
): AccessDecision {
  return canAccess(principal, { kind: "cooperative", cooperativeId }, action);
}

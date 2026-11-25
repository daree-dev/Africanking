/**
 * Cooperative tenancy and data ownership model.
 *
 * Ownership graph (all edges are server-derived, never client-supplied):
 *
 *   Cooperative (tenant root)
 *     ├─ Membership (user ↔ cooperative, role: cooperative_admin | member)
 *     │     └─ User (platform identity)
 *     ├─ Meter (belongs to exactly one cooperative)
 *     │     └─ Reading (belongs to a meter, inherits cooperative)
 *     ├─ Credit (assigned to a cooperative member)
 *     │     └─ Membership (owner of the credit)
 *     └─ AuditEvent (records actor + cooperative + resource)
 *
 * Platform administrators are NOT members of any cooperative. They operate
 * across tenants for support/operations and are represented by a separate
 * principal kind, never by a cooperative membership row.
 */

export type PrincipalKind = "platform_admin" | "cooperative_admin" | "member";

export type CooperativeRole = "cooperative_admin" | "member";

export interface Principal {
  userId: string;
  kind: PrincipalKind;
  /** Cooperative the principal is acting within; null for platform admins. */
  cooperativeId: string | null;
  role: CooperativeRole | null;
}

export interface Membership {
  id: string;
  userId: string;
  cooperativeId: string;
  role: CooperativeRole;
}

export interface Meter {
  id: string;
  cooperativeId: string;
}

export interface Reading {
  id: string;
  meterId: string;
  cooperativeId: string;
}

export interface Credit {
  id: string;
  cooperativeId: string;
  /** Credit is assigned to a cooperative member (membership), not a bare user. */
  memberId: string;
}

export interface AuditEvent {
  id: string;
  cooperativeId: string;
  actorUserId: string;
  resourceType: "cooperative" | "membership" | "meter" | "reading" | "credit";
  resourceId: string;
}

/**
 * Derive the cooperative a principal is bound to from server-side membership
 * data. Client-supplied cooperative IDs are never trusted for authorization.
 */
export function deriveCooperativeId(
  principal: Principal,
  memberships: Membership[],
): string | null {
  if (principal.kind === "platform_admin") {
    return null;
  }
  const membership = memberships.find((m) => m.userId === principal.userId);
  return membership ? membership.cooperativeId : null;
}

/**
 * Resolve the owning cooperative for a resource, following the ownership graph
 * (reading → meter → cooperative, credit → cooperative, etc.).
 */
export function resolveResourceCooperativeId(
  resource:
    | { type: "cooperative"; cooperativeId: string }
    | { type: "membership"; cooperativeId: string }
    | { type: "meter"; cooperativeId: string }
    | { type: "reading"; cooperativeId: string }
    | { type: "credit"; cooperativeId: string }
    | { type: "audit_event"; cooperativeId: string },
): string {
  return resource.cooperativeId;
}

/**
 * Enforce tenancy: a principal may access a resource only when the resource's
 * derived cooperative matches the principal's derived cooperative. Platform
 * admins bypass the tenant check but are still audited.
 */
export function canAccessResource(
  principal: Principal,
  memberships: Membership[],
  resourceCooperativeId: string,
): boolean {
  if (principal.kind === "platform_admin") {
    return true;
  }
  const cooperativeId = deriveCooperativeId(principal, memberships);
  return cooperativeId !== null && cooperativeId === resourceCooperativeId;
}

/**
 * Cooperative admins manage members, meters, and credits within their own
 * cooperative. Members may only read their own cooperative's records.
 */
export function canManageCooperative(
  principal: Principal,
  memberships: Membership[],
  cooperativeId: string,
): boolean {
  if (principal.kind === "platform_admin") {
    return true;
  }
  const membership = memberships.find((m) => m.userId === principal.userId);
  return (
    membership !== undefined &&
    membership.cooperativeId === cooperativeId &&
    membership.role === "cooperative_admin"
  );
}

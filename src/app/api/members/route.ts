import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * Member lifecycle management for cooperative members.
 *
 * Membership states and permitted transitions:
 *   invited   -> active | revoked
 *   active    -> suspended | departed
 *   suspended -> active | departed
 *   departed  -> (terminal)
 *   revoked   -> (terminal)
 *
 * Historical allocations and reports reference members by id and are never
 * deleted or rewritten when a member becomes inactive or departs. Only the
 * membership record's state/effective dates change.
 */

export type MembershipState =
  | "invited"
  | "active"
  | "suspended"
  | "departed"
  | "revoked";

export type MemberRole = "member" | "steward" | "coordinator";

export interface MembershipRecord {
  memberId: string;
  cooperativeId: string;
  role: MemberRole;
  state: MembershipState;
  effectiveFrom: string;
  effectiveTo: string | null;
  updatedAt: string;
}

export interface MembershipAuditEntry {
  memberId: string;
  cooperativeId: string;
  operation: "join" | "role-change" | "suspend" | "reactivate" | "depart";
  fromState: MembershipState | null;
  toState: MembershipState;
  fromRole: MemberRole | null;
  toRole: MemberRole;
  effectiveDate: string;
  recordedAt: string;
  actorId: string;
}

const PERMITTED_TRANSITIONS: Record<MembershipState, MembershipState[]> = {
  invited: ["active", "revoked"],
  active: ["suspended", "departed"],
  suspended: ["active", "departed"],
  departed: [],
  revoked: [],
};

const TERMINAL_STATES: MembershipState[] = ["departed", "revoked"];

const membershipStateSchema = z.enum([
  "invited",
  "active",
  "suspended",
  "departed",
  "revoked",
]);

const memberRoleSchema = z.enum(["member", "steward", "coordinator"]);

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "effectiveDate must be an ISO date (YYYY-MM-DD)");

const joinSchema = z.object({
  operation: z.literal("join"),
  memberId: z.string().min(1),
  cooperativeId: z.string().min(1),
  role: memberRoleSchema.default("member"),
  effectiveDate: isoDateSchema,
  actorId: z.string().min(1),
});

const roleChangeSchema = z.object({
  operation: z.literal("role-change"),
  memberId: z.string().min(1),
  cooperativeId: z.string().min(1),
  role: memberRoleSchema,
  effectiveDate: isoDateSchema,
  actorId: z.string().min(1),
});

const suspendSchema = z.object({
  operation: z.literal("suspend"),
  memberId: z.string().min(1),
  cooperativeId: z.string().min(1),
  effectiveDate: isoDateSchema,
  actorId: z.string().min(1),
});

const reactivateSchema = z.object({
  operation: z.literal("reactivate"),
  memberId: z.string().min(1),
  cooperativeId: z.string().min(1),
  effectiveDate: isoDateSchema,
  actorId: z.string().min(1),
});

const departSchema = z.object({
  operation: z.literal("depart"),
  memberId: z.string().min(1),
  cooperativeId: z.string().min(1),
  effectiveDate: isoDateSchema,
  actorId: z.string().min(1),
});

const lifecycleRequestSchema = z.discriminatedUnion("operation", [
  joinSchema,
  roleChangeSchema,
  suspendSchema,
  reactivateSchema,
  departSchema,
]);

type LifecycleRequest = z.infer<typeof lifecycleRequestSchema>;

/**
 * In-memory store placeholder. In production this is backed by the
 * cooperative persistence layer; the shape is kept here so the lifecycle
 * rules are testable and the historical records are never mutated.
 */
const memberships = new Map<string, MembershipRecord>();
const auditLog: MembershipAuditEntry[] = [];

function membershipKey(cooperativeId: string, memberId: string): string {
  return `${cooperativeId}:${memberId}`;
}

function isTransitionPermitted(
  from: MembershipState,
  to: MembershipState,
): boolean {
  return PERMITTED_TRANSITIONS[from].includes(to);
}

function isTerminal(state: MembershipState): boolean {
  return TERMINAL_STATES.includes(state);
}

function recordAudit(entry: MembershipAuditEntry): void {
  auditLog.push(entry);
}

function applyTransition(
  existing: MembershipRecord | undefined,
  request: LifecycleRequest,
): { ok: true; record: MembershipRecord } | { ok: false; error: string } {
  const now = new Date().toISOString();

  if (request.operation === "join") {
    if (existing && !isTerminal(existing.state)) {
      return { ok: false, error: "member already has an active membership" };
    }
    const record: MembershipRecord = {
      memberId: request.memberId,
      cooperativeId: request.cooperativeId,
      role: request.role,
      state: "active",
      effectiveFrom: request.effectiveDate,
      effectiveTo: null,
      updatedAt: now,
    };
    recordAudit({
      memberId: request.memberId,
      cooperativeId: request.cooperativeId,
      operation: "join",
      fromState: existing?.state ?? null,
      toState: "active",
      fromRole: existing?.role ?? null,
      toRole: request.role,
      effectiveDate: request.effectiveDate,
      recordedAt: now,
      actorId: request.actorId,
    });
    return { ok: true, record };
  }

  if (!existing) {
    return { ok: false, error: "membership not found" };
  }

  if (isTerminal(existing.state)) {
    return {
      ok: false,
      error: `membership is ${existing.state} and cannot transition further`,
    };
  }

  if (request.effectiveDate < existing.effectiveFrom) {
    return {
      ok: false,
      error: "effectiveDate cannot precede the membership start date",
    };
  }

  if (request.operation === "role-change") {
    if (existing.state !== "active") {
      return { ok: false, error: "role changes require an active membership" };
    }
    const record: MembershipRecord = {
      ...existing,
      role: request.role,
      updatedAt: now,
    };
    recordAudit({
      memberId: request.memberId,
      cooperativeId: request.cooperativeId,
      operation: "role-change",
      fromState: existing.state,
      toState: existing.state,
      fromRole: existing.role,
      toRole: request.role,
      effectiveDate: request.effectiveDate,
      recordedAt: now,
      actorId: request.actorId,
    });
    return { ok: true, record };
  }

  const targetState: MembershipState =
    request.operation === "suspend"
      ? "suspended"
      : request.operation === "reactivate"
        ? "active"
        : "departed";

  if (!isTransitionPermitted(existing.state, targetState)) {
    return {
      ok: false,
      error: `transition ${existing.state} -> ${targetState} is not permitted`,
    };
  }

  const record: MembershipRecord = {
    ...existing,
    state: targetState,
    effectiveTo: targetState === "departed" ? request.effectiveDate : null,
    updatedAt: now,
  };
  recordAudit({
    memberId: request.memberId,
    cooperativeId: request.cooperativeId,
    operation:
      request.operation === "suspend"
        ? "suspend"
        : request.operation === "reactivate"
          ? "reactivate"
          : "depart",
    fromState: existing.state,
    toState: targetState,
    fromRole: existing.role,
    toRole: existing.role,
    effectiveDate: request.effectiveDate,
    recordedAt: now,
    actorId: request.actorId,
  });
  return { ok: true, record };
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const cooperativeId = url.searchParams.get("cooperativeId");
  const memberId = url.searchParams.get("memberId");

  if (memberId) {
    if (!cooperativeId) {
      return NextResponse.json(
        { error: "cooperativeId is required when memberId is provided" },
        { status: 400 },
      );
    }
    const record = memberships.get(membershipKey(cooperativeId, memberId));
    if (!record) {
      return NextResponse.json({ error: "membership not found" }, { status: 404 });
    }
    return NextResponse.json({ membership: record });
  }

  const records = Array.from(memberships.values()).filter(
    (record) => !cooperativeId || record.cooperativeId === cooperativeId,
  );
  return NextResponse.json({ memberships: records });
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = lifecycleRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid lifecycle request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const lifecycleRequest = parsed.data;
  const key = membershipKey(
    lifecycleRequest.cooperativeId,
    lifecycleRequest.memberId,
  );
  const existing = memberships.get(key);

  const result = applyTransition(existing, lifecycleRequest);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }

  memberships.set(key, result.record);
  return NextResponse.json({ membership: result.record }, { status: 200 });
}

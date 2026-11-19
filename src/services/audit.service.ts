import { randomUUID } from "crypto";

export type AuditResourceType =
  | "membership"
  | "meter"
  | "reading_review"
  | "allocation"
  | "settlement";

export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "approve"
  | "reject"
  | "assign"
  | "settle";

export interface AuditActor {
  id: string;
  role?: string;
}

export interface AuditEventInput {
  actor: AuditActor;
  cooperativeId: string;
  resourceType: AuditResourceType;
  resourceId: string;
  action: AuditAction;
  reason?: string;
  operationId?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

export interface AuditEvent {
  id: string;
  operationId: string;
  actorId: string;
  actorRole: string | null;
  cooperativeId: string;
  resourceType: AuditResourceType;
  resourceId: string;
  action: AuditAction;
  reason: string | null;
  changeSummary: Record<string, { before: unknown; after: unknown }>;
  createdAt: string;
}

const SENSITIVE_KEYS = new Set([
  "password",
  "passwordHash",
  "token",
  "secret",
  "apiKey",
  "authorization",
]);

const MAX_SUMMARY_KEYS = 50;

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key) || /secret|token|password/i.test(key);
}

function safeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") {
    return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  return "[redacted]";
}

/**
 * Builds a safe, diff-only change summary. Only keys whose values actually
 * changed are included, sensitive keys are dropped, and values are coerced to
 * primitives so no raw objects leak into the audit trail.
 */
export function buildChangeSummary(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): Record<string, { before: unknown; after: unknown }> {
  const summary: Record<string, { before: unknown; after: unknown }> = {};
  const keys = new Set([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ]);

  let count = 0;
  for (const key of keys) {
    if (count >= MAX_SUMMARY_KEYS) break;
    if (isSensitiveKey(key)) continue;
    const prev = safeValue(before?.[key]);
    const next = safeValue(after?.[key]);
    if (JSON.stringify(prev) === JSON.stringify(next)) continue;
    summary[key] = { before: prev, after: next };
    count += 1;
  }
  return summary;
}

/**
 * Append-only audit store. Events are frozen on write and there is no update
 * or delete surface exposed to API roles.
 */
export class AuditService {
  private readonly events: AuditEvent[] = [];

  record(input: AuditEventInput): AuditEvent {
    const event: AuditEvent = Object.freeze({
      id: randomUUID(),
      operationId: input.operationId ?? randomUUID(),
      actorId: input.actor.id,
      actorRole: input.actor.role ?? null,
      cooperativeId: input.cooperativeId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      action: input.action,
      reason: input.reason ?? null,
      changeSummary: buildChangeSummary(input.before, input.after),
      createdAt: new Date().toISOString(),
    });
    this.events.push(event);
    return event;
  }

  list(filter?: {
    cooperativeId?: string;
    resourceType?: AuditResourceType;
    resourceId?: string;
  }): readonly AuditEvent[] {
    return this.events.filter((event) => {
      if (filter?.cooperativeId && event.cooperativeId !== filter.cooperativeId) {
        return false;
      }
      if (filter?.resourceType && event.resourceType !== filter.resourceType) {
        return false;
      }
      if (filter?.resourceId && event.resourceId !== filter.resourceId) {
        return false;
      }
      return true;
    });
  }
}

/**
 * Wraps a domain write so an audit event is emitted only when the write
 * succeeds. Rejected writes throw and therefore produce no audit event.
 */
export async function withAudit<T>(
  audit: AuditService,
  input: Omit<AuditEventInput, "before" | "after">,
  write: () => Promise<{ result: T; before?: Record<string, unknown> | null; after?: Record<string, unknown> | null }>,
): Promise<T> {
  const { result, before, after } = await write();
  audit.record({ ...input, before, after });
  return result;
}

export const auditService = new AuditService();

import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';

/**
 * Immutable audit events for domain state transitions.
 *
 * Events are append-only: once written they cannot be updated or deleted by
 * ordinary API roles. Each event captures the actor, cooperative, changed
 * resource, before/after state, request/operation id, timestamp and reason.
 */

export type AuditResourceType =
  | 'membership'
  | 'meter'
  | 'reading_review'
  | 'allocation'
  | 'settlement';

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'approve'
  | 'reject'
  | 'assign'
  | 'settle';

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
  /** Safe, non-sensitive summary of the change (no secrets/PII). */
  changeSummary?: Record<string, unknown>;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  requestId?: string;
  operationId?: string;
}

export interface AuditEvent extends AuditEventInput {
  id: string;
  timestamp: string;
  requestId: string;
  operationId: string;
}

/**
 * Append-only store. Only `append` and `list` are exposed; there is no
 * update/delete surface so ordinary API roles cannot mutate history.
 */
export interface AuditStore {
  append(event: AuditEvent): Promise<void>;
  list(filter?: { cooperativeId?: string; resourceId?: string }): Promise<AuditEvent[]>;
}

const inMemoryEvents: AuditEvent[] = [];

export const auditStore: AuditStore = {
  async append(event: AuditEvent): Promise<void> {
    inMemoryEvents.push(Object.freeze({ ...event }));
  },
  async list(filter): Promise<AuditEvent[]> {
    return inMemoryEvents.filter((e) => {
      if (filter?.cooperativeId && e.cooperativeId !== filter.cooperativeId) return false;
      if (filter?.resourceId && e.resourceId !== filter.resourceId) return false;
      return true;
    });
  },
};

/**
 * Build a normalized, immutable audit event from an input. Pure function so it
 * can be unit tested and reused by services.
 */
export function buildAuditEvent(input: AuditEventInput): AuditEvent {
  return Object.freeze({
    ...input,
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    requestId: input.requestId ?? randomUUID(),
    operationId: input.operationId ?? randomUUID(),
  });
}

/**
 * Record a transition event. Call this only after a write has succeeded so
 * rejected writes never produce audit entries.
 */
export async function recordAuditEvent(input: AuditEventInput): Promise<AuditEvent> {
  const event = buildAuditEvent(input);
  await auditStore.append(event);
  return event;
}

/**
 * Express middleware that attaches a request/operation id and an audit helper
 * to the request. The helper is a no-op-safe wrapper that only emits on
 * explicit success calls.
 */
export function auditContext(req: Request, res: Response, next: NextFunction): void {
  const requestId = (req.header('x-request-id') as string) || randomUUID();
  const operationId = (req.header('x-operation-id') as string) || randomUUID();
  res.setHeader('x-request-id', requestId);

  (req as Request & { audit?: unknown }).audit = {
    requestId,
    operationId,
    record: (input: Omit<AuditEventInput, 'requestId' | 'operationId'>) =>
      recordAuditEvent({ ...input, requestId, operationId }),
  };

  next();
}

export default auditContext;

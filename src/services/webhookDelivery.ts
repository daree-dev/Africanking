/**
 * Webhook delivery for finalized cooperative credit events.
 *
 * Scope: cooperative-management notifications only. Generation credits are
 * assigned to cooperative members; this is NOT an external certificate
 * marketplace and makes no I-REC/ESG certification claim.
 *
 * Only finalized events (reviewed generation / settlement state changes) are
 * delivered, and payloads are redacted of raw member personal data.
 */

import { createHmac, randomUUID, timingSafeEqual } from 'crypto';

export const WEBHOOK_EVENT_VERSION = '2024-01-01' as const;

export type FinalizedCreditEventType =
  | 'generation.reviewed'
  | 'settlement.finalized';

export interface FinalizedCreditEvent {
  type: FinalizedCreditEventType;
  /** Cooperative that owns the credit assignment. */
  cooperativeId: string;
  /** Credit assignment record identifier. */
  creditId: string;
  /** Member reference (opaque id only — never personal data). */
  memberRef: string;
  /** Finalized state, e.g. 'reviewed' or 'settled'. */
  state: string;
  /** ISO timestamp of the state change. */
  occurredAt: string;
}

export interface WebhookPayload {
  /** Unique delivery id, stable across retries for the same attempt chain. */
  deliveryId: string;
  /** Payload schema version for forward compatibility. */
  eventVersion: typeof WEBHOOK_EVENT_VERSION;
  event: FinalizedCreditEvent;
  /** ISO timestamp the delivery was created. */
  sentAt: string;
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  /** Current signing secret. */
  secret: string;
  /** Previous secret kept during rotation grace window. */
  previousSecret?: string;
  verified: boolean;
  active: boolean;
}

export type DeliveryStatus = 'pending' | 'delivered' | 'failed';

export interface DeliveryRecord {
  deliveryId: string;
  endpointId: string;
  payload: WebhookPayload;
  status: DeliveryStatus;
  attempts: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RetryPolicy {
  maxAttempts: number;
  /** Base delay in ms; grows exponentially per attempt. */
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 1_000,
  maxDelayMs: 60_000,
};

const FINALIZED_STATES = new Set(['reviewed', 'settled', 'finalized']);

/** Only finalized events are eligible for delivery. */
export function isFinalizedEvent(event: FinalizedCreditEvent): boolean {
  return FINALIZED_STATES.has(event.state);
}

/**
 * Build a redacted payload. Only opaque member references are included; any
 * raw personal data fields are stripped defensively.
 */
export function buildPayload(
  event: FinalizedCreditEvent,
  deliveryId: string = randomUUID(),
): WebhookPayload {
  return {
    deliveryId,
    eventVersion: WEBHOOK_EVENT_VERSION,
    sentAt: new Date().toISOString(),
    event: {
      type: event.type,
      cooperativeId: event.cooperativeId,
      creditId: event.creditId,
      memberRef: event.memberRef,
      state: event.state,
      occurredAt: event.occurredAt,
    },
  };
}

/** Compute the HMAC signature header value for a payload. */
export function signPayload(payload: WebhookPayload, secret: string): string {
  const body = JSON.stringify(payload);
  const digest = createHmac('sha256', secret).update(body).digest('hex');
  return `t=${payload.sentAt},v=${WEBHOOK_EVENT_VERSION},sig=${digest}`;
}

/** Verify a signature header against a payload and secret. */
export function verifySignature(
  payload: WebhookPayload,
  secret: string,
  header: string,
): boolean {
  const expected = signPayload(payload, secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Verify a signature against current or previous (rotating) secret. */
export function verifySignatureWithRotation(
  payload: WebhookPayload,
  endpoint: WebhookEndpoint,
  header: string,
): boolean {
  if (verifySignature(payload, endpoint.secret, header)) return true;
  if (endpoint.previousSecret) {
    return verifySignature(payload, endpoint.previousSecret, header);
  }
  return false;
}

/** Rotate the signing secret, keeping the old one for a grace window. */
export function rotateSecret(
  endpoint: WebhookEndpoint,
  newSecret: string,
): WebhookEndpoint {
  return { ...endpoint, previousSecret: endpoint.secret, secret: newSecret };
}

/** Endpoint verification challenge response. */
export function buildVerificationChallenge(endpointId: string): {
  challenge: string;
  endpointId: string;
} {
  return { challenge: randomUUID(), endpointId };
}

export function verifyEndpointChallenge(
  expected: string,
  received: string,
): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Exponential backoff delay for a given attempt (1-based). */
export function retryDelayMs(
  attempt: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): number {
  const delay = policy.baseDelayMs * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(delay, policy.maxDelayMs);
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number }>;

export interface DeliveryHistory {
  records: DeliveryRecord[];
}

/**
 * Deliver a finalized event to an endpoint with retries. Returns the delivery
 * record; duplicate delivery ids are rejected by the caller via history.
 */
export async function deliverEvent(
  event: FinalizedCreditEvent,
  endpoint: WebhookEndpoint,
  fetchImpl: FetchLike,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  deliveryId: string = randomUUID(),
): Promise<DeliveryRecord> {
  const now = new Date().toISOString();
  const record: DeliveryRecord = {
    deliveryId,
    endpointId: endpoint.id,
    payload: buildPayload(event, deliveryId),
    status: 'pending',
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };

  if (!endpoint.active || !endpoint.verified || !isFinalizedEvent(event)) {
    record.status = 'failed';
    record.lastError = 'endpoint inactive/unverified or event not finalized';
    return record;
  }

  const body = JSON.stringify(record.payload);
  const signature = signPayload(record.payload, endpoint.secret);

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    record.attempts = attempt;
    try {
      const res = await fetchImpl(endpoint.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': signature,
          'x-webhook-delivery-id': record.deliveryId,
          'x-webhook-event-version': WEBHOOK_EVENT_VERSION,
        },
        body,
      });
      if (res.ok) {
        record.status = 'delivered';
        record.lastError = undefined;
        record.updatedAt = new Date().toISOString();
        return record;
      }
      record.lastError = `HTTP ${res.status}`;
    } catch (err) {
      record.lastError = err instanceof Error ? err.message : 'delivery error';
    }
    record.updatedAt = new Date().toISOString();
  }

  record.status = 'failed';
  return record;
}

/** Append a delivery record, guarding against duplicate delivery ids. */
export function recordDelivery(
  history: DeliveryHistory,
  record: DeliveryRecord,
): DeliveryHistory {
  if (history.records.some((r) => r.deliveryId === record.deliveryId)) {
    return history;
  }
  return { records: [...history.records, record] };
}

/** Replay a previously recorded delivery to its endpoint. */
export async function replayDelivery(
  history: DeliveryHistory,
  deliveryId: string,
  endpoint: WebhookEndpoint,
  fetchImpl: FetchLike,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): Promise<DeliveryRecord | undefined> {
  const existing = history.records.find((r) => r.deliveryId === deliveryId);
  if (!existing) return undefined;
  return deliverEvent(
    existing.payload.event,
    endpoint,
    fetchImpl,
    policy,
    existing.deliveryId,
  );
}

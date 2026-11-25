/**
 * Event model for cooperative credit events and webhook delivery.
 *
 * Scope note: generation credits are assigned to cooperative members.
 * This is NOT an external certificate marketplace and makes no I-REC/ESG
 * certification claim. Webhooks notify external cooperative systems of
 * finalized state changes only.
 */

export const WEBHOOK_EVENT_VERSION = 'v1' as const;
export type WebhookEventVersion = typeof WEBHOOK_EVENT_VERSION;

/** Only finalized events are eligible for webhook delivery. */
export type FinalizedCreditEventType =
  | 'generation.reviewed'
  | 'settlement.finalized';

/**
 * Redacted member reference. Raw personal data (name, email, address, etc.)
 * must never be included in webhook payloads; only an opaque member id.
 */
export interface RedactedMemberRef {
  memberId: string;
}

/**
 * Signed webhook payload. `data` carries only finalized, non-personal fields.
 */
export interface WebhookPayload {
  /** Event schema version for forward-compatible consumers. */
  version: WebhookEventVersion;
  /** Unique delivery id; stable across retries for duplicate detection. */
  deliveryId: string;
  /** Finalized event type. */
  eventType: FinalizedCreditEventType;
  /** Id of the underlying credit/settlement record. */
  eventId: string;
  /** ISO-8601 timestamp of when the event was finalized. */
  finalizedAt: string;
  /** Redacted, non-personal event data. */
  data: {
    cooperativeId: string;
    member: RedactedMemberRef;
    creditAmountKwh: number;
    status: 'reviewed' | 'settled';
  };
}

/** Signature metadata attached to each delivery attempt. */
export interface WebhookSignature {
  /** Signature scheme, e.g. HMAC-SHA256. */
  algorithm: 'hmac-sha256';
  /** Key id used to sign, enabling secret rotation. */
  keyId: string;
  /** Hex-encoded HMAC over the canonical payload body. */
  signature: string;
  /** Unix seconds when the signature was produced (replay protection). */
  timestamp: number;
}

/** Retry policy for failed deliveries. */
export interface WebhookRetryPolicy {
  maxAttempts: number;
  /** Base delay in ms; implementations apply exponential backoff. */
  baseDelayMs: number;
  /** Upper bound for backoff delay in ms. */
  maxDelayMs: number;
}

export const DEFAULT_WEBHOOK_RETRY_POLICY: WebhookRetryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 1_000,
  maxDelayMs: 60_000,
};

/** Delivery lifecycle states for history and replay controls. */
export type WebhookDeliveryStatus =
  | 'pending'
  | 'delivered'
  | 'failed'
  | 'replayed';

/** A single delivery attempt record for delivery history. */
export interface WebhookDeliveryAttempt {
  attempt: number;
  status: WebhookDeliveryStatus;
  /** HTTP status from the endpoint, if any. */
  responseStatus?: number;
  /** Error message on failure (no personal data). */
  error?: string;
  attemptedAt: string;
}

/** Delivery history entry, keyed by deliveryId for replay controls. */
export interface WebhookDeliveryRecord {
  deliveryId: string;
  eventId: string;
  eventType: FinalizedCreditEventType;
  endpointId: string;
  status: WebhookDeliveryStatus;
  attempts: WebhookDeliveryAttempt[];
  createdAt: string;
  updatedAt: string;
}

/** Endpoint registration with verification and secret rotation support. */
export interface WebhookEndpoint {
  id: string;
  url: string;
  /** Whether the endpoint has completed verification challenge. */
  verified: boolean;
  /** Active signing secret key id (rotation keeps prior key for overlap). */
  activeKeyId: string;
  /** Previous key id still accepted during rotation overlap window. */
  previousKeyId?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Returns true only for finalized events eligible for webhook delivery.
 * Guards against sending non-finalized state changes.
 */
export function isFinalizedEvent(eventType: string): eventType is FinalizedCreditEventType {
  return eventType === 'generation.reviewed' || eventType === 'settlement.finalized';
}

/**
 * Builds a redacted webhook payload from a finalized credit event.
 * Callers must pass only finalized events; raw member personal data is
 * intentionally excluded and replaced with an opaque member id.
 */
export function buildWebhookPayload(input: {
  deliveryId: string;
  eventId: string;
  eventType: FinalizedCreditEventType;
  finalizedAt: string;
  cooperativeId: string;
  memberId: string;
  creditAmountKwh: number;
  status: 'reviewed' | 'settled';
}): WebhookPayload {
  return {
    version: WEBHOOK_EVENT_VERSION,
    deliveryId: input.deliveryId,
    eventType: input.eventType,
    eventId: input.eventId,
    finalizedAt: input.finalizedAt,
    data: {
      cooperativeId: input.cooperativeId,
      member: { memberId: input.memberId },
      creditAmountKwh: input.creditAmountKwh,
      status: input.status,
    },
  };
}

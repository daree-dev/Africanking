import crypto from 'crypto';

export type WebhookEventType =
  | 'generation.reviewed'
  | 'settlement.finalized';

export interface WebhookEvent {
  id: string;
  type: WebhookEventType;
  version: number;
  createdAt: string;
  data: Record<string, unknown>;
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  secret: string;
  active: boolean;
  verified: boolean;
  createdAt: string;
}

export interface WebhookDelivery {
  id: string;
  endpointId: string;
  eventId: string;
  eventType: WebhookEventType;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  lastAttemptAt: string | null;
  responseStatus: number | null;
  payload: string;
  signature: string;
}

export const WEBHOOK_EVENT_VERSION = 1;

// Retry policy: exponential backoff, capped attempts.
export const RETRY_POLICY = {
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 60000,
};

export function retryDelayMs(attempt: number): number {
  const delay = RETRY_POLICY.baseDelayMs * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(delay, RETRY_POLICY.maxDelayMs);
}

// Fields that must never leave the system in a webhook payload.
const REDACTED_FIELDS = [
  'memberName',
  'memberEmail',
  'memberPhone',
  'memberAddress',
  'memberIdNumber',
  'personalData',
];

export function redactPayload(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (REDACTED_FIELDS.includes(key)) continue;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = redactPayload(value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function buildEvent(
  type: WebhookEventType,
  data: Record<string, unknown>,
): WebhookEvent {
  return {
    id: crypto.randomUUID(),
    type,
    version: WEBHOOK_EVENT_VERSION,
    createdAt: new Date().toISOString(),
    data: redactPayload(data),
  };
}

export function signPayload(secret: string, timestamp: string, body: string): string {
  const signed = `${timestamp}.${body}`;
  return crypto.createHmac('sha256', secret).update(signed).digest('hex');
}

export function verifySignature(
  secret: string,
  timestamp: string,
  body: string,
  signature: string,
): boolean {
  const expected = signPayload(secret, timestamp, body);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function rotateSecret(endpoint: WebhookEndpoint): WebhookEndpoint {
  return { ...endpoint, secret: crypto.randomBytes(32).toString('hex') };
}

export function verifyEndpoint(endpoint: WebhookEndpoint): WebhookEndpoint {
  return { ...endpoint, verified: true };
}

export class WebhookService {
  private endpoints = new Map<string, WebhookEndpoint>();
  private deliveries = new Map<string, WebhookDelivery>();

  registerEndpoint(url: string): WebhookEndpoint {
    const endpoint: WebhookEndpoint = {
      id: crypto.randomUUID(),
      url,
      secret: crypto.randomBytes(32).toString('hex'),
      active: true,
      verified: false,
      createdAt: new Date().toISOString(),
    };
    this.endpoints.set(endpoint.id, endpoint);
    return endpoint;
  }

  verifyEndpoint(endpointId: string): WebhookEndpoint | null {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) return null;
    const verified = verifyEndpoint(endpoint);
    this.endpoints.set(endpointId, verified);
    return verified;
  }

  rotateSecret(endpointId: string): WebhookEndpoint | null {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) return null;
    const rotated = rotateSecret(endpoint);
    this.endpoints.set(endpointId, rotated);
    return rotated;
  }

  // Only finalized events should be dispatched through this method.
  dispatch(event: WebhookEvent): WebhookDelivery[] {
    const created: WebhookDelivery[] = [];
    for (const endpoint of this.endpoints.values()) {
      if (!endpoint.active || !endpoint.verified) continue;
      const timestamp = new Date().toISOString();
      const body = JSON.stringify(event);
      const signature = signPayload(endpoint.secret, timestamp, body);
      const delivery: WebhookDelivery = {
        id: crypto.randomUUID(),
        endpointId: endpoint.id,
        eventId: event.id,
        eventType: event.type,
        status: 'pending',
        attempts: 0,
        lastAttemptAt: null,
        responseStatus: null,
        payload: body,
        signature,
      };
      this.deliveries.set(delivery.id, delivery);
      created.push(delivery);
    }
    return created;
  }

  recordAttempt(
    deliveryId: string,
    success: boolean,
    responseStatus: number | null,
  ): WebhookDelivery | null {
    const delivery = this.deliveries.get(deliveryId);
    if (!delivery) return null;
    delivery.attempts += 1;
    delivery.lastAttemptAt = new Date().toISOString();
    delivery.responseStatus = responseStatus;
    if (success) {
      delivery.status = 'delivered';
    } else if (delivery.attempts >= RETRY_POLICY.maxAttempts) {
      delivery.status = 'failed';
    } else {
      delivery.status = 'pending';
    }
    this.deliveries.set(deliveryId, delivery);
    return delivery;
  }

  history(endpointId?: string): WebhookDelivery[] {
    const all = Array.from(this.deliveries.values());
    return endpointId ? all.filter((d) => d.endpointId === endpointId) : all;
  }

  replay(deliveryId: string): WebhookDelivery | null {
    const original = this.deliveries.get(deliveryId);
    if (!original) return null;
    const replay: WebhookDelivery = {
      ...original,
      id: crypto.randomUUID(),
      status: 'pending',
      attempts: 0,
      lastAttemptAt: null,
      responseStatus: null,
    };
    this.deliveries.set(replay.id, replay);
    return replay;
  }
}

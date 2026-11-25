import { Schema, model, models, type Model, type Types } from 'mongoose';

/**
 * Webhook delivery for finalized cooperative credit events.
 *
 * Scope: cooperative-management notifications only. Generation credits are
 * assigned to cooperative members; this is NOT an external certificate
 * marketplace and makes no I-REC/ESG certification claim.
 */

export const WEBHOOK_EVENT_VERSION = 'v1' as const;

export type WebhookEventType =
  | 'generation.reviewed'
  | 'settlement.finalized';

export type WebhookDeliveryStatus =
  | 'pending'
  | 'delivering'
  | 'delivered'
  | 'failed'
  | 'exhausted';

export interface WebhookPayload {
  /** Unique delivery id, also sent as the `X-Webhook-Delivery-Id` header. */
  deliveryId: string;
  /** Payload schema version for forward-compatible consumers. */
  eventVersion: typeof WEBHOOK_EVENT_VERSION;
  eventType: WebhookEventType;
  /** ISO timestamp of the finalized event. */
  occurredAt: string;
  /** Cooperative the event belongs to. */
  cooperativeId: string;
  /** Redacted, non-personal event data (no raw member PII). */
  data: Record<string, unknown>;
}

export interface WebhookDeliveryAttempt {
  attempt: number;
  attemptedAt: Date;
  statusCode?: number;
  error?: string;
}

export interface WebhookDeliveryRecord {
  deliveryId: string;
  eventType: WebhookEventType;
  eventVersion: string;
  payload: WebhookPayload;
  status: WebhookDeliveryStatus;
  attempts: WebhookDeliveryAttempt[];
  nextAttemptAt?: Date;
  deliveredAt?: Date;
  /** Set when a delivery was replayed from history. */
  replayedFrom?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WebhookEndpointDoc {
  cooperativeId: Types.ObjectId;
  url: string;
  description?: string;
  /** Current signing secret (encrypted at rest by the caller). */
  secret: string;
  /** Previous secrets kept during rotation for signature verification. */
  previousSecrets: { secret: string; rotatedAt: Date }[];
  secretRotatedAt?: Date;
  /** Endpoint verification challenge state. */
  verified: boolean;
  verificationToken?: string;
  verifiedAt?: Date;
  active: boolean;
  /** Subscribed finalized event types. */
  events: WebhookEventType[];
  /** Retry policy: max attempts and base backoff in seconds. */
  retryPolicy: { maxAttempts: number; baseDelaySeconds: number };
  deliveries: WebhookDeliveryRecord[];
  createdAt: Date;
  updatedAt: Date;
}

const deliveryAttemptSchema = new Schema<WebhookDeliveryAttempt>(
  {
    attempt: { type: Number, required: true },
    attemptedAt: { type: Date, required: true },
    statusCode: { type: Number },
    error: { type: String },
  },
  { _id: false }
);

const deliveryRecordSchema = new Schema<WebhookDeliveryRecord>(
  {
    deliveryId: { type: String, required: true },
    eventType: {
      type: String,
      enum: ['generation.reviewed', 'settlement.finalized'],
      required: true,
    },
    eventVersion: { type: String, required: true, default: WEBHOOK_EVENT_VERSION },
    payload: { type: Schema.Types.Mixed, required: true },
    status: {
      type: String,
      enum: ['pending', 'delivering', 'delivered', 'failed', 'exhausted'],
      default: 'pending',
    },
    attempts: { type: [deliveryAttemptSchema], default: [] },
    nextAttemptAt: { type: Date },
    deliveredAt: { type: Date },
    replayedFrom: { type: String },
  },
  { _id: false, timestamps: true }
);

const webhookEndpointSchema = new Schema<WebhookEndpointDoc>(
  {
    cooperativeId: { type: Schema.Types.ObjectId, ref: 'Cooperative', required: true, index: true },
    url: { type: String, required: true },
    description: { type: String },
    secret: { type: String, required: true },
    previousSecrets: {
      type: [
        new Schema(
          { secret: { type: String, required: true }, rotatedAt: { type: Date, required: true } },
          { _id: false }
        ),
      ],
      default: [],
    },
    secretRotatedAt: { type: Date },
    verified: { type: Boolean, default: false },
    verificationToken: { type: String },
    verifiedAt: { type: Date },
    active: { type: Boolean, default: true },
    events: {
      type: [{ type: String, enum: ['generation.reviewed', 'settlement.finalized'] }],
      default: ['generation.reviewed', 'settlement.finalized'],
    },
    retryPolicy: {
      maxAttempts: { type: Number, default: 5 },
      baseDelaySeconds: { type: Number, default: 30 },
    },
    deliveries: { type: [deliveryRecordSchema], default: [] },
  },
  { timestamps: true }
);

webhookEndpointSchema.index({ cooperativeId: 1, active: 1 });
webhookEndpointSchema.index({ 'deliveries.deliveryId': 1 });

const WebhookEndpoint: Model<WebhookEndpointDoc> =
  models.WebhookEndpoint || model<WebhookEndpointDoc>('WebhookEndpoint', webhookEndpointSchema);

export default WebhookEndpoint;

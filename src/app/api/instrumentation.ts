/**
 * Production observability for critical user journeys.
 *
 * Privacy-safe by construction: metric labels are restricted to a fixed
 * allowlist of low-cardinality, non-identifying values. Wallet signatures,
 * raw meter readings, and direct personal identifiers must never be passed
 * to these helpers.
 *
 * Runbook: docs/operations/README.md
 */

export type IngestionOutcome = "accepted" | "rejected" | "duplicate";
export type ReviewState = "pending" | "approved" | "rejected";
export type ChainStage = "submitted" | "confirmed" | "failed";
export type ApiErrorClass =
  | "validation"
  | "authorization"
  | "not_found"
  | "conflict"
  | "upstream"
  | "internal";

export interface MetricSample {
  name: string;
  value: number;
  labels: Record<string, string>;
  timestamp: number;
}

export interface AlertRule {
  id: string;
  metric: string;
  threshold: number;
  comparison: "gt" | "gte";
  windowSeconds: number;
  runbook: string;
  dedupeKey: string;
  description: string;
}

export interface AlertEvent {
  ruleId: string;
  dedupeKey: string;
  value: number;
  threshold: number;
  runbook: string;
  firedAt: number;
}

const RUNBOOK_BASE = "docs/operations/README.md";

/** Metric names emitted by the API instrumentation layer. */
export const METRICS = {
  ingestionAccepted: "ingestion.accepted.total",
  ingestionRejected: "ingestion.rejected.total",
  reviewBacklog: "review.backlog.count",
  chainConfirmationLatency: "chain.confirmation.latency_ms",
  apiErrors: "api.errors.total",
  apiRequests: "api.requests.total",
} as const;

/**
 * Actionable alert rules with thresholds, runbook links, and dedupe keys.
 * Dedupe keys collapse repeated firings for the same rule + scope.
 */
export const ALERT_RULES: AlertRule[] = [
  {
    id: "ingestion-rejection-spike",
    metric: METRICS.ingestionRejected,
    threshold: 5,
    comparison: "gte",
    windowSeconds: 300,
    runbook: `${RUNBOOK_BASE}#ingestion-rejection-spike`,
    dedupeKey: "ingestion-rejection-spike",
    description: "Ingestion rejections exceed 5 in 5 minutes.",
  },
  {
    id: "review-backlog-growth",
    metric: METRICS.reviewBacklog,
    threshold: 100,
    comparison: "gte",
    windowSeconds: 900,
    runbook: `${RUNBOOK_BASE}#review-backlog-growth`,
    dedupeKey: "review-backlog-growth",
    description: "Pending review backlog is at or above 100 items.",
  },
  {
    id: "chain-confirmation-delay",
    metric: METRICS.chainConfirmationLatency,
    threshold: 120_000,
    comparison: "gt",
    windowSeconds: 600,
    runbook: `${RUNBOOK_BASE}#chain-confirmation-delay`,
    dedupeKey: "chain-confirmation-delay",
    description: "Chain confirmation latency exceeds 120s.",
  },
  {
    id: "api-error-rate",
    metric: METRICS.apiErrors,
    threshold: 20,
    comparison: "gte",
    windowSeconds: 300,
    runbook: `${RUNBOOK_BASE}#api-error-rate`,
    dedupeKey: "api-error-rate",
    description: "API error count reaches 20 in 5 minutes.",
  },
];

const samples: MetricSample[] = [];
const firedAlerts = new Map<string, number>();
const MAX_SAMPLES = 5000;

function record(name: string, value: number, labels: Record<string, string>): void {
  samples.push({ name, value, labels, timestamp: Date.now() });
  if (samples.length > MAX_SAMPLES) {
    samples.splice(0, samples.length - MAX_SAMPLES);
  }
}

/** Records an ingestion attempt outcome. Never pass raw readings. */
export function recordIngestion(outcome: IngestionOutcome): void {
  const name =
    outcome === "accepted" ? METRICS.ingestionAccepted : METRICS.ingestionRejected;
  record(name, 1, { outcome });
}

/** Records the current pending review backlog size. */
export function recordReviewBacklog(pendingCount: number): void {
  record(METRICS.reviewBacklog, pendingCount, {});
}

/** Records chain confirmation latency in milliseconds for a stage. */
export function recordChainConfirmation(stage: ChainStage, latencyMs: number): void {
  record(METRICS.chainConfirmationLatency, latencyMs, { stage });
}

/** Records an API error by coarse class (no identifiers). */
export function recordApiError(errorClass: ApiErrorClass): void {
  record(METRICS.apiErrors, 1, { error_class: errorClass });
}

/** Records an API request by route template and status class. */
export function recordApiRequest(route: string, statusClass: string): void {
  record(METRICS.apiRequests, 1, { route, status_class: statusClass });
}

function sumInWindow(metric: string, windowSeconds: number): number {
  const cutoff = Date.now() - windowSeconds * 1000;
  return samples
    .filter((s) => s.name === metric && s.timestamp >= cutoff)
    .reduce((total, s) => total + s.value, 0);
}

/**
 * Evaluates alert rules against buffered samples. Returns newly fired alerts
 * only; repeated firings within the dedupe window are suppressed.
 */
export function evaluateAlerts(dedupeWindowSeconds = 900): AlertEvent[] {
  const now = Date.now();
  const fired: AlertEvent[] = [];

  for (const rule of ALERT_RULES) {
    const value = sumInWindow(rule.metric, rule.windowSeconds);
    const breached =
      rule.comparison === "gt" ? value > rule.threshold : value >= rule.threshold;
    if (!breached) continue;

    const lastFired = firedAlerts.get(rule.dedupeKey);
    if (lastFired && now - lastFired < dedupeWindowSeconds * 1000) continue;

    firedAlerts.set(rule.dedupeKey, now);
    fired.push({
      ruleId: rule.id,
      dedupeKey: rule.dedupeKey,
      value,
      threshold: rule.threshold,
      runbook: rule.runbook,
      firedAt: now,
    });
  }

  return fired;
}

/** Returns buffered samples for dashboard rendering (service-level trends). */
export function getMetricSamples(metric?: string): MetricSample[] {
  return metric ? samples.filter((s) => s.name === metric) : [...samples];
}

/** Test helper: clears buffered samples and dedupe state. */
export function resetInstrumentation(): void {
  samples.length = 0;
  firedAlerts.clear();
}

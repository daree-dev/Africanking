/**
 * Production observability for critical user journeys.
 *
 * Privacy-safe by construction: metrics and alerts only carry low-cardinality
 * labels (route, status class, journey, outcome). Never pass wallet
 * signatures, raw meter readings, or direct personal identifiers (names,
 * emails, phone numbers, member IDs) into these helpers.
 */

export type Journey =
  | "ingestion"
  | "review"
  | "chain_confirmation"
  | "api";

export type MetricKind = "counter" | "gauge" | "histogram";

export interface MetricDefinition {
  name: string;
  kind: MetricKind;
  journey: Journey;
  description: string;
  /** Allowed label keys. Anything else is dropped before emission. */
  labels: readonly string[];
  unit?: "ms" | "count" | "ratio";
}

/**
 * Canonical metric catalogue. Keep label sets small and non-identifying.
 */
export const METRICS: Record<string, MetricDefinition> = {
  ingestionAccepted: {
    name: "ingestion_accepted_total",
    kind: "counter",
    journey: "ingestion",
    description: "Readings accepted into the ingestion pipeline.",
    labels: ["source", "outcome"],
    unit: "count",
  },
  ingestionRejected: {
    name: "ingestion_rejected_total",
    kind: "counter",
    journey: "ingestion",
    description: "Readings rejected during ingestion.",
    labels: ["source", "reason"],
    unit: "count",
  },
  reviewBacklog: {
    name: "review_backlog_items",
    kind: "gauge",
    journey: "review",
    description: "Items awaiting cooperative review.",
    labels: ["queue"],
    unit: "count",
  },
  reviewOldestAge: {
    name: "review_oldest_item_age_ms",
    kind: "gauge",
    journey: "review",
    description: "Age of the oldest item awaiting review.",
    labels: ["queue"],
    unit: "ms",
  },
  chainConfirmationLatency: {
    name: "chain_confirmation_latency_ms",
    kind: "histogram",
    journey: "chain_confirmation",
    description: "Time from submission to confirmed finality.",
    labels: ["network", "outcome"],
    unit: "ms",
  },
  apiErrorRate: {
    name: "api_error_ratio",
    kind: "gauge",
    journey: "api",
    description: "Share of API responses in the 5xx class.",
    labels: ["route", "status_class"],
    unit: "ratio",
  },
  apiRequestDuration: {
    name: "api_request_duration_ms",
    kind: "histogram",
    journey: "api",
    description: "API request latency.",
    labels: ["route", "status_class"],
    unit: "ms",
  },
};

export type MetricLabels = Record<string, string | number>;

export interface MetricSample {
  metric: string;
  value: number;
  labels: MetricLabels;
  timestamp: number;
}

/**
 * Strip any label not declared on the metric definition. This is the guard
 * that keeps wallet signatures, raw readings, and PII out of telemetry even
 * if a caller passes them by mistake.
 */
export function sanitizeLabels(
  metric: MetricDefinition,
  labels: MetricLabels = {},
): MetricLabels {
  const safe: MetricLabels = {};
  for (const key of metric.labels) {
    const value = labels[key];
    if (value === undefined || value === null) continue;
    safe[key] = typeof value === "string" ? value.slice(0, 64) : value;
  }
  return safe;
}

export function buildSample(
  metricKey: keyof typeof METRICS,
  value: number,
  labels: MetricLabels = {},
  timestamp: number = Date.now(),
): MetricSample {
  const metric = METRICS[metricKey];
  return {
    metric: metric.name,
    value,
    labels: sanitizeLabels(metric, labels),
    timestamp,
  };
}

export type AlertSeverity = "warning" | "critical";

export interface AlertRule {
  id: string;
  journey: Journey;
  severity: AlertSeverity;
  /** Human-readable summary shown in the alert payload. */
  summary: string;
  /** PromQL-style expression evaluated by the metrics backend. */
  expression: string;
  /** Threshold that must be exceeded for `forDurationMs`. */
  threshold: number;
  /** How long the condition must hold before firing. */
  forDurationMs: number;
  /** Link to the operator runbook for this alert. */
  runbookUrl: string;
  /** Window used to collapse duplicate firings into one notification. */
  dedupeWindowMs: number;
}

const RUNBOOK_BASE = "https://github.com/coop-ledger/docs/blob/main/docs/operations";

/**
 * Actionable alert catalogue. Every rule has a threshold, a runbook link,
 * and a deduplication window so operators get one notification per incident.
 */
export const ALERT_RULES: readonly AlertRule[] = [
  {
    id: "ingestion-acceptance-drop",
    journey: "ingestion",
    severity: "critical",
    summary: "Ingestion acceptance rate dropped below 90% for 10 minutes.",
    expression:
      "sum(rate(ingestion_accepted_total[5m])) / (sum(rate(ingestion_accepted_total[5m])) + sum(rate(ingestion_rejected_total[5m]))) < 0.9",
    threshold: 0.9,
    forDurationMs: 10 * 60 * 1000,
    runbookUrl: `${RUNBOOK_BASE}/disaster-recovery.md#ingestion-failures`,
    dedupeWindowMs: 30 * 60 * 1000,
  },
  {
    id: "review-backlog-growth",
    journey: "review",
    severity: "warning",
    summary: "Review backlog exceeds 200 items or oldest item is older than 48h.",
    expression:
      "max(review_backlog_items) > 200 or max(review_oldest_item_age_ms) > 172800000",
    threshold: 200,
    forDurationMs: 15 * 60 * 1000,
    runbookUrl: `${RUNBOOK_BASE}/README.md#review-backlog`,
    dedupeWindowMs: 60 * 60 * 1000,
  },
  {
    id: "chain-confirmation-latency",
    journey: "chain_confirmation",
    severity: "critical",
    summary: "p95 chain confirmation latency exceeds 5 minutes.",
    expression:
      "histogram_quantile(0.95, sum(rate(chain_confirmation_latency_ms_bucket[10m])) by (le)) > 300000",
    threshold: 300000,
    forDurationMs: 10 * 60 * 1000,
    runbookUrl: `${RUNBOOK_BASE}/disaster-recovery.md#chain-finality-delays`,
    dedupeWindowMs: 30 * 60 * 1000,
  },
  {
    id: "api-error-rate",
    journey: "api",
    severity: "critical",
    summary: "API 5xx error ratio exceeds 2% for 5 minutes.",
    expression: "sum(rate(api_error_ratio[5m])) > 0.02",
    threshold: 0.02,
    forDurationMs: 5 * 60 * 1000,
    runbookUrl: `${RUNBOOK_BASE}/README.md#api-error-rate`,
    dedupeWindowMs: 15 * 60 * 1000,
  },
  {
    id: "dashboard-staleness",
    journey: "api",
    severity: "warning",
    summary: "Observability pipeline has not reported for 15 minutes.",
    expression: "time() - max(observability_last_scrape_timestamp_seconds) > 900",
    threshold: 900,
    forDurationMs: 15 * 60 * 1000,
    runbookUrl: `${RUNBOOK_BASE}/README.md#stale-dashboards`,
    dedupeWindowMs: 60 * 60 * 1000,
  },
];

export interface AlertFiring {
  ruleId: string;
  severity: AlertSeverity;
  summary: string;
  runbookUrl: string;
  firedAt: number;
  /** Stable key used to collapse duplicate notifications. */
  dedupeKey: string;
}

/**
 * Tracks recent firings so repeated evaluations of the same rule within its
 * dedupe window produce a single notification.
 */
export class AlertDeduplicator {
  private readonly lastFired = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * Returns an AlertFiring when the rule should notify, or null when the
   * firing is a duplicate inside the dedupe window.
   */
  evaluate(rule: AlertRule, labels: MetricLabels = {}): AlertFiring | null {
    const dedupeKey = `${rule.id}:${JSON.stringify(sanitizeLabels(
      { labels: rule.id } as unknown as MetricDefinition,
      labels,
    ))}`;
    const now = this.now();
    const previous = this.lastFired.get(dedupeKey);
    if (previous !== undefined && now - previous < rule.dedupeWindowMs) {
      return null;
    }
    this.lastFired.set(dedupeKey, now);
    return {
      ruleId: rule.id,
      severity: rule.severity,
      summary: rule.summary,
      runbookUrl: rule.runbookUrl,
      firedAt: now,
      dedupeKey,
    };
  }

  reset(): void {
    this.lastFired.clear();
  }
}

/**
 * Privacy-safe production observability for critical user journeys.
 *
 * Design constraints (issue #104):
 * - Never record wallet signatures, raw meter readings, or direct personal
 *   identifiers (names, emails, phone numbers, addresses).
 * - Only low-cardinality, non-identifying labels are allowed.
 * - Metrics are emitted as structured log lines so any log/metric backend can
 *   ingest them without adding a new dependency.
 */

export type IngestionOutcome = "accepted" | "rejected" | "duplicate";
export type ReviewState = "pending" | "approved" | "rejected";
export type ChainStage = "submitted" | "confirmed" | "failed";
export type ApiOutcome = "success" | "client_error" | "server_error";

/**
 * Allow-list of label keys. Anything else is dropped before emission so that
 * callers cannot accidentally leak identifiers into telemetry.
 */
const ALLOWED_LABELS = new Set([
  "route",
  "method",
  "status",
  "outcome",
  "stage",
  "cooperative_id",
  "review_state",
  "error_code",
]);

/**
 * Keys that must never appear in telemetry, even if a caller passes them.
 * Defense in depth on top of the allow-list.
 */
const FORBIDDEN_LABEL_PATTERN =
  /(signature|signed|secret|token|reading|meter|email|phone|name|address|wallet|ssn|dob)/i;

export interface MetricLabels {
  route?: string;
  method?: string;
  status?: number;
  outcome?: string;
  stage?: string;
  cooperative_id?: string;
  review_state?: string;
  error_code?: string;
}

export interface MetricEvent {
  metric: string;
  value: number;
  labels: Record<string, string | number>;
  timestamp: string;
}

function sanitizeLabels(labels: MetricLabels): Record<string, string | number> {
  const clean: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(labels)) {
    if (value === undefined || value === null) continue;
    if (!ALLOWED_LABELS.has(key)) continue;
    if (FORBIDDEN_LABEL_PATTERN.test(key)) continue;
    clean[key] = value;
  }
  return clean;
}

function emit(metric: string, value: number, labels: MetricLabels): MetricEvent {
  const event: MetricEvent = {
    metric,
    value,
    labels: sanitizeLabels(labels),
    timestamp: new Date().toISOString(),
  };
  // Structured single-line log; backends can parse the `metric` field.
  console.log(JSON.stringify({ type: "metric", ...event }));
  return event;
}

/** Ingestion acceptance: count accepted/rejected/duplicate submissions. */
export function recordIngestion(outcome: IngestionOutcome, cooperativeId?: string): MetricEvent {
  return emit("ingestion_total", 1, { outcome, cooperative_id: cooperativeId });
}

/** Review backlog: gauge of items awaiting review, sampled per cooperative. */
export function recordReviewBacklog(pendingCount: number, cooperativeId?: string): MetricEvent {
  return emit("review_backlog", pendingCount, { cooperative_id: cooperativeId });
}

/** Chain confirmation latency in milliseconds from submit to finality. */
export function recordChainLatency(
  stage: ChainStage,
  latencyMs: number,
  cooperativeId?: string,
): MetricEvent {
  return emit("chain_confirmation_latency_ms", latencyMs, {
    stage,
    cooperative_id: cooperativeId,
  });
}

/** API error rate: one sample per request with its outcome and status. */
export function recordApiRequest(
  route: string,
  method: string,
  status: number,
  errorCode?: string,
): MetricEvent {
  const outcome: ApiOutcome =
    status >= 500 ? "server_error" : status >= 400 ? "client_error" : "success";
  return emit("api_request_total", 1, { route, method, status, outcome, error_code: errorCode });
}

/**
 * Actionable alert definitions with thresholds, runbook links, and a
 * deduplication key so repeated breaches collapse into one page.
 */
export interface AlertRule {
  name: string;
  description: string;
  metric: string;
  threshold: number;
  comparison: "gt" | "lt";
  window: string;
  runbook: string;
  dedupeKey: string;
}

export const ALERT_RULES: AlertRule[] = [
  {
    name: "ingestion_rejection_spike",
    description: "Ingestion rejections exceed 10% of submissions over 15m.",
    metric: "ingestion_total",
    threshold: 0.1,
    comparison: "gt",
    window: "15m",
    runbook: "docs/operations/README.md#ingestion-rejection-spike",
    dedupeKey: "ingestion_rejection_spike",
  },
  {
    name: "review_backlog_growth",
    description: "Pending review backlog exceeds 100 items for 30m.",
    metric: "review_backlog",
    threshold: 100,
    comparison: "gt",
    window: "30m",
    runbook: "docs/operations/README.md#review-backlog-growth",
    dedupeKey: "review_backlog_growth",
  },
  {
    name: "chain_confirmation_delay",
    description: "p95 chain confirmation latency exceeds 120s over 10m.",
    metric: "chain_confirmation_latency_ms",
    threshold: 120000,
    comparison: "gt",
    window: "10m",
    runbook: "docs/operations/README.md#chain-confirmation-delay",
    dedupeKey: "chain_confirmation_delay",
  },
  {
    name: "api_error_rate",
    description: "Server error rate exceeds 5% of requests over 5m.",
    metric: "api_request_total",
    threshold: 0.05,
    comparison: "gt",
    window: "5m",
    runbook: "docs/operations/README.md#api-error-rate",
    dedupeKey: "api_error_rate",
  },
];

/**
 * Deduplicating alert dispatcher. Suppresses repeat pages for the same
 * dedupeKey within the cooldown window so operators are not flooded.
 */
export function createAlertDispatcher(
  notify: (rule: AlertRule) => void,
  cooldownMs = 15 * 60 * 1000,
  now: () => number = Date.now,
): (rule: AlertRule) => boolean {
  const lastFired = new Map<string, number>();
  return (rule: AlertRule): boolean => {
    const ts = now();
    const previous = lastFired.get(rule.dedupeKey);
    if (previous !== undefined && ts - previous < cooldownMs) {
      return false;
    }
    lastFired.set(rule.dedupeKey, ts);
    notify(rule);
    return true;
  };
}

# Observability Runbook — Critical User Journeys

This runbook defines the privacy-safe metrics, dashboards, and alerts operators use to
detect failed ingestion, delayed finality, authorization denials, and stale dashboards
before cooperatives report issues.

Scope note: this is cooperative-management observability. Generation credits are
assigned to cooperative members; this is **not** an external certificate marketplace
and makes **no** claim of I-REC/ESG certification.

## 1. Privacy-safe telemetry rules

Telemetry must never contain:

- Wallet signatures, signed payloads, or private keys.
- Raw meter readings or any raw device payloads.
- Direct personal identifiers (names, emails, phone numbers, national IDs, addresses).

Allowed dimensions are coarse and non-identifying only:

- `cooperative_id` (opaque internal ID, not a name).
- `member_ref` (opaque internal ID, never a name/email).
- `endpoint` (route template, e.g. `/api/ingestion/:id`, not the concrete path).
- `status_class` (`2xx`, `4xx`, `5xx`), `reason` (enum), `stage` (enum).

If a field is not on the allow-list above, it does not go into a metric label.

## 2. Metrics

All metrics are counters or histograms. Labels are restricted to the allow-list in §1.

### Ingestion acceptance

| Metric | Type | Labels | Meaning |
| --- | --- | --- | --- |
| `ingestion_requests_total` | counter | `cooperative_id`, `status_class`, `reason` | Ingestion submissions by outcome. |
| `ingestion_accepted_total` | counter | `cooperative_id` | Successfully accepted readings (count only, no values). |
| `ingestion_rejected_total` | counter | `cooperative_id`, `reason` | Rejected submissions by reason enum. |
| `ingestion_acceptance_ratio` | gauge (derived) | `cooperative_id` | `accepted / (accepted + rejected)` over 15m. |

### Review backlog

| Metric | Type | Labels | Meaning |
| --- | --- | --- | --- |
| `review_queue_depth` | gauge | `cooperative_id` | Items awaiting review. |
| `review_oldest_age_seconds` | gauge | `cooperative_id` | Age of the oldest pending review item. |
| `review_processed_total` | counter | `cooperative_id`, `reason` | Reviews completed by outcome. |

### Chain confirmation latency

| Metric | Type | Labels | Meaning |
| --- | --- | --- | --- |
| `chain_confirmation_seconds` | histogram | `stage` | Time from submission to confirmed finality. |
| `chain_pending_total` | gauge | `cooperative_id` | Submissions awaiting confirmation. |
| `chain_failed_total` | counter | `cooperative_id`, `reason` | Submissions that failed confirmation. |

### API error rates

| Metric | Type | Labels | Meaning |
| --- | --- | --- | --- |
| `api_requests_total` | counter | `endpoint`, `status_class` | Requests by route template and status class. |
| `api_error_ratio` | gauge (derived) | `endpoint` | `5xx / total` over 5m. |
| `authz_denied_total` | counter | `endpoint`, `reason` | Authorization denials by reason enum. |

## 3. Alerts

Each alert includes a threshold, a runbook link, and deduplication. Alerts are
deduplicated by `alertname` + `cooperative_id` (or `endpoint`) with a 30m silence
window so a single incident pages once, not per request.

| Alert | Condition | For | Severity | Runbook |
| --- | --- | --- | --- | --- |
| `IngestionAcceptanceDrop` | `ingestion_acceptance_ratio < 0.8` | 15m | page | [§4.1](#41-ingestion-acceptance-drop) |
| `IngestionRejectedSpike` | `rate(ingestion_rejected_total[5m]) > 10` | 10m | ticket | [§4.1](#41-ingestion-acceptance-drop) |
| `ReviewBacklogGrowing` | `review_queue_depth > 100` | 30m | ticket | [§4.2](#42-review-backlog-growing) |
| `ReviewBacklogStale` | `review_oldest_age_seconds > 86400` | 15m | page | [§4.2](#42-review-backlog-growing) |
| `ChainConfirmationSlow` | `histogram_quantile(0.95, chain_confirmation_seconds) > 300` | 15m | page | [§4.3](#43-chain-confirmation-slow) |
| `ChainConfirmationStalled` | `chain_pending_total > 50` | 20m | page | [§4.3](#43-chain-confirmation-slow) |
| `ApiErrorRateHigh` | `api_error_ratio > 0.05` | 10m | page | [§4.4](#44-api-error-rate-high) |
| `AuthzDenialSpike` | `rate(authz_denied_total[5m]) > 20` | 10m | ticket | [§4.5](#45-authz-denial-spike) |
| `DashboardStale` | `time() - dashboard_last_refresh_timestamp > 900` | 5m | ticket | [§4.6](#46-dashboard-stale) |

Deduplication config (per alert rule):

```yaml
# Example: IngestionAcceptanceDrop
group_by: [alertname, cooperative_id]
repeat_interval: 4h
inhibit_rules:
  - source: IngestionAcceptanceDrop
    target: IngestionRejectedSpike
    equal: [cooperative_id]
```

## 4. Runbook procedures

### 4.1 Ingestion acceptance drop

1. Check `ingestion_rejected_total` by `reason` to identify the dominant failure.
2. Confirm upstream device/API contract has not changed.
3. If a single cooperative is affected, verify their member/credit assignment config.
4. Escalate to on-call API owner if acceptance stays below 0.8 for 30m.

### 4.2 Review backlog growing

1. Inspect `review_queue_depth` and `review_oldest_age_seconds` per cooperative.
2. Confirm reviewers are active; check for stuck review jobs.
3. If oldest age exceeds 24h, page the operations lead.

### 4.3 Chain confirmation slow

1. Check `chain_confirmation_seconds` p95 and `chain_pending_total`.
2. Verify chain/RPC dependency health (see disaster-recovery runbook).
3. Do not resubmit blindly; confirm idempotency keys before retrying.

### 4.4 API error rate high

1. Identify the `endpoint` with elevated `api_error_ratio`.
2. Correlate with recent deploys and dependency health.
3. Roll back or fail over per the disaster-recovery runbook if sustained.

### 4.5 Authz denial spike

1. Check `authz_denied_total` by `endpoint` and `reason`.
2. Distinguish misconfigured clients from potential abuse.
3. Never log the denied request body or identifiers beyond the allow-list.

### 4.6 Dashboard stale

1. Confirm the dashboard refresh job is running.
2. Check `dashboard_last_refresh_timestamp` and the metrics scrape target.
3. Restart the refresh job if it has stalled; verify trends recover.

## 5. Validation

For each alert above:

1. Emit a controlled test event (synthetic metric with a test `cooperative_id`).
2. Confirm the alert fires within its `for` window and pages the right channel.
3. Confirm deduplication suppresses duplicate pages for the same incident.
4. Confirm the dashboard shows the expected service-level trend.
5. Clear the test event and confirm the alert resolves.

## 6. Rollout and risk

- Risk: medium. Metrics are additive; no existing data is modified.
- No migration required. New labels are allow-listed in §1.
- Roll out instrumentation behind existing API middleware; enable alerts after one
  week of baseline data to tune thresholds.
- Document any threshold changes in this runbook.

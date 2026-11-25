# Service-Level Objectives and Degradation Policy

This document defines the measurable service-level objectives (SLOs) for the
cooperative-management platform, the user-visible behavior when an SLO is at
risk or a dependency is degraded, and the review cadence for error budgets and
capacity assumptions.

Scope note: generation credits are assigned to cooperative members. This is not
an external certificate marketplace and does not claim I-REC/ESG certification.

## 1. Service-Level Objectives

All SLOs are measured over a rolling 28-day window unless stated otherwise.

| Area | SLI (what we measure) | SLO target | Window |
| --- | --- | --- | --- |
| API availability | Fraction of non-5xx responses to `/api/*` requests (excluding client 4xx) | 99.5% success | 28 days |
| Reading ingestion latency | Fraction of ingested readings persisted within 60s of receipt | 99% within 60s | 28 days |
| Chain status freshness | Fraction of time the last successful chain/RPC status poll is < 5 minutes old | 99% fresh | 28 days |
| Data durability | Fraction of accepted readings/credits durably persisted (no loss after ack) | 99.99% durable | 28 days |

Error budgets are derived from these targets (e.g. API availability budget is
0.5% of requests over 28 days).

## 2. Degradation Policy (user-visible behavior)

When an SLO is at risk or a dependency is degraded, the platform degrades
gracefully rather than failing hard. Behavior is keyed to the dependency.

### API degraded (availability SLO at risk)
- Serve cached/read-only responses where safe; return `503` with a `Retry-After`
  header for writes that cannot be safely queued.
- Surface a non-blocking banner: "Some actions are temporarily unavailable."
- Do not silently drop writes; reject with an explicit error the client can retry.

### Ingestion degraded (latency SLO at risk)
- Continue accepting readings into the durable queue; show "Readings queued,
  processing delayed" status to the member.
- Backpressure rather than dropping: reject new batches only when the queue is
  full, with an explicit retryable error.

### Chain/RPC degraded (freshness SLO at risk)
- Mark chain-backed status as "stale" with the timestamp of the last successful
  poll; never present stale data as current.
- Disable chain-dependent actions (e.g. on-chain settlement) until freshness is
  restored, with a clear explanation.

### Durability at risk
- Prefer failing the request over acknowledging data that is not durably
  persisted. Never ack before durable write.

## 3. Error-Budget Review and Capacity

- Review error-budget burn weekly; escalate when >50% of a budget is consumed in
  the first half of the window.
- After each review, update capacity assumptions (traffic growth, queue depth,
  RPC rate limits) based on observed burn trends and record changes here or in
the observability runbook.

## 4. Dashboards and Alerting

- Publish dashboards for each SLI above (availability, ingestion latency, chain
  freshness, durability) with the 28-day SLO line and current burn rate.
- Configure alerts on multi-window burn rates (fast burn: 2% budget in 1h; slow
  burn: 10% budget in 6h) per SLO.
- Validate alerting by inducing a controlled SLO breach in a non-production
  environment and confirming the expected alert fires and routes correctly.

## 5. Rollout and Migration

This policy is documentation and configuration only; no data migration is
required. Rollout: publish dashboards and alerts first, then enable the
degradation behaviors. Existing data is preserved unchanged.

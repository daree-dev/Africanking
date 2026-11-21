# Service-Level Objectives and Degradation Policy

This document defines the measurable reliability targets for the cooperative
management platform and the user-visible behavior when those targets are at
risk. Generation credits are assigned to cooperative members; this is not an
external certificate marketplace and makes no I-REC/ESG certification claim.

All SLOs are measured over a rolling **28-day window** unless stated otherwise.
Metrics are emitted by `src/lib/observability/metrics.ts` and alerts are wired
through `src/lib/observability/alerts.ts` (see
`docs/operations/observability-runbook.md`).

## 1. Service-Level Objectives

| Area | SLI (what we measure) | SLO target | Window |
| --- | --- | --- | --- |
| API availability | Fraction of non-5xx responses to `/api/*` requests | **99.5%** success | 28 days |
| API latency | Fraction of `/api/*` requests served under 800 ms (p95) | **95%** under 800 ms | 28 days |
| Reading ingestion latency | Time from reading submission to persisted + visible record | **99%** within 60 s; p95 within 15 s | 28 days |
| Chain status freshness | Age of the most recent successful chain/RPC status poll | **99%** of minutes with status < 120 s old | 28 days |
| Data durability | Fraction of accepted writes durably persisted (no loss after ack) | **99.99%** (no acknowledged write lost) | 28 days |

### Error budgets

Each SLO yields a 28-day error budget:

- API availability: 0.5% of requests may fail → budget = 0.5% of total requests.
- API latency: 5% of requests may exceed 800 ms.
- Ingestion latency: 1% of readings may exceed 60 s.
- Chain freshness: 1% of minutes may show stale status.
- Durability: 0.01% of acknowledged writes may be at risk (target: zero).

## 2. Degradation Policy (user-visible behavior)

When an SLO is at risk (budget burn rate high) or a dependency is degraded, the
system degrades gracefully rather than failing hard. Behavior is keyed to the
dependency that is unhealthy.

### API degraded (availability or latency SLO at risk)

- Serve cached/read-only responses where possible; surface a non-blocking
  banner: "Some data may be delayed while we recover."
- Reject new heavy writes with `503` + `Retry-After` instead of timing out.
- Preserve already-loaded cooperative and credit data; never blank the UI.

### Reading ingestion degraded (ingestion latency SLO at risk)

- Accept submissions into a durable queue and show "Reading queued — it will
  appear shortly" instead of an error.
- Display last-known ingestion lag to operators; members see a queued state.
- Do not drop readings; retry with backoff until persisted.

### Chain / RPC degraded (chain status freshness SLO at risk)

- Show the last known chain status with an explicit "as of <timestamp>" label
  and a stale indicator once status exceeds 120 s.
- Disable chain-dependent actions (e.g. on-chain verification) with an
  explanatory tooltip rather than failing silently.
- Fall back to the secondary RPC endpoint before marking status stale.

### Data durability at risk

- Block new writes that cannot be durably persisted; return `503` with a clear
  message. Never acknowledge a write that is not persisted.
- Preserve existing data; no destructive migration during degradation.

## 3. Error-budget review and capacity

- **Weekly** review of error-budget burn per SLO (dashboard below).
- **Monthly** capacity review: if a budget is consistently exhausted, raise
  capacity assumptions (RPC poll frequency, ingestion workers, API replicas)
  and record the change here.
- Any SLO breach triggers a post-incident note capturing root cause and the
  capacity assumption update.

## 4. Dashboards and alerting

- Dashboard panels: API success rate, API p95 latency, ingestion lag,
  chain-status age, durability write failures — all over the 28-day window.
- Alerts fire on multi-window burn rate (fast burn: 2% budget in 1 h; slow
  burn: 10% budget in 6 h) per SLO.
- **Validation:** demonstrate alerting by injecting a controlled SLO breach in
  staging (e.g. force 5xx on a canary route or pause the chain poller) and
  confirm the corresponding alert fires and the degradation banner appears.

## 5. Rollout / migration

No data migration is required. These SLOs and the degradation policy are
configuration and documentation only; existing data is preserved. Roll out by
enabling the metrics/alerts already defined in the observability modules and
publishing the dashboard described above.

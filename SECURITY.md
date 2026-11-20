# Security Policy

This repository is a cooperative energy management monorepo (JavaScript/pnpm + Rust/Cargo).
Generation credits are assigned to cooperative members; this project is **not** an external
certificate marketplace and makes **no** I-REC/ESG certification claim.

## Reporting a vulnerability

Do not open a public issue for security problems. Report privately to the maintainers
(see `docs/SECRETS.md` for contact/rotation procedures) and include reproduction steps,
affected package(s), and severity. We acknowledge reports within 2 business days.

## Dependency & contract supply-chain policy

### Scanning on pull requests

`.github/workflows/security.yml` runs dependency review on every pull request and fails on
newly introduced vulnerabilities at or above the configured threshold. It covers both
lockfiles:

- `pnpm-lock.yaml` (JavaScript/TypeScript workspaces)
- `Cargo.lock` (Rust crates)

A dependency-only change is the validation case: open a PR that bumps a single package and
confirm the dependency-review job runs and reports the diff.

### Severity SLAs

| Severity | Remediation SLA |
| -------- | --------------- |
| Critical | 24 hours |
| High     | 7 days |
| Medium   | 30 days |
| Low      | 90 days |

SLAs run from the time a finding is reported or surfaced by scanning.

### Exceptions and expiry

Any accepted risk must be recorded as a dependency-review exception with:

- the advisory ID and affected package,
- a written justification (why it is not exploitable here),
- an owner, and
- an **expiry date no more than 90 days out**.

Expired exceptions fail review; renew only with a fresh justification. Never silence a
finding without an expiry.

### Git-sourced contract dependencies

Contract libraries pulled from Git must be **pinned to an immutable commit SHA**, not a
branch or tag. Record the approved source revision next to the dependency (in the manifest
comment or the PR description) so reviewers can verify provenance. Updating a Git-sourced
dependency requires a PR that states the old and new revision and the reason for the bump.

### Safe update verification

Before merging any dependency update:

1. Confirm the lockfile diff matches the intended change (no unrelated churn).
2. Let CI (lint, typecheck, tests, dependency review) pass on the PR.
3. For Git-sourced contracts, verify the pinned SHA matches the reviewed revision.
4. Note any migration or rollout requirement in the PR description.

## How maintainers handle findings

1. Triage the finding and assign a severity per the SLA table.
2. Open a fix PR (bump, patch, or pin) referencing the advisory.
3. If remediation is not immediately possible, add a time-boxed exception as above.
4. Track open findings until fixed or the exception expires.

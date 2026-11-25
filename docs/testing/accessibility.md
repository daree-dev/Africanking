# Accessibility & Visual Regression Testing

## Overview

The `accessibility-visual.yml` CI workflow runs on every PR that touches `apps/web` or `apps/api`.

Two independent jobs run in parallel:

| Job | Tool | What it checks |
|---|---|---|
| **accessibility** | Playwright + @axe-core/playwright | WCAG 2.1 AA violations (critical/serious impact) on critical screens |
| **visual-regression** | Playwright screenshot comparison | Pixel diffs against committed baselines at three viewport widths |

## Critical screens

Both jobs cover the same set of screens:

| Screen | Path |
|---|---|
| Login | `/login` |
| Main dashboard | `/dashboard` |
| Member management | `/dashboard/cooperative/members` |
| Cooperative overview / meters | `/dashboard/cooperative` |

## Viewports

Visual regression snapshots are taken at:

| Name | Width × Height | Device |
|---|---|---|
| mobile | 375 × 812 | iPhone SE |
| tablet | 768 × 1024 | iPad portrait |
| desktop | 1440 × 900 | Standard laptop |

## Accessibility rules

axe-core tags used: `wcag2a`, `wcag2aa`, `wcag21aa`.

Only **critical** and **serious** impact violations fail the job. Moderate and minor violations are reported in the artifact but do not block the PR. Adjust this in `critical-screens.a11y.ts` if stricter enforcement is needed.

Radix portal tooltips (`#radix-popper-content-wrapper`) are excluded because they are injected outside the main tree and produce false positives.

## Snapshot update policy

**Never auto-update snapshots in CI.** Visual baseline updates require a human reviewer.

To update baselines locally after a deliberate UI change:

```bash
cd apps/web
npx playwright test --config=playwright-visual.config.ts --update-snapshots
```

Review every changed snapshot image before committing. Commits that update snapshots must include a note in the PR description explaining which screens changed and why.

## Running locally

### Accessibility

```bash
cd apps/web
npm install --save-dev @axe-core/playwright @playwright/test
npx playwright install chromium
npx playwright test --config=playwright-a11y.config.ts
```

### Visual regression

```bash
cd apps/web
npm install --save-dev @playwright/test
npx playwright install chromium
npx playwright test --config=playwright-visual.config.ts
```

## Known-violation fixtures

Both test suites include a fixture test that proves the check catches real problems:

- `critical-screens.a11y.ts` — navigates to `/__test-fixtures/a11y-violation` and asserts `violations.length > 0`.
- `critical-screens.visual.ts` — navigates to `/__test-fixtures/visual-regression` and asserts the screenshot differs from baseline.

These fixture tests are **skipped** in CI unless a fixture server is explicitly running. To verify locally, start a dev server that serves those paths with known bad markup/layout.

## Artifact retention

| Artifact | Retention |
|---|---|
| `axe-accessibility-report` | 14 days |
| `visual-regression-diffs` | 7 days (uploaded only on failure) |

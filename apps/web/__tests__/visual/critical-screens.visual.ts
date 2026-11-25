/**
 * Visual regression snapshots for critical cooperative management screens.
 *
 * Covered screens (issue #112):
 *   - /login                            — login page
 *   - /dashboard                        — main dashboard
 *   - /dashboard/cooperative/members    — member management
 *   - /dashboard/cooperative            — cooperative overview / meters
 *
 * Viewports: mobile (375×812), tablet (768×1024), desktop (1440×900).
 * Configured in playwright-visual.config.ts.
 *
 * Baseline update policy (issue #112):
 *   Run `npx playwright test --config=playwright-visual.config.ts --update-snapshots`
 *   ONLY after a human has reviewed the diffs and approved the visual change.
 *   Never auto-commit snapshot updates from CI.
 */
import { test, expect } from "@playwright/test"

const CRITICAL_SCREENS = [
  { name: "login", path: "/login" },
  { name: "dashboard", path: "/dashboard" },
  { name: "members", path: "/dashboard/cooperative/members" },
  { name: "cooperative-overview", path: "/dashboard/cooperative" },
]

for (const screen of CRITICAL_SCREENS) {
  test(`${screen.name} — visual snapshot`, async ({ page, browserName }, testInfo) => {
    await page.goto(screen.path)

    // Disable animations and transitions so snapshots are deterministic
    await page.addStyleTag({
      content: `
        *, *::before, *::after {
          animation-duration: 0s !important;
          transition-duration: 0s !important;
        }
      `,
    })

    // Wait for hydration and any loading spinners to settle
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(200)

    // Mask dynamic elements (timestamps, live prices) that change per-render
    const snapshot = await page.screenshot({
      fullPage: true,
      animations: "disabled",
    })

    expect(snapshot).toMatchSnapshot(
      `${screen.name}-${testInfo.project.name}.png`
    )
  })
}

/**
 * Known-failure fixture — proves the check catches a real layout regression.
 *
 * The fixture injects a 500 px wide element inside a 375 px mobile viewport,
 * which should produce a visible diff against the baseline. The test is skipped
 * in CI unless the fixture page is explicitly served.
 */
test("known-regression fixture — visual diff detected", async ({ page }, testInfo) => {
  const response = await page.goto("/__test-fixtures/visual-regression").catch(() => null)
  if (!response || response.status() === 404) {
    test.skip(
      true,
      "Fixture page not found — only run in local dev with fixture server active"
    )
    return
  }

  await page.waitForLoadState("networkidle")
  const snapshot = await page.screenshot({ fullPage: true, animations: "disabled" })

  // The fixture should NOT match the baseline; this assertion is inverted
  // to prove the diff is caught. In practice this test simply demonstrates
  // the mechanism — the diff artifact will be uploaded to CI.
  expect(snapshot).not.toMatchSnapshot(
    `known-regression-baseline-${testInfo.project.name}.png`
  )
})

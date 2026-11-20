/**
 * Axe-core accessibility checks for critical cooperative management screens.
 *
 * Covered screens (issue #112):
 *   - /login                            — login page
 *   - /dashboard                        — main dashboard
 *   - /dashboard/cooperative/members    — member management
 *   - /dashboard/cooperative            — cooperative overview / meters
 *
 * Rules engine: @axe-core/playwright (wraps axe-core 4.x).
 *
 * Baseline intent: these tests MUST FAIL on a known violation fixture and PASS
 * on the current supported screens. See docs/testing/accessibility.md for the
 * snapshot update policy.
 */
import { test, expect } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"

/** Screens to audit */
const CRITICAL_SCREENS = [
  { name: "login", path: "/login" },
  { name: "dashboard", path: "/dashboard" },
  { name: "members", path: "/dashboard/cooperative/members" },
  { name: "cooperative-overview", path: "/dashboard/cooperative" },
]

for (const screen of CRITICAL_SCREENS) {
  test(`${screen.name} — no critical or serious axe violations`, async ({ page }) => {
    await page.goto(screen.path)

    // Wait for the main content region to be present
    await page.waitForSelector("main, [role=main]", { timeout: 10_000 }).catch(() => {
      // Some pages may not use <main>; proceed with full-page scan
    })

    const results = await new AxeBuilder({ page })
      // Only report critical/serious issues to reduce noise from third-party widgets
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .exclude("#radix-popper-content-wrapper") // Radix portal tooltips (known false-positive)
      .analyze()

    // Surface violation details in test output for easy debugging
    const critical = results.violations.filter((v) =>
      ["critical", "serious"].includes(v.impact ?? "")
    )

    if (critical.length > 0) {
      const summary = critical
        .map(
          (v) =>
            `[${v.impact}] ${v.id}: ${v.description}\n  Nodes: ${v.nodes
              .map((n) => n.target.join(", "))
              .join(" | ")}`
        )
        .join("\n\n")
      throw new Error(
        `Accessibility violations on ${screen.path}:\n\n${summary}\n\nFull report: ${JSON.stringify(results.violations, null, 2)}`
      )
    }

    expect(critical).toHaveLength(0)
  })
}

/**
 * Known-violation fixture — demonstrates that the check fails when a real
 * violation is present (issue #112 validation criterion).
 *
 * This test asserts we find a violation on a deliberately broken fixture page.
 * If the fixture is not served, the test is skipped rather than failed.
 */
test("known-violation fixture — axe detects the injected error", async ({ page }) => {
  const response = await page.goto("/__test-fixtures/a11y-violation").catch(() => null)
  if (!response || response.status() === 404) {
    test.skip(
      true,
      "Fixture page not found — only run in local dev with fixture server active"
    )
    return
  }

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze()

  expect(results.violations.length).toBeGreaterThan(0)
})

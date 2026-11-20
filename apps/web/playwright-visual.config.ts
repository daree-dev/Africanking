import { defineConfig, devices } from "@playwright/test"

/**
 * Playwright configuration for visual regression snapshots.
 * Covers three viewport widths per issue #112:
 *   375×812   — mobile
 *   768×1024  — tablet
 *   1440×900  — desktop
 */
export default defineConfig({
  testDir: "./__tests__/visual",
  testMatch: "**/*.visual.ts",
  timeout: 60_000,

  // Fail fast when a pixel diff exceeds threshold; never silently pass
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02, // 2% tolerance for anti-aliasing
      animations: "disabled",
    },
  },

  projects: [
    {
      name: "mobile",
      use: {
        ...devices["iPhone SE"],
        viewport: { width: 375, height: 812 },
      },
    },
    {
      name: "tablet",
      use: {
        ...devices["iPad (gen 7)"],
        viewport: { width: 768, height: 1024 },
      },
    },
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],

  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
  },

  reporter: [
    ["html", { outputFolder: "playwright-report/visual", open: "never" }],
    ["list"],
  ],
})

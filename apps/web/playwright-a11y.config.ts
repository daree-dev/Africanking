import { defineConfig, devices } from "@playwright/test"

/**
 * Playwright configuration for accessibility (axe-core) checks.
 * Covers critical screens per issue #112.
 */
export default defineConfig({
  testDir: "./__tests__/a11y",
  testMatch: "**/*.a11y.ts",
  timeout: 30_000,

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    // Chromium only for a11y; axe results are consistent across engines
    ...devices["Desktop Chrome"],
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  // Start the Next.js dev server if no external BASE URL is provided
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },

  reporter: [["html", { outputFolder: "playwright-report", open: "never" }]],
})

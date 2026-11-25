import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

/**
 * End-to-end test configuration for the cooperative onboarding and credit
 * review flows (issue #111).
 *
 * The suite runs against a production build (`next build` + `next start`) and
 * uses seeded disposable data. It must never point at configured production
 * services: `E2E_BASE_URL` is only honoured when `E2E_ALLOW_REMOTE=1` is set,
 * otherwise the local production server is used.
 */
const allowRemote = process.env.E2E_ALLOW_REMOTE === '1';
const useRemote = allowRemote && Boolean(process.env.E2E_BASE_URL);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [
        ['list'],
        ['html', { outputFolder: 'playwright-report', open: 'never' }],
        ['junit', { outputFile: 'playwright-report/junit.xml' }],
      ]
    : [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: useRemote ? BASE_URL : `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Never persist credentials or personal data in artifacts.
    testIdAttribute: 'data-testid',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: useRemote
    ? undefined
    : {
        command: `pnpm build && pnpm start --port ${PORT}`,
        url: `http://127.0.0.1:${PORT}`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        env: {
          NODE_ENV: 'production',
          E2E_SEED: '1',
        },
      },
});

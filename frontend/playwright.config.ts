import { defineConfig } from '@playwright/test';

/**
 * Browser acceptance tests against the REAL offline backend (via the Vite
 * proxy). They never start the backend, never touch its files, and abort
 * unless /v1/capabilities reports mode "offline". Uses the system Microsoft
 * Edge channel so no browser download is required.
 *
 * PCUB_FRONTEND_PORT (default 5173) selects the dev-server port; the dev server
 * it starts inherits PCUB_FRONTEND_PORT and PCUB_BACKEND_URL (see vite.config.ts).
 */
const baseURL = `http://localhost:${process.env.PCUB_FRONTEND_PORT ?? '5173'}`;

export default defineConfig({
  testDir: './e2e',
  // Live-mode specs need the fake-provider harness; they run only with playwright.live-fake.config.ts.
  testIgnore: ['live-fake/**'],
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL,
    channel: 'msedge',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});

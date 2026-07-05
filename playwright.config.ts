import { defineConfig, devices } from '@playwright/test';

/**
 * E2E config: runs tests from ./e2e against a production build served by
 * `vite preview` (not the dev server), so what's tested matches what ships.
 * 'chromium' runs in CI today; 'mobile-chromium' and 'webkit' are defined
 * for later units (viewport/gesture work) but are not yet wired into
 * build.yml.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: 'chromium-headless-shell' },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'webkit',
      use: { ...devices['iPhone 15'] },
    },
  ],
  webServer: {
    // --mode test loads .env.test (VITE_API_URL=http://localhost:5080/api),
    // NOT .env.production's real https://figurecollecting.com/api. Without
    // this, a production build talks to the live backend for real — the
    // network mocks below are anchored to :5080 and silently never match it.
    command: 'npm run build -- --mode test && npm run preview -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

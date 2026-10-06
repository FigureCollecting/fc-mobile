import { defineConfig, devices } from '@playwright/test';
import { SHOT_VIEWPORTS } from './e2e/caseViewports';
import { HANDS_OFF_LAUNCH_OPTIONS } from './e2e/handsOff';

/**
 * E2E config: runs tests from ./e2e against a production build served by
 * `vite preview` (not the dev server), so what's tested matches what ships.
 * 'chromium' runs in CI today; 'mobile-chromium' and 'webkit' are defined
 * for later units (viewport/gesture work) but are not yet wired into
 * build.yml. Each SHOT_VIEWPORTS size is a project of its own that runs only
 * the sign-off shot specs (e2e/*.shots.spec.ts): `npm run test:e2e:shots`.
 */
export default defineConfig({
  testDir: './e2e',
  // Image-level PWA acceptance has its own config (playwright.pwa.config.ts).
  // e2e/auth needs the local full stack; it runs from playwright.stack.config.ts.
  testIgnore: ['pwa/**', 'auth/**', '**/*.shots.spec.ts'],
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
      use: { ...devices['Desktop Chrome'], channel: 'chromium-headless-shell', launchOptions: HANDS_OFF_LAUNCH_OPTIONS },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'], launchOptions: HANDS_OFF_LAUNCH_OPTIONS },
    },
    {
      // The route guard only (e2e/fixtures.ts): --host-resolver-rules is a Chromium switch. Not in CI.
      name: 'webkit',
      use: { ...devices['iPhone 15'] },
    },
    ...SHOT_VIEWPORTS.map((v) => ({
      name: v.name,
      testMatch: '**/*.shots.spec.ts',
      testIgnore: ['pwa/**', 'auth/**'],
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chromium-headless-shell',
        viewport: { width: v.width, height: v.height },
        deviceScaleFactor: v.deviceScaleFactor,
        isMobile: v.mobile,
        hasTouch: v.mobile,
        launchOptions: HANDS_OFF_LAUNCH_OPTIONS,
      },
    })),
  ],
  webServer: [
    {
      // --mode test loads .env.test (VITE_API_URL=http://localhost:5080/api),
      // NOT .env.production's real https://figurecollecting.com/api. Without
      // this, a production build talks to the live backend for real — the
      // network mocks below are anchored to :5080 and silently never match it.
      command: 'npm run build -- --mode test && npm run preview -- --mode test --port 5173 --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // A genuine `vite build` (no --mode: defaults to production, loading
      // .env.production) on its own port and outDir, for the one check in
      // e2e/dead-screens.spec.ts that needs the REAL production config —
      // specifically, that .env.production never sets VITE_ALLOW_FIXTURE_OVERRIDE
      // (see src/dev-fixtures/fixtures.ts), unlike the --mode test build above.
      command: 'npm run build -- --outDir dist-prod-e2e && npm run preview -- --outDir dist-prod-e2e --port 4174 --strictPort',
      url: 'http://localhost:4174',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});

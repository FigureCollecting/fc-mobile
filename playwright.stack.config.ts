import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { SHOT_VIEWPORTS } from './e2e/caseViewports';
import { HANDS_OFF_LAUNCH_OPTIONS } from './e2e/handsOff';

// The suites on the local full stack: `npm run build:stack` behind nginx, the real coordinator
// and the mock issuer. globalSetup starts the stack (or reuses a detached one) on the default
// ports, which .env.stack's VITE_OIDC_ORIGIN assumes.
// - e2e/auth (WK-08): mobile-chromium.
// - e2e/sync (WK-13): Chromium at the Fold8's cover and open panels (the shots harness sizes),
//   and WebKit at the cover panel; a case WebKit cannot express says so where it skips.
process.env['FC_STACK_WEB_DIST'] ??= fileURLToPath(new URL('./dist-stack', import.meta.url));

const fold8 = (name: string) => {
  const v = SHOT_VIEWPORTS.find((s) => s.name === name)!;
  return { viewport: { width: v.width, height: v.height }, deviceScaleFactor: v.deviceScaleFactor, isMobile: v.mobile, hasTouch: v.mobile };
};

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  globalSetup: './e2e/stack/src/playwright.ts',
  use: {
    baseURL: 'http://localhost:8480',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'mobile-chromium', testDir: './e2e/auth', use: { ...devices['Pixel 7'], launchOptions: HANDS_OFF_LAUNCH_OPTIONS } },
    {
      name: 'sync-chromium-fold8-cover',
      testDir: './e2e/sync',
      use: { ...devices['Pixel 7'], ...fold8('fold8-cover-full'), launchOptions: HANDS_OFF_LAUNCH_OPTIONS },
    },
    {
      name: 'sync-chromium-fold8-open',
      testDir: './e2e/sync',
      use: { ...devices['Pixel 7'], ...fold8('fold8-open-full'), launchOptions: HANDS_OFF_LAUNCH_OPTIONS },
    },
    // The route guard only (e2e/fixtures.ts): --host-resolver-rules is a Chromium switch.
    { name: 'sync-webkit-fold8-cover', testDir: './e2e/sync', use: { ...devices['iPhone 15'], ...fold8('fold8-cover-full') } },
  ],
});

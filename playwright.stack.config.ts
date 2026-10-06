import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { HANDS_OFF_LAUNCH_OPTIONS } from './e2e/handsOff';

// The auth suite on the local full stack: `npm run build:stack` behind nginx, the real
// coordinator and the mock issuer. globalSetup starts the stack (or reuses a detached one)
// on the default ports, which .env.stack's VITE_OIDC_ORIGIN assumes.
process.env['FC_STACK_WEB_DIST'] ??= fileURLToPath(new URL('./dist-stack', import.meta.url));

export default defineConfig({
  testDir: './e2e/auth',
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
  projects: [{ name: 'mobile-chromium', use: { ...devices['Pixel 7'], launchOptions: HANDS_OFF_LAUNCH_OPTIONS } }],
});

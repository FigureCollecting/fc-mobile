import { defineConfig, devices } from '@playwright/test';
import { HANDS_OFF_LAUNCH_ARGS } from './e2e/handsOff';

/**
 * PWA acceptance against the fc-mobile-web IMAGE (not vite preview), behind
 * the local stack's edge and real coordinator (e2e/stack). Needs Docker and
 * two images built from this tree:
 *   FC_WEB_IMAGE       build N
 *   FC_WEB_IMAGE_NEXT  build N+1 (another VITE_BUILD_ID), for the update test
 * FC_STACK_WEB_IMAGE=$FC_WEB_IMAGE makes the stack's own web container the image too.
 */
export default defineConfig({
  testDir: './e2e/pwa',
  globalSetup: './e2e/stack/src/playwright.ts',
  timeout: 90_000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: { trace: 'off', screenshot: 'off', video: 'off' },
  projects: [
    {
      name: 'chromium',
      // Full Chromium (new headless): installability is not reported by the headless shell.
      use: { ...devices['Desktop Chrome'], channel: 'chromium', launchOptions: { args: HANDS_OFF_LAUNCH_ARGS } },
    },
  ],
});

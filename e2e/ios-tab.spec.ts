import { devices } from '@playwright/test';
import { expect, test } from './fixtures';

// An iPhone 15 Safari tab (not the installed app), in whichever engine the
// project runs: the install banner shows before the first sign-in, and must
// not cover the sign-in control (the sign-in-to-sync banner's).
const { defaultBrowserType: _engine, ...iphone } = devices['iPhone 15'];
test.use(iphone);

test('the iOS install banner leaves the sign-in control reachable', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('onboarding_complete', '1'));
  await page.goto('/');
  const banner = page.getByRole('note').filter({ hasText: 'Install to keep offline data' });
  await expect(banner).toBeVisible();
  // A trial click fails if anything else would receive the tap; it never leaves for the IdP.
  await page.getByRole('button', { name: 'Sign in' }).click({ trial: true, timeout: 5_000 });
  await expect(banner).toBeVisible();
});

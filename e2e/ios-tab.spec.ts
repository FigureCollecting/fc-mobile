import { devices } from '@playwright/test';
import { expect, test } from './fixtures';

// An iPhone 15 Safari tab (not the installed app), in whichever engine the
// project runs: the install banner shows, and must not cover the auth controls.
const { defaultBrowserType: _engine, ...iphone } = devices['iPhone 15'];
test.use(iphone);

test('the iOS install banner leaves every sign-in and register control reachable', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('onboarding_complete', '1'));
  await page.goto('/login');
  const banner = page.getByRole('note').filter({ hasText: 'Install to keep offline data' });
  await expect(banner).toBeVisible();

  // A trial click fails if anything else would receive the tap.
  for (const name of [/^sign in$/i, /forgot password/i, /create account/i]) {
    await page.getByRole('button', { name }).click({ trial: true, timeout: 2_000 });
  }
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/register/);
  await expect(banner).toBeVisible();
  await page.getByRole('button', { name: /create account/i }).click({ trial: true, timeout: 2_000 });
});

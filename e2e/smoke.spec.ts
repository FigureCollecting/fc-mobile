import { test, expect } from './fixtures';

// Single-test smoke: a fresh visitor lands on the collection with the sign-in-to-sync banner
// (Authentik owns sign-in, registration and 2FA: WK-15), and the old /login, /register and /2fa
// links land there too. Nothing is clicked that would leave for the IdP.
test.use({ serviceWorkers: 'block' });

test('a fresh visitor lands on the collection with the sign-in banner, and the old auth links land there too', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('onboarding_complete', '1'));
  for (const path of ['/', '/login', '/register', '/2fa']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
    await expect(page.getByRole('status').filter({ hasText: /sign in to sync your collection/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Sign in to see your collection')).toBeVisible();
    await expect(page.getByPlaceholder(/email address|password/i)).toHaveCount(0);
  }
});

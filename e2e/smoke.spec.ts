import { test, expect } from '@playwright/test';

// Single-test smoke: boot the dev server, land on /, confirm the first-run
// experience, drive the register form, and confirm a successful redirect.
test('fresh visitor can fill the register form and land on home', async ({ page }) => {
  // Intercept requests to the configured backend base URL (default for the
  // dev build is http://localhost:5080/api) — regex is anchored to the host
  // so Vite's own module requests for src/api/*.ts don't get swept up.
  const backendPattern = /^https?:\/\/[^/]+:5080\/api\//;
  await page.route(backendPattern, (route) => {
    const url = route.request().url();
    if (url.endsWith('/auth/register')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            _id: 'u-e2e',
            username: 'e2e-user',
            email: 'e2e@example.com',
            isAdmin: false,
            accessToken: 'e2e-token',
            refreshToken: 'e2e-refresh',
            emailVerified: false,
            twoFactorEnabled: false,
            webauthnCredentialCount: 0,
          },
        }),
      });
    }
    if (url.includes('/figures')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true, data: [], count: 0, page: 1, pages: 0, total: 0,
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: {} }),
    });
  });

  // Skip onboarding by seeding the completion flag BEFORE the SPA boots.
  await page.addInitScript(() => {
    try {
      localStorage.setItem('onboarding_complete', '1');
      // Also clear any persisted auth state so we're a truly fresh visitor.
      localStorage.removeItem('auth-storage');
    } catch {
      // ignore
    }
  });

  // Unregister any service workers cached from previous runs so /login
  // actually hits the dev server HTML.
  await page.goto('/');
  await page.evaluate(async () => {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  });

  await page.goto('/login');
  // Wait for hydration — any recognizable element is fine.
  await expect(page.getByPlaceholder(/email address/i)).toBeVisible({ timeout: 15_000 });

  // Navigate to Register.
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/register/);

  // Fill the form.
  await page.getByLabel(/username/i).fill('e2euser');
  await page.getByLabel(/email address/i).fill('e2e@example.com');
  await page.getByLabel(/^password$/i).fill('Str0ngP@ss!');
  await page.getByLabel(/confirm password/i).fill('Str0ngP@ss!');

  await page.getByRole('button', { name: /create account/i }).click();

  // On success we should be redirected to / (collection) and leave the auth
  // route. The Collection page renders the heading "Collection".
  await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
});

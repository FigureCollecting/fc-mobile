import { test, expect } from './fixtures';

// Paths that create styles at runtime, run under the shipped CSP (the fixture
// fails the test on any securitypolicyviolation).
test('first-run onboarding slides animate without an inline style', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Page 2' })).toBeVisible();
  for (const n of [2, 3, 1]) {
    await page.getByRole('tab', { name: `Page ${n}` }).click();
    // Let the exit animation run: that is when popLayout would inject a style element.
    await page.waitForTimeout(600);
  }
  await expect(page.locator('.onboarding__slide')).toHaveCount(1);
});

test('component styles apply under the CSP (adopted sheets, not <style> elements)', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('onboarding_complete', '1'));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  const probe = await page.evaluate(() => ({
    styleElements: document.querySelectorAll('style').length,
    adopted: document.adoptedStyleSheets.length,
    // .sync-auth-banner is styled only by its component CSS.
    buttonBackground: getComputedStyle(document.querySelector('.sync-auth-banner') as Element).backgroundColor,
  }));
  expect(probe.styleElements).toBe(0);
  expect(probe.adopted).toBeGreaterThan(0);
  expect(probe.buttonBackground).not.toBe('rgba(0, 0, 0, 0)');
});

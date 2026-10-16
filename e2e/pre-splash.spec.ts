import { test, expect } from './fixtures';

// The static splash (index.html) shows the figure over the name from the first paint, stays at
// least 600 ms, then fades and goes. The fixtures fail any test on a CSP violation, so the
// inline art is also proven allowed by the shipped policy.
test.use({ serviceWorkers: 'block' });

test('the splash paints the silhouette and name, holds 600 ms from first paint, then goes', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __splash: { removedAt?: number } };
    w.__splash = {};
    let seen = false;
    new MutationObserver(() => {
      const present = document.getElementById('pre-splash') !== null;
      if (present) seen = true;
      else if (seen && w.__splash.removedAt === undefined) w.__splash.removedAt = performance.now();
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto('/', { waitUntil: 'commit' });
  const splash = page.locator('#pre-splash');
  await expect(splash.locator('svg.pre-splash__art path')).toHaveCount(1);
  await expect(splash).toContainText('FigureCollecting');
  await expect(splash).toHaveCount(0, { timeout: 15_000 });
  const { removedAt, firstPaint } = await page.evaluate(() => ({
    removedAt: (window as unknown as { __splash: { removedAt: number } }).__splash.removedAt,
    firstPaint: performance.getEntriesByName('first-paint')[0]?.startTime ?? 0,
  }));
  expect(removedAt - firstPaint).toBeGreaterThanOrEqual(600 + 300 - 50);
});

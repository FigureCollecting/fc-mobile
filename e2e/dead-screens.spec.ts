import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

/**
 * WK-04: analytics/notifications/prices/push/export/calendar/collection-dna/
 * MFC-sync have no backend anywhere. These guard the production-build
 * behavior: no wasted requests to dead endpoints, and no bypassing sign-in.
 */

const backendPattern = /^https?:\/\/[^/]+:5080\/api\//;

async function mockBackend(page: Page) {
  await page.route(backendPattern, (route) => {
    const url = route.request().url();
    if (url.includes('/figures')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [], count: 0, page: 1, pages: 0, total: 0 }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: {} }),
    });
  });
}

async function seedVisitor(page: Page) {
  await page.addInitScript(() => localStorage.setItem('onboarding_complete', '1'));
}

test('idle app makes no requests to dead endpoints, and /analytics redirects to the collection', async ({ page }) => {
  test.setTimeout(90_000);
  await mockBackend(page);
  await seedVisitor(page);

  // page.on('request') never fires for a WebSocket handshake (Playwright has
  // no request event for it), so the socket.io client's /ws traffic needs its
  // own listener — otherwise this check would pass even if that client came
  // back. Path match, not substring, so e.g. '/api/wishlist' can't false-positive.
  const deadRequests: string[] = [];
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('/api/notifications') || new URL(url).pathname.startsWith('/ws')) {
      deadRequests.push(url);
    }
  });
  page.on('websocket', (ws) => {
    const url = ws.url();
    if (new URL(url).pathname.startsWith('/ws')) {
      deadRequests.push(url);
    }
  });

  await page.goto('/');
  await expect(page.getByRole('navigation', { name: /main navigation/i })).toBeVisible({ timeout: 15_000 });

  // /analytics has no backend — it should land back on the collection, not
  // show a dead screen.
  await page.goto('/analytics');
  await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

  // 60s of idle at the collection: no polling of dead endpoints.
  await page.goto('/');
  await page.waitForTimeout(60_000);
  expect(deadRequests).toEqual([]);
});

// This one needs the REAL production build (.env.production, no
// VITE_ALLOW_FIXTURE_OVERRIDE) — the shared :5173 server above is built with
// --mode test, which sets that var for the overlay/smoke suites. See
// playwright.config.ts's second webServer entry.
test.describe('real production build', () => {
  test.use({ baseURL: 'http://localhost:4174' });

  test('ignores fc-fixture-mode=on and still asks to sign in', async ({ page }) => {
    await page.route('https://figurecollecting.com/api/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
    );
    await page.addInitScript(() => {
      localStorage.setItem('onboarding_complete', '1');
      localStorage.setItem('fc-fixture-mode', 'on');
      localStorage.removeItem('auth-storage');
    });

    await page.goto('/');
    await expect(page.getByRole('status').filter({ hasText: /sign in to sync your collection/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Sign in to see your collection')).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test('ships no dev fixture art (real cut-outs or synthetic stand-ins) in its precache', async ({ request }) => {
    const sw = await request.get('/sw.js');
    expect(sw.ok()).toBe(true);
    const precachedPngs = (await sw.text()).match(/assets\/[^"']+\.png/g) ?? [];
    const fixtureArt = precachedPngs.filter((p) =>
      /assets\/(rem|dark-angel|miku-nendo|madoka|spike|miku-deepsea|ryuuko)-[\w-]+\.png/.test(p),
    );
    expect(fixtureArt).toEqual([]);
  });
});

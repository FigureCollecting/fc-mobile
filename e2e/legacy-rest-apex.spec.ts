import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { e2eServers } from './e2eServers';
import { isHandsOffUrl } from './handsOff';

/**
 * FLIP-LEGACY-REST: the app served at the apex. The old REST client's base was
 * https://figurecollecting.com/api, cross-origin (and refused by the CSP) on the
 * canary host and same-origin at the apex, where the coordinator answers an
 * unknown /api path 401 and the client then sent the page to /login.
 *
 * Each test gives the local preview build the apex as its origin: every request
 * to the apex is answered from that build, /api with the coordinator's 401,
 * and a request to any other origin is aborted, so nothing leaves this machine.
 */
const APEX = 'https://figurecollecting.com';

// A service worker's own requests pass no route; the page's do.
test.use({ serviceWorkers: 'block' });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
});

interface ApexWatch {
  /** Requests to the apex under /api. */
  api: string[];
  /** Requests to any other origin (each aborted). */
  offsite: string[];
  /** Every URL the page's main frame was at, in order. */
  visited: string[];
}

const isApi = (pathname: string): boolean => pathname === '/api' || pathname.startsWith('/api/');

async function serveAtApex(context: BrowserContext, page: Page, request: APIRequestContext, build: string): Promise<ApexWatch> {
  const watch: ApexWatch = { api: [], offsite: [], visited: [] };
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    // The hands-off guard's own route (e2e/handsOff.ts) aborts and counts these.
    if (isHandsOffUrl(url.href)) return route.fallback();
    if (url.origin !== APEX) {
      watch.offsite.push(url.href);
      return route.abort('blockedbyclient');
    }
    if (isApi(url.pathname)) {
      watch.api.push(`${route.request().method()} ${url.pathname}`);
      return route.fulfill({ status: 401, contentType: 'application/json', body: '{"code":"unauthenticated"}' });
    }
    const response = await request.get(`${build}${url.pathname}${url.search}`);
    return route.fulfill({ response });
  });
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) watch.visited.push(frame.url());
  });
  return watch;
}

function expectNoLegacyTraffic(watch: ApexWatch) {
  expect(watch.api, 'requests to /api at the apex').toEqual([]);
  expect(watch.offsite.filter((u) => isApi(new URL(u).pathname)), 'requests to /api on another origin').toEqual([]);
  expect(watch.visited.filter((u) => new URL(u).pathname === '/login'), 'navigations to /login').toEqual([]);
  expect(watch.visited.filter((u) => new URL(u).origin !== APEX), 'navigations off the apex').toEqual([]);
}

const nav = (page: Page) => page.getByRole('navigation', { name: /main navigation/i });

test('the watch counts a call to /api at the apex and answers it 401', async ({ context, page, request }) => {
  const watch = await serveAtApex(context, page, request, e2eServers().appUrl);
  await page.addInitScript(() => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
  });
  await page.goto(`${APEX}/`);
  await expect(nav(page)).toBeVisible({ timeout: 15_000 });
  expect(await page.evaluate(() => location.origin)).toBe(APEX);

  const status = await page.evaluate(async () => (await fetch('/api/push/vapid-key')).status);
  expect(status).toBe(401);
  expect(watch.api).toEqual(['GET /api/push/vapid-key']);
});

test('a full session in fixture mode at the apex sends nothing to /api and never goes to /login', async ({ context, page, request }) => {
  test.setTimeout(120_000);
  const watch = await serveAtApex(context, page, request, e2eServers().appUrl);
  await page.addInitScript(() => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
  });

  // The case, and a figure opened from it.
  await page.goto(`${APEX}/?layout=case`);
  await expect(nav(page)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('button.cab-figure').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 15_000 });
  // Offline, the app holds its requests back: this walk proves nothing unless the page is online.
  expect(await page.evaluate(() => navigator.onLine)).toBe(true);
  await page.locator('button.cab-figure').first().click();
  await expect(page.locator('.pswp, .detail-pane').first()).toBeVisible({ timeout: 15_000 });

  // The collection.
  await page.goto(`${APEX}/`);
  await expect(nav(page)).toBeVisible({ timeout: 15_000 });

  // Search (fixture mode has no local catalogue to find anything in).
  await page.goto(`${APEX}/discover`);
  await page.getByPlaceholder('Search your figures...').fill('Rem');
  await expect(page.getByRole('button', { name: 'Clear search' })).toBeVisible();
  await page.waitForTimeout(1_000);

  // Stats, profile, settings.
  await page.goto(`${APEX}/stats`);
  await expect(page.locator('.page-stats__tile').first()).toBeVisible({ timeout: 15_000 });
  await page.goto(`${APEX}/profile`);
  await expect(page.locator('.page-profile')).toBeVisible({ timeout: 15_000 });
  await page.goto(`${APEX}/settings`);
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible({ timeout: 15_000 });

  // The retired screens' links land on the collection.
  for (const path of ['/sync', '/export', '/notifications', '/prices', '/prices/fig-1', '/analytics', '/calendar', '/collection-dna']) {
    await page.goto(`${APEX}${path}`);
    await expect(page, path).toHaveURL(`${APEX}/`, { timeout: 15_000 });
    await expect(nav(page)).toBeVisible({ timeout: 15_000 });
  }

  // Long enough for a start-up call or a first poll to leave.
  await page.waitForTimeout(5_000);
  expectNoLegacyTraffic(watch);
});

// The build that ships (.env.production), on its own port: playwright.config.ts's second webServer.
test.describe('the production build at the apex', () => {
  const build = e2eServers().prodUrl;

  test('a signed-out visitor walks every route with nothing sent to /api and no trip to /login', async ({ context, page, request }) => {
    test.setTimeout(120_000);
    const watch = await serveAtApex(context, page, request, build);
    await page.addInitScript(() => localStorage.setItem('onboarding_complete', '1'));

    for (const path of ['/', '/discover', '/stats', '/profile', '/settings', '/import', '/review', '/profile/security', '/figure/none']) {
      await page.goto(`${APEX}${path}`);
      await expect(nav(page), path).toBeVisible({ timeout: 15_000 });
      await expect(page, path).toHaveURL(`${APEX}${path}`);
    }
    // Offline, the app holds its requests back: this walk proves nothing unless the page is online.
    expect(await page.evaluate(() => navigator.onLine)).toBe(true);
    for (const path of ['/sync', '/export', '/notifications', '/prices', '/prices/fig-1', '/analytics', '/calendar', '/collection-dna']) {
      await page.goto(`${APEX}${path}`);
      await expect(page, path).toHaveURL(`${APEX}/`, { timeout: 15_000 });
      await expect(nav(page), path).toBeVisible({ timeout: 15_000 });
    }

    await page.waitForTimeout(5_000);
    expectNoLegacyTraffic(watch);
  });

  test('ships no script that holds the old REST client', async ({ request }) => {
    // Every script the build can load: the page's own, the precache list's, and each one those name.
    const seen = new Map<string, string>();
    const queue: string[] = [];
    const take = (text: string) => {
      for (const m of text.matchAll(/["'`(](?:\.\/|\/?assets\/)([\w.~-]+\.js)["'`)]/g)) {
        const file = `/assets/${m[1]}`;
        if (!seen.has(file) && !queue.includes(file)) queue.push(file);
      }
    };
    for (const start of ['/', '/sw.js']) {
      const response = await request.get(`${build}${start}`);
      expect(response.ok(), start).toBe(true);
      take(await response.text());
    }
    while (queue.length > 0) {
      const file = queue.shift()!;
      const response = await request.get(`${build}${file}`);
      expect(response.ok(), file).toBe(true);
      const text = await response.text();
      seen.set(file, text);
      take(text);
    }
    expect(seen.size).toBeGreaterThan(5);

    // What only the old client and its callers held: its base-URL override, its endpoints, its hard navigation.
    const marks = [/fc\.apiUrl/, /\/push\/vapid-key/, /\/notifications\/unread-count/, /location\.assign\(\s*[`'"]\/login/];
    const holding = [...seen].flatMap(([file, text]) => marks.filter((mark) => mark.test(text)).map((mark) => `${file} holds ${mark.source}`));
    expect(holding).toEqual([]);
  });
});

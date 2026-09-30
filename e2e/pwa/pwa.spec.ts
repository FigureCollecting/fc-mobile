// WK-09 acceptance against the fc-mobile-web image. Signed-out, the app routes
// every screen to sign-in, so "renders" here means the shell boots from the
// service worker and draws that screen; screens on local data arrive in WK-15.
import { readFileSync } from 'node:fs';
import type { BrowserContext, Page } from '@playwright/test';
import { readStackState, stackClient } from '../stack/src/client.js';
import type { StackState } from '../stack/src/stack.js';
import { expect, test, watchCsp } from '../fixtures';
import { HANDS_OFF_LAUNCH_ARGS, blockHandsOff } from '../handsOff';
import type { Edge } from '../stack/src/edge.js';
import { bundleOutboxProbe, exec, imageUser, openEdge, requireImage, runWeb, type WebContainer } from './web';

const IMAGE = requireImage('FC_WEB_IMAGE');
const IMAGE_NEXT = requireImage('FC_WEB_IMAGE_NEXT');
const USER_SUB = '11111111-1111-4111-8111-111111111111';
const DEVICE = '0f0e0d0c-0b0a-4908-8706-050403020100';
const HEX64 = 'c0ffee'.padEnd(64, '0');

function stackState(): StackState {
  const state = readStackState();
  if (state === undefined) throw new Error('no stack state: globalSetup did not start e2e/stack');
  return state;
}
const stack = stackClient(stackState().controlUrl);
const heads = (JSON.parse(readFileSync(stackState().catalog.file, 'utf8')) as { heads: Array<{ headId: string }> }).heads;

// (b), across every test: nothing under /api is ever answered by the service worker.
const apiFromWorker: string[] = [];
test.beforeEach(async ({ context }) => {
  apiFromWorker.length = 0;
  context.on('response', (r) => {
    if (/^\/api(\/|$)/.test(new URL(r.url()).pathname) && r.fromServiceWorker()) apiFromWorker.push(r.url());
  });
  await context.addInitScript(() => {
    localStorage.setItem('onboarding_complete', '1');
    (window as unknown as { fcControlledAtLoad: boolean }).fcControlledAtLoad = navigator.serviceWorker?.controller != null;
  });
});
test.afterEach(() => expect(apiFromWorker, '/api responses served by the service worker').toEqual([]));

/** The worker has installed its precache and taken control of this page. */
async function shellInstalled(page: Page): Promise<void> {
  await page.waitForFunction(async () => {
    const reg = await navigator.serviceWorker.ready;
    return reg.active?.state === 'activated' && navigator.serviceWorker.controller !== null;
  });
}

const buildOf = (page: Page) => page.locator('meta[name="fc-build"]').getAttribute('content');
/** Null while the page is between documents. */
const buildNow = (page: Page) => buildOf(page).catch(() => null);
const controlledAtLoad = (page: Page) => page.evaluate(() => (window as unknown as { fcControlledAtLoad: boolean }).fcControlledAtLoad);
/**
 * The app's own trigger: returning to the foreground checks sw.js for a new
 * build. Repeated until the prompt shows, as the app listens only once registered.
 */
async function promptForUpdate(page: Page): Promise<void> {
  await expect(async () => {
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.getByRole('status')).toContainText(/new version/i, { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

async function buildServedBy(url: string): Promise<string> {
  const html = await (await fetch(`${url}/index.html`)).text();
  return /<meta name="fc-build" content="([^"]+)"/.exec(html)?.[1] ?? '';
}

async function stopWorkers(context: BrowserContext, page: Page): Promise<void> {
  const cdp = await context.newCDPSession(page);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  await cdp.detach();
}

test('(a) after one online visit, a true outage still cold-starts /, a figure deep link and /discover', async ({ context }) => {
  const { origin } = stackState();
  const first = await context.newPage();
  await first.goto(`${origin}/`);
  await expect(first.getByPlaceholder(/email address/i)).toBeVisible();
  await shellInstalled(first);

  await stack.edge.stop();
  await stack.web.stop();
  await stack.coordinator.stop();
  try {
    await expect(fetch(`${origin}/`)).rejects.toThrow();
    await stopWorkers(context, first);
    await first.close();
    for (const path of ['/', `/figure/${heads[0]?.headId}`, '/discover']) {
      const page = await context.newPage();
      const res = await page.goto(`${origin}${path}`);
      expect(res?.status(), path).toBe(200);
      expect(res?.fromServiceWorker(), path).toBe(true);
      await expect(page.getByPlaceholder(/email address/i), path).toBeVisible();
      await expect(page.locator('#pre-splash')).toHaveCount(0);
      await page.close();
    }
  } finally {
    await stack.coordinator.start();
    await stack.web.start();
    await stack.edge.start();
  }
});

test('(b) /api reaches the coordinator online, fails offline, and the image 404s it', async ({ page }) => {
  const { origin } = stackState();
  await page.goto(`${origin}/`);
  await shellInstalled(page);

  const logged = (await stack.edge.log()).length;
  const online = await page.evaluate(async () => {
    const r = await fetch('/api/x');
    return { status: r.status, nonce: r.headers.get('dpop-nonce') };
  });
  expect(online.status).toBe(401);
  expect(online.nonce).toBeTruthy();
  const nav = await page.goto(`${origin}/api/x`);
  expect(nav?.status()).toBe(401);
  // Workbox matches the navigation denylist against path plus query.
  const navQuery = await page.goto(`${origin}/api?x=1`);
  expect(navQuery?.fromServiceWorker()).toBe(false);
  const routed = (await stack.edge.log()).slice(logged).filter((e) => e.path === '/api/x' || e.path === '/api');
  expect(routed.map((e) => [e.path, e.route, e.status])).toEqual([
    ['/api/x', 'coordinator', 401],
    ['/api/x', 'coordinator', 401],
    ['/api', 'coordinator', navQuery?.status()],
  ]);

  await page.goto(`${origin}/`);
  await stack.edge.stop();
  try {
    const offline = await page.evaluate(async () => {
      const outcome = (p: Promise<Response>) => p.then((r) => `status ${r.status}`, (e: Error) => `error ${e.name}`);
      return {
        get: await outcome(fetch('/api/x')),
        push: await outcome(fetch('/api/coordinator.v1.SyncService/Push', { method: 'POST', body: '{}' })),
      };
    });
    expect(offline).toEqual({ get: 'error TypeError', push: 'error TypeError' });
    // A navigation to /api is not given the shell either.
    await expect(page.goto(`${origin}/api/x`)).rejects.toThrow(/ERR_CONNECTION_REFUSED/);
    await expect(page.goto(`${origin}/api?x=1`)).rejects.toThrow(/ERR_CONNECTION_REFUSED/);
  } finally {
    await stack.edge.start();
  }

  const web = (await stack.state()).web.url;
  for (const path of ['/api', '/api/x', '/api/coordinator.v1.SyncService/Push']) {
    const res = await fetch(`${web}${path}`, { headers: { accept: 'text/html', 'sec-fetch-mode': 'navigate' } });
    expect(res.status, path).toBe(404);
    expect(await res.text(), path).not.toContain('id="app"');
  }
});

test('(b) derivatives: same-origin CacheFirst, and only a 200 is kept', async ({ page }) => {
  const { origin } = stackState();
  await page.goto(`${origin}/`);
  await shellInstalled(page);
  const get = (path: string) => page.evaluate((p) => fetch(p).then((r) => r.status), path);
  const logged = (await stack.edge.log()).length;
  const hits = async (path: string) => (await stack.edge.log()).slice(logged).filter((e) => e.path === path).length;

  const missing = `/media/d/${HEX64}`;
  expect(await get(missing)).toBe(404);
  expect(await get(missing)).toBe(404);
  expect(await hits(missing)).toBe(2);

  const present = `/media/d/${'ab'.repeat(32)}`;
  await stack.edge.fault({ match: `^${present}$`, action: 'status', status: 200, times: 1 });
  expect(await get(present)).toBe(200);
  await stack.edge.stop();
  try {
    expect(await get(present)).toBe(200);
  } finally {
    await stack.edge.start();
  }
  expect(await hits(present)).toBe(1);
  const cached = await page.evaluate(async () => (await (await caches.open('fc-derivatives-v1')).keys()).map((r) => new URL(r.url).pathname));
  expect(cached).toEqual([present]);
});

test.describe('(c) build N+1 ships while 2 edits are pending', () => {
  let n: WebContainer;
  let next: WebContainer;
  let buildN: string;
  let buildNext: string;
  test.beforeAll(async () => {
    [n, next] = await Promise.all([runWeb(IMAGE), runWeb(IMAGE_NEXT)]);
    [buildN, buildNext] = await Promise.all([buildServedBy(n.url), buildServedBy(next.url)]);
    expect(buildN).not.toBe(buildNext);
  });
  test.afterAll(() => {
    n?.stop();
    next?.stop();
  });

  let edge: Edge;
  test.beforeEach(async ({ context }) => {
    await context.addInitScript({ content: await bundleOutboxProbe() });
    edge = await openEdge(stackState().coordinator.url, n);
  });
  test.afterEach(async () => {
    await edge.close();
  });

  async function queueTwoEdits(context: BrowserContext): Promise<string[]> {
    // Through the app's own store, before any app page is open: the legacy
    // code's connection to the same database would block the v2 upgrade.
    const side = await context.newPage();
    await side.goto(`${edge.origin}/manifest.webmanifest`);
    const queued = await side.evaluate(
      ([sub, device, ids]) => (window as unknown as { fcOutboxProbe: typeof import('./outboxProbe') }).fcOutboxProbe.queueEdits(sub, device, ids),
      [USER_SUB, DEVICE, heads.slice(0, 2).map((h) => h.headId)] as [string, string, string[]],
    );
    expect(queued).toHaveLength(2);
    await side.close();
    return queued;
  }

  const pendingIn = (page: Page) =>
    page.evaluate(
      (sub) => (window as unknown as { fcOutboxProbe: typeof import('./outboxProbe') }).fcOutboxProbe.pendingEdits(sub),
      USER_SUB,
    );

  async function visit(context: BrowserContext, path = '/'): Promise<Page> {
    const page = await context.newPage();
    await page.goto(`${edge.origin}${path}`);
    await shellInstalled(page);
    expect(await buildOf(page)).toBe(buildN);
    return page;
  }

  async function hardReload(context: BrowserContext, page: Page): Promise<void> {
    const cdp = await context.newCDPSession(page);
    await Promise.all([page.waitForEvent('load'), cdp.send('Page.reload', { ignoreCache: true })]);
    await cdp.detach();
    expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
  }

  /** Ship N+1, wait for the prompt, take it from `from`, and see every tab reach N+1. */
  async function takeUpdate(from: Page, ...others: Page[]): Promise<void> {
    edge.setUpstream('web', next.url);
    await promptForUpdate(from);
    expect(await buildOf(from)).toBe(buildN);
    await from.getByRole('button', { name: 'Reload' }).click();
    for (const [i, tab] of [from, ...others].entries()) {
      await expect.poll(() => buildNow(tab), { timeout: 30_000, message: i === 0 ? 'the tab that took it' : `other tab ${i}` }).toBe(buildNext);
    }
    await expect(from.getByRole('status')).toHaveCount(0);
  }

  // Whether a page had a controller when it registered decides whether the
  // plugin reloads it; the app's own reload must not depend on it.
  test('on a returning visit: the prompt appears and Reload moves the page to N+1', async ({ context }) => {
    const queued = await queueTwoEdits(context);
    await (await visit(context)).close();
    const page = await visit(context);
    expect(await controlledAtLoad(page)).toBe(true);
    await takeUpdate(page);
    expect(await pendingIn(page)).toEqual(queued);
  });

  test('on a first visit: the prompt appears and Reload moves the page to N+1', async ({ context }) => {
    const queued = await queueTwoEdits(context);
    const page = await visit(context);
    expect(await controlledAtLoad(page)).toBe(false);
    await takeUpdate(page);
    expect(await pendingIn(page)).toEqual(queued);
  });

  test('on a hard reload beside a tab still on N: Reload moves both to N+1', async ({ context }) => {
    const queued = await queueTwoEdits(context);
    const page = await visit(context);
    const other = await visit(context, '/discover');
    await hardReload(context, page);
    await takeUpdate(page, other);
    expect(await pendingIn(page)).toEqual(queued);
  });

  test('on a hard reload with no other tab: nothing waits, and the page moves to N+1 by itself', async ({ context }) => {
    // No page is left on N, so N+1 activates at once and claims this one; the
    // old precache is gone, so staying on N's shell is not an option.
    const queued = await queueTwoEdits(context);
    const page = await visit(context);
    await hardReload(context, page);
    edge.setUpstream('web', next.url);
    await expect(async () => {
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      expect(await buildNow(page)).toBe(buildNext);
    }).toPass({ timeout: 30_000 });
    expect(await pendingIn(page)).toEqual(queued);
  });

  test('a second tab with no controller at load follows the tab that took N+1', async ({ context }) => {
    const [a, b] = await Promise.all([context.newPage(), context.newPage()]);
    await Promise.all([a.goto(`${edge.origin}/`), b.goto(`${edge.origin}/discover`)]);
    await Promise.all([shellInstalled(a), shellInstalled(b)]);
    expect([await controlledAtLoad(a), await controlledAtLoad(b)]).toEqual([false, false]);
    // b's copy of build N loses its precache when N+1 activates: it must not stay on N.
    await takeUpdate(a, b);
  });
});

test('(d) the image sends CSP, HSTS, nosniff, Referrer-Policy and the cache policy', async ({ request }) => {
  const web = await runWeb(IMAGE);
  try {
    const nginx = readFileSync(new URL('../../deploy/nginx/default.conf', import.meta.url), 'utf8');
    const csp = /add_header Content-Security-Policy "([^"]+)"/.exec(nginx)?.[1];
    const html = await (await fetch(`${web.url}/`)).text();
    const asset = /\/assets\/index-[\w-]+\.js/.exec(html)?.[0];
    const cases: Array<[string, Record<string, string>, number, string | null]> = [
      ['/', {}, 200, 'no-cache'],
      ['/index.html', {}, 200, 'no-cache'],
      ['/figure/abc', { accept: 'text/html', 'sec-fetch-mode': 'navigate' }, 200, 'no-cache'],
      ['/sw.js', {}, 200, 'no-cache'],
      ['/manifest.webmanifest', {}, 200, 'no-cache'],
      [asset as string, {}, 200, 'public, max-age=31536000, immutable'],
      ['/api/x', {}, 404, null],
      ['/figure/abc', {}, 404, null],
    ];
    for (const [path, headers, status, cache] of cases) {
      const res = await request.get(`${web.url}${path}`, { headers });
      const h = res.headers();
      expect(res.status(), path).toBe(status);
      expect(h['content-security-policy'], path).toBe(csp);
      expect(h['strict-transport-security'], path).toMatch(/^max-age=\d+/);
      expect(h['x-content-type-options'], path).toBe('nosniff');
      expect(h['referrer-policy'], path).toBe('strict-origin-when-cross-origin');
      expect(h['cache-control'] ?? null, path).toBe(cache);
    }
    expect((await request.get(`${web.url}/manifest.webmanifest`)).headers()['content-type']).toBe('application/manifest+json');
  } finally {
    web.stop();
  }
});

test('(d) img-src: same-origin and images.figurecollecting.com images load, a hotlinked original is refused', async ({ context, page, cspViolations }) => {
  const { origin } = stackState();
  const src = {
    self: `${origin}/icons/icon-192.png`,
    derivative: 'https://images.figurecollecting.com/serve/1@2',
    hotlinked: 'https://static.myfigurecollection.net/upload/items/1/12345-abcde.jpg',
  };
  const at = '2026-01-01T00:00:00Z';
  const figures = Object.entries(src).map(([id, imageUrl]) => ({
    _id: id, name: id, manufacturer: 'Maker', imageUrl, collectionStatus: 'owned', userId: 'u1', createdAt: at, updatedAt: at,
  }));
  // Signed in against a legacy-shaped API on this origin (connect-src 'self').
  await context.addInitScript((o) => {
    localStorage.setItem('fc.apiUrl', `${o}/legacy-api`);
    const user = { _id: 'u1', username: 'u', email: 'u@example.com', token: 't', refreshToken: 'r', tokenExpiresAt: Date.now() + 3.6e6 };
    localStorage.setItem('auth-storage', JSON.stringify({ state: { user, isAuthenticated: true, lastActivity: Date.now() }, version: 0 }));
  }, origin);
  await context.route(/\/legacy-api\//, (route) =>
    route.fulfill({ json: /\/figures(\?|$)/.test(route.request().url()) ? { success: true, data: figures, count: 3, page: 1, pages: 1, total: 3 } : { success: true, data: {} } }),
  );
  const png = readFileSync(new URL('../../public/icons/icon-192.png', import.meta.url));
  const fetched: string[] = [];
  await context.route(/^https:\/\/(images\.figurecollecting\.com|static\.myfigurecollection\.net)\//, (route) => {
    fetched.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'image/png', body: png });
  });

  await page.goto(`${origin}/`);
  const loaded = (url: string) =>
    page.locator(`img[src="${url}"]`).first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0);
  await expect.poll(() => loaded(src.self)).toBe(true);
  await expect.poll(() => loaded(src.derivative)).toBe(true);
  expect(await loaded(src.hotlinked)).toBe(false);
  expect(fetched).toContain(src.derivative);
  expect(fetched).not.toContain(src.hotlinked);
  // The only violations are img-src refusing the hotlinked original.
  await expect.poll(() => new Set(cspViolations.map((v) => `${v.directive} ${v.blocked}`))).toEqual(new Set([`img-src ${src.hotlinked}`]));
  await page.close();
  cspViolations.length = 0;
});

test('(e) Chrome finds the app installable and every icon URL resolves', async ({ playwright, request }, testInfo) => {
  const { origin } = stackState();
  // A persistent profile: Chrome never offers install in an incognito-like context.
  const context = await playwright.chromium.launchPersistentContext(testInfo.outputPath('profile'), { channel: 'chromium', args: HANDS_OFF_LAUNCH_ARGS });
  await blockHandsOff(context);
  const violations = await watchCsp(context);
  const page = await context.newPage();
  await page.goto(`${origin}/`);
  await shellInstalled(page);
  const cdp = await context.newCDPSession(page);
  const manifest = await cdp.send('Page.getAppManifest');
  expect(manifest.errors).toEqual([]);
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  expect(installabilityErrors).toEqual([]);

  const parsed = JSON.parse(manifest.data ?? '{}') as { icons: Array<{ src: string; sizes: string }> };
  const linked = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"], link[rel="apple-touch-icon"]'), (l) => ({
      src: new URL(l.href).pathname,
      sizes: l.sizes.value,
    })),
  );
  const icons = [...parsed.icons, { src: '/icons/badge-72.png', sizes: '72x72' }, ...linked];
  expect(icons.length).toBeGreaterThanOrEqual(8);
  for (const icon of icons) {
    const res = await request.get(`${origin}${icon.src}`);
    expect(res.status(), icon.src).toBe(200);
    expect(res.headers()['content-type'], icon.src).toBe('image/png');
    const body = await res.body();
    const [w, h] = icon.sizes.split('x').map(Number);
    expect({ w: body.readUInt32BE(16), h: body.readUInt32BE(20) }, icon.src).toEqual({ w, h });
  }
  await context.close();
  expect(violations).toEqual([]);
});

test('(g) the image runs as uid 101 on a read-only root filesystem', async () => {
  expect(imageUser(IMAGE)).toBe('101');
  const web = await runWeb(IMAGE);
  try {
    expect(exec(web, 'id', '-u').out.trim()).toBe('101');
    for (const target of ['/usr/share/nginx/html/x', '/etc/nginx/conf.d/x', '/x']) {
      const touched = exec(web, 'touch', target);
      expect(touched.code, target).not.toBe(0);
      expect(touched.out, target).toMatch(/Read-only file system/);
    }
    expect((await fetch(`${web.url}/`)).status).toBe(200);
  } finally {
    web.stop();
  }
});

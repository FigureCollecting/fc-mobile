// WK-09 acceptance against the fc-mobile-web image. Signed-out, the app routes
// every screen to sign-in, so "renders" here means the shell boots from the
// service worker and draws that screen; screens on local data arrive in WK-15.
import { readFileSync } from 'node:fs';
import type { BrowserContext, Page } from '@playwright/test';
import { readStackState, stackClient } from '../stack/src/client.js';
import type { StackState } from '../stack/src/stack.js';
import { expect, test, watchCsp } from '../fixtures';
import { bundleOutboxProbe, exec, imageUser, openEdge, requireImage, runWeb } from './web';

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
  await context.addInitScript(() => localStorage.setItem('onboarding_complete', '1'));
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
  const routed = (await stack.edge.log()).slice(logged).filter((e) => e.path === '/api/x');
  expect(routed.map((e) => [e.route, e.status])).toEqual([
    ['coordinator', 401],
    ['coordinator', 401],
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

test('(c) build N+1 ships while 2 edits are pending: the prompt appears and both edits survive the reload', async ({ context }) => {
  const probe = await bundleOutboxProbe();
  await context.addInitScript({ content: probe });
  const [n, next] = await Promise.all([runWeb(IMAGE), runWeb(IMAGE_NEXT)]);
  const edge = await openEdge(stackState().coordinator.url, n);
  try {
    const [buildN, buildNext] = await Promise.all([buildServedBy(n.url), buildServedBy(next.url)]);
    expect(buildN).not.toBe(buildNext);

    let page = await context.newPage();
    await page.goto(`${edge.origin}/`);
    await shellInstalled(page);
    expect(await buildOf(page)).toBe(buildN);
    await page.close();

    // Two edits through the app's own store, in a same-origin page that holds no other connection.
    const side = await context.newPage();
    await side.goto(`${edge.origin}/manifest.webmanifest`);
    const queued = await side.evaluate(
      ([sub, device, ids]) => (window as unknown as { fcOutboxProbe: typeof import('./outboxProbe') }).fcOutboxProbe.queueEdits(sub, device, ids),
      [USER_SUB, DEVICE, heads.slice(0, 2).map((h) => h.headId)] as [string, string, string[]],
    );
    expect(queued).toHaveLength(2);
    await side.close();

    edge.setUpstream('web', next.url);
    page = await context.newPage();
    await page.goto(`${edge.origin}/`);
    await expect(page.getByRole('status')).toContainText(/new version/i, { timeout: 30_000 });
    expect(await buildOf(page)).toBe(buildN);

    await page.getByRole('button', { name: 'Reload' }).click();
    await expect.poll(() => buildOf(page), { timeout: 30_000 }).toBe(buildNext);
    await expect(page.getByRole('status')).toHaveCount(0);

    const pending = await page.evaluate(
      (sub) => (window as unknown as { fcOutboxProbe: typeof import('./outboxProbe') }).fcOutboxProbe.pendingEdits(sub),
      USER_SUB,
    );
    expect(pending).toEqual(queued);
  } finally {
    await edge.close();
    n.stop();
    next.stop();
  }
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

test('(e) Chrome finds the app installable and every icon URL resolves', async ({ playwright, request }, testInfo) => {
  const { origin } = stackState();
  // A persistent profile: Chrome never offers install in an incognito-like context.
  const context = await playwright.chromium.launchPersistentContext(testInfo.outputPath('profile'), { channel: 'chromium' });
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

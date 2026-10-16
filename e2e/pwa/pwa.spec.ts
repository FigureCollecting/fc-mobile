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
import { bundleImageProbe, bundleOutboxProbe, exec, imageUser, openEdge, requireImage, runWeb, type WebContainer } from './web';

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

/**
 * The image signs in through OIDC only: a signed-out visit shows the sign-in-to-sync banner over
 * the collection.
 * Both the banner and the update prompt are role=status, so each is found by its text.
 */
const signInBanner = (page: Page) => page.getByRole('status').filter({ hasText: /sign in to sync your collection/i });
const updatePrompt = (page: Page) => page.getByRole('status').filter({ hasText: /new version/i });

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
    await expect(updatePrompt(page)).toBeVisible({ timeout: 2_000 });
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
  await expect(signInBanner(first)).toBeVisible();
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
      await expect(signInBanner(page), path).toBeVisible();
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

test('(b) derivatives: the one public image address, kept by the worker for an <img> on a CORS 200 only, and served offline', async ({ context, page }) => {
  const { origin } = stackState();
  const MEDIA = 'https://images.figurecollecting.com/d';
  const present = `${MEDIA}/${'ab'.repeat(32)}`;
  const missing = `${MEDIA}/${HEX64}`;
  const fetched = `${MEDIA}/${'ef'.repeat(32)}`;
  const png = readFileSync(new URL('../../public/icons/icon-192.png', import.meta.url));
  const hits: string[] = [];
  let down = false;
  // The media origin, as the edge README's contract says it answers: the bytes, immutable, CORS for the app.
  await context.route(/^https:\/\/images\.figurecollecting\.com\//, (route) => {
    const url = route.request().url();
    hits.push(url);
    if (down) return route.abort('internetdisconnected');
    const headers = { 'access-control-allow-origin': origin, 'cache-control': 'public, max-age=31536000, immutable', vary: 'Origin' };
    if (url === missing) return route.fulfill({ status: 404, headers });
    return route.fulfill({ status: 200, contentType: 'image/png', body: png, headers });
  });
  await page.goto(`${origin}/`);
  await shellInstalled(page);
  const get = (url: string) =>
    page.evaluate((u) => fetch(u, { mode: 'cors', credentials: 'omit' }).then((r) => r.status, (e: Error) => `error ${e.name}`), url);
  // An <img> of the address, as the app draws one: whether it decoded.
  const show = (url: string, cors = true) =>
    page.evaluate(
      async ([src, c]) => {
        const img = document.createElement('img');
        if (c) img.crossOrigin = 'anonymous';
        img.src = src;
        document.body.appendChild(img);
        await img.decode().catch(() => undefined);
        const ok = img.complete && img.naturalWidth > 0;
        img.remove();
        return ok;
      },
      [url, cors] as const,
    );
  const browsed = () => page.evaluate(async () => (await (await caches.open('fc-derivatives-v2')).keys()).map((r) => r.url).sort());
  const owned = () => page.evaluate(async () => (await (await caches.open('fc-owned-media-v1')).keys()).map((r) => r.url).sort());
  /** Each cache the page or the worker keeps that holds this address. */
  const cachesHolding = (url: string) =>
    page.evaluate(async (u) => {
      const out: string[] = [];
      for (const name of await caches.keys()) if ((await (await caches.open(name)).match(u, { ignoreVary: true })) !== undefined) out.push(name);
      return out;
    }, url);
  const count = (url: string) => hits.filter((h) => h === url).length;
  // Each answer the worker gave this page for the address, as Chromium reports it: the address and its Cache-Control.
  const answers: string[] = [];
  page.on('response', (r) => {
    if (r.fromServiceWorker() && r.url().startsWith(`${MEDIA}/`)) answers.push(`${r.url()} ${r.headers()['cache-control']}`);
  });
  const notNoStore = () => answers.filter((a) => !a.endsWith(' no-store'));
  // A document keeps the images it decoded and draws them again without a request, so each offline check
  // runs in a fresh document: a reload in this tab. A Playwright route turns off Chromium's HTTP cache and
  // the tab's memory cache (any route: the hands-off guard's too), so here what answers that check is the
  // worker. In a tab with no route, the memory cache can answer a fresh document's <img> from an earlier
  // document's immutable answer without asking the worker (measured outside this suite), so every answer
  // the worker gives but an opaque one is no-store, as checked below.
  const freshDocument = async () => {
    await page.reload();
    await shellInstalled(page);
  };

  // A 404 is never kept, nor an opaque (no-cors) answer.
  expect(await show(missing)).toBe(false);
  const opaqueFrom = answers.length;
  expect(await show(present, false)).toBe(true);
  // An opaque answer cannot be copied, so the worker passes it as it is, the origin's immutable with it.
  expect(answers.splice(opaqueFrom)).toEqual([`${present} public, max-age=31536000, immutable`]);
  expect(await browsed()).toEqual([]);
  // A CORS 200 an <img> shows is kept. Workbox writes the cache after it answers (waitUntil).
  expect(await show(present)).toBe(true);
  await expect.poll(browsed).toEqual([present]);
  // The page's own fetch of an image goes to the origin and is never kept: only what an <img> shows is.
  expect(await get(fetched)).toBe(200);

  down = true;
  await freshDocument();
  expect(await show(present)).toBe(true);
  expect(await show(missing)).toBe(false);
  expect(await get(fetched)).toBe('error TypeError');
  expect(await browsed()).toEqual([present]);
  // The no-cors <img> and the CORS one; nothing after the origin went down.
  expect(count(present)).toBe(2);

  // The owned figures' images, through the app's own sync (src/media/keptImages.ts): the sync stores them
  // in the owned cache only, and the worker serves them from it first, offline too. A withheld one is
  // deleted from every CacheStorage cache, and the worker refuses it with a network error, online and
  // offline, though an <img> showed it online before it was owned and offline while it was. Every answer the worker gave this
  // page for it was marked no-store. With this context's caches off, the test cannot show what Chromium's
  // HTTP cache or the tab's memory cache would keep: src/sw/__tests__/sw.test.ts and
  // src/media/__tests__/keptImages.test.ts pin each fetch of an image address to cache 'no-store', and
  // sw.test.ts each answer to the page to Cache-Control no-store.
  down = false;
  await context.addInitScript({ content: await bundleImageProbe() });
  await freshDocument();
  type Probe = { syncOwned: (heads: string[], lists: Record<string, { url: string; primary?: boolean }[]>) => Promise<unknown>; kept: (head: string) => Promise<string | null> };
  const sync = (lists: Record<string, { url: string; primary?: boolean }[]>) =>
    page.evaluate((l) => (window as unknown as { fcImageProbe: Probe }).fcImageProbe.syncOwned(Object.keys(l), l), lists);
  const kept = (head: string) => page.evaluate((h) => (window as unknown as { fcImageProbe: Probe }).fcImageProbe.kept(h), head);
  const ownedImage = `${MEDIA}/${'cd'.repeat(32)}`;
  const replacement = `${MEDIA}/${'0d'.repeat(32)}`;
  // Shown once before the figure was owned: the browsed cache holds it too.
  expect(await show(ownedImage)).toBe(true);
  await expect.poll(browsed).toEqual([present, ownedImage].sort());
  expect(await sync({ h1: [{ url: ownedImage, primary: true }] })).toMatchObject({ figures: 1, images: 1, added: 1, failed: 0 });
  expect(await owned()).toEqual([ownedImage]);
  // While it is owned, the <img>'s copy stays in the browsed cache too, until the sync evicts the image.
  expect((await cachesHolding(ownedImage)).sort()).toEqual(['fc-derivatives-v2', 'fc-owned-media-v1']);
  expect(await kept('h1')).toBe(ownedImage);
  // As a sync in a document the worker does not control stores it: the origin's answer, immutable. The
  // worker's answers from the owned cache below are no-store all the same.
  await page.evaluate(async (u) => {
    const cache = await caches.open('fc-owned-media-v1');
    const stored = await cache.match(u, { ignoreVary: true });
    if (stored === undefined) throw new Error(`${u} is not kept`);
    const headers = new Headers(stored.headers);
    headers.set('cache-control', 'public, max-age=31536000, immutable');
    await cache.put(u, new Response(await stored.blob(), { headers }));
  }, ownedImage);
  down = true;
  await freshDocument();
  const before = count(ownedImage);
  expect(await get(ownedImage)).toBe(200);
  expect(await show(ownedImage)).toBe(true);
  expect(count(ownedImage)).toBe(before);
  // Shown from the origin, fetched by the sync, then read and shown from the owned cache: each answer no-store.
  expect(answers.filter((a) => a.startsWith(`${ownedImage} `))).toEqual(Array(4).fill(`${ownedImage} no-store`));

  // Withheld: the fresh list carries another image. The old one leaves both caches and fails offline.
  down = false;
  expect(await sync({ h1: [{ url: replacement, primary: true }] })).toMatchObject({ added: 1, evicted: 1 });
  // The sync's own fetch of the replacement was never kept by the worker.
  expect(await browsed()).toEqual([present]);
  expect(await owned()).toEqual([replacement]);
  expect(await kept('h1')).toBe(replacement);
  expect(await cachesHolding(ownedImage)).toEqual([]);
  // The sync recorded it as withheld: in a fresh document the worker refuses it, online too, though the
  // origin still serves it. No request leaves for it, no cache takes it again, and the next sync finds
  // nothing to evict.
  await freshDocument();
  const asked = count(ownedImage);
  expect(await show(ownedImage)).toBe(false);
  expect(await get(ownedImage)).toBe('error TypeError');
  expect(count(ownedImage)).toBe(asked);
  expect(await cachesHolding(ownedImage)).toEqual([]);
  expect(await sync({ h1: [{ url: replacement, primary: true }] })).toMatchObject({ added: 0, evicted: 0 });
  down = true;
  await freshDocument();
  expect(await show(ownedImage)).toBe(false);
  expect(await get(ownedImage)).toBe('error TypeError');
  expect(await show(replacement)).toBe(true);
  expect(await cachesHolding(ownedImage)).toEqual([]);
  expect(await cachesHolding(replacement)).toEqual(['fc-owned-media-v1']);
  // Every answer but the opaque one, from either cache or the origin, the sync's own fetches too.
  expect(answers.length).toBeGreaterThan(0);
  expect(notNoStore()).toEqual([]);
});

test('(b) another tab: told on a BroadcastChannel when a tab\'s owned sync completes, it drops its image answers, and an open page stops naming the withheld image before its re-ask answers', async ({ context, page }) => {
  const { origin } = stackState();
  const MEDIA = 'https://images.figurecollecting.com/d';
  const withheld = `${MEDIA}/${'cd'.repeat(32)}`;
  const replacement = `${MEDIA}/${'0d'.repeat(32)}`;
  const png = readFileSync(new URL('../../public/icons/icon-192.png', import.meta.url));
  await context.route(/^https:\/\/images\.figurecollecting\.com\//, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: png, headers: { 'access-control-allow-origin': origin, 'cache-control': 'public, max-age=31536000, immutable', vary: 'Origin' } }),
  );
  await context.addInitScript({ content: await bundleImageProbe() });
  type Probe = {
    syncOwned: (heads: string[], lists: Record<string, { url: string; primary?: boolean }[]>) => Promise<unknown>;
    answer: (head: string, url: string) => boolean;
    show: (head: string, url: string) => boolean;
    shown: (head: string) => { url: string | null; asking: boolean };
    caseView: (head: string, url: string) => void;
    caseViewStands: (head: string) => boolean;
    answers: () => number;
    completed: (head: string) => void;
  };
  const call = <K extends keyof Probe>(p: Page, method: K, ...args: Parameters<Probe[K]>): Promise<Awaited<ReturnType<Probe[K]>>> =>
    p.evaluate(([m, a]) => ((window as unknown as { fcImageProbe: Record<string, (...x: unknown[]) => unknown> }).fcImageProbe[m]!(...a)), [method, args] as [string, unknown[]]) as Promise<Awaited<ReturnType<Probe[K]>>>;
  const sync = (url: string) => page.evaluate((u) => (window as unknown as { fcImageProbe: Probe }).fcImageProbe.syncOwned(['h1'], { h1: [{ url: u, primary: true }] }), url);
  await page.goto(`${origin}/`);
  await shellInstalled(page);
  const other = await context.newPage();
  await other.goto(`${origin}/`);
  await shellInstalled(other);
  // The first tab: its case view, and a figure page answer no page shows. The other tab: a figure page
  // open on the figure, and an answer for another figure no page shows. All name the image.
  await call(page, 'caseView', 'h1', withheld);
  expect(await call(page, 'answer', 'h1', withheld)).toBe(true);
  expect(await call(other, 'show', 'h1', withheld)).toBe(true);
  expect(await call(other, 'answer', 'h2', withheld)).toBe(true);
  // The first tab's syncs keep the image, then withhold it; its case view does what the app's does.
  await sync(withheld);
  await sync(replacement);
  await call(page, 'completed', 'h1');
  // The other tab: the open page answers the plate while its re-ask is still unanswered; the answer no page shows is gone.
  await expect.poll(() => call(other, 'shown', 'h1')).toEqual({ url: null, asking: true });
  expect(await call(other, 'answers')).toBe(1);
  // The first tab dropped its own figure page answer and kept its case view's (it never hears its own message).
  await expect.poll(() => call(page, 'answers')).toBe(0);
  expect(await call(page, 'caseViewStands', 'h1')).toBe(true);
  await other.close();
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
    await expect(updatePrompt(from)).toHaveCount(0);
    // The first page to run N+1 here names it; tabs race to be first, so at least one does.
    const named = [from, ...others].map((tab) => tab.getByRole('status').filter({ hasText: `Updated to build ${buildNext}` }));
    await expect.poll(async () => (await Promise.all(named.map((n) => n.count()))).some((c) => c > 0), { message: 'Updated to build N+1' }).toBe(true);
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
    // The hard order, every run: b registers while a's install of N still runs, after N's updatefound,
    // so the plugin in b takes N+1 for b's own and raises b's prompt only from a 200 ms timer; a, the
    // front tab, takes N+1 before that timer runs. N's precache is held until b has registered.
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    await context.route(/\/assets\/[^/?]+\.css(\?|$)/, async (route) => {
      if (route.request().serviceWorker() !== null) await held;
      await route.fallback();
    });
    const a = await context.newPage();
    await a.goto(`${edge.origin}/`);
    await a.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.installing != null);
    const b = await context.newPage();
    await b.addInitScript(() => {
      const register = ServiceWorkerContainer.prototype.register;
      ServiceWorkerContainer.prototype.register = function (...args) {
        const registered = register.apply(this, args);
        (window as unknown as { fcRegistered: Promise<unknown> }).fcRegistered = registered;
        return registered;
      };
    });
    await b.goto(`${edge.origin}/discover`);
    await b.waitForFunction(() => (window as unknown as { fcRegistered?: Promise<unknown> }).fcRegistered !== undefined);
    await b.evaluate(() => (window as unknown as { fcRegistered: Promise<unknown> }).fcRegistered.then(() => undefined));
    expect(await a.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state ?? null)).toBeNull();
    release();
    await Promise.all([shellInstalled(a), shellInstalled(b)]);
    expect([await controlledAtLoad(a), await controlledAtLoad(b)]).toEqual([false, false]);
    await a.bringToFront();
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
    derivative: `https://images.figurecollecting.com/d/${HEX64}`,
    hotlinked: 'https://static.myfigurecollection.net/upload/items/1/12345-abcde.jpg',
  };
  const png = readFileSync(new URL('../../public/icons/icon-192.png', import.meta.url));
  const fetched: string[] = [];
  await context.route(/^https:\/\/(images\.figurecollecting\.com|static\.myfigurecollection\.net)\//, (route) => {
    fetched.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'image/png', body: png });
  });

  // The app shows no image from a figure record any more (WK-15: a derivative only from
  // GetProductImages), so the page asks for the three itself: the shipped CSP decides.
  await page.goto(`${origin}/`);
  await page.evaluate((urls) => {
    for (const url of urls) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      document.body.appendChild(img);
    }
  }, Object.values(src));
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

test('(e) Chrome finds the app installable and every icon URL resolves', async ({ playwright, request }) => {
  const { origin } = stackState();
  // A persistent profile: Chrome never offers install in an incognito-like context. A fresh one ('', which Playwright makes): the harness refuses a profile directory.
  const context = await playwright.chromium.launchPersistentContext('', { channel: 'chromium', args: HANDS_OFF_LAUNCH_ARGS });
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

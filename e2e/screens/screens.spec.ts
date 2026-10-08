// WK-15 acceptance on the local full stack: the screens on the local store. The OIDC build behind
// nginx, the real fc-coordinator through the edge, the fake SpineRead seeded with 1,200 products and
// the mock IdP. User A holds 1,200 seeded copies (the same seed as e2e/sync); user B's copies are
// made here. Chromium at the Fold8 cover and open panels; the sign-off PNGs land in
// test-results/signoff/<project>/<name>.png (e2e/signoffShots.ts).
//   (a) 1,200 holdings: the last tile is reached by scrolling, IndexedDB holds 1,200, no limit=20.
//   (b) offline, a Latin, a JAN and a kana query each answer from the device in under 100 ms.
//   (c) a pending edit turns known after the drain; offline-stale tiles say "as of HH:MM <zone>".
//   (d) user B on the same browser sees none of A's items; A's pending edit stays queued under A.
//   (e) every request of the suite went to the app origin or the IdP; no script loaded at boot or
//       later carries the legacy sign-in (/auth/login, /auth/refresh).
//   (f) importing a fixture CSV shows the counts the server returned.
import { readFileSync } from 'node:fs';
import { expect, test } from '../fixtures';
import type { BrowserContext, Page, TestInfo } from '@playwright/test';
import type { E2eHooks } from '../../src/auth/e2eHooks';
import type { SyncHooks } from '../../src/sync/e2eHooks';
import { SHOT_VIEWPORTS } from '../caseViewports';
import { shotSizeError, signoffShot } from '../signoffShots';
import { loginDevice } from '../stack/src/device.js';
import { readStackState, stackClient, type StackClient } from '../stack/src/client.js';
import type { StackUser } from '../stack/src/issuer.js';
import type { StackState } from '../stack/src/stack.js';

declare global {
  interface Window {
    __fcAuth?: E2eHooks;
    __fcSync?: SyncHooks;
  }
}

interface CatalogHead {
  headId: string;
  name: string;
  gtin14s: string[];
  mfcId?: string;
}

const SEED = 1200;
const SEED_PREFIX = 'occ/5eed0000-';
const seedOcc = (i: number): string => `5eed0000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`;
const PUSH_PATH = '^/api/coordinator\\.v1\\.SyncService/Push$';
const SEARCH_MEASURE = 'fc-local-search';
const LEGACY_AUTH = /\/auth\/(login|refresh)\b/;

let state: StackState;
let stack: StackClient;
let USER_A: StackUser;
let USER_B: StackUser;
let HEADS: CatalogHead[];
let HOME: string;

// (e): what the whole suite asked for, from every context it opened.
const origins = new Map<string, string>();
const scripts = new Map<string, boolean>();

test.describe.configure({ mode: 'serial' });
test.use({ timezoneId: 'America/Chicago' });

/** User A's 1,200 copies, written once per stack by a Node device (the same seed as e2e/sync). */
async function seedHoldings(): Promise<void> {
  const have = await stack.sync.counts({ user: USER_A.sub, prefix: SEED_PREFIX });
  if (have.facets >= SEED * 2) return;
  const device = await loginDevice({
    origin: state.origin,
    authorizationEndpoint: state.issuer.authorizationEndpoint,
    tokenEndpoint: state.issuer.tokenEndpoint,
    clientId: state.issuer.clientId,
    loginHint: USER_A.email,
  });
  expect((await device.enrol('wk15 seed')).status).toBe(201);
  const dev = device.deviceId!.replace(/-/g, '');
  const stamp = { edited_at: '2026-10-01T00:00:00.000+00:00', tz: 'UTC' };
  let counter = 0;
  const version = () => `2026-10-01T00:00:00.000000Z#${String(++counter).padStart(10, '0')}#${dev}`;
  for (let start = 0; start < SEED; start += 100) {
    const events = [];
    for (let i = start; i < start + 100; i++) {
      events.push({ facetKey: `occ/${seedOcc(i)}/head`, version: version(), op: 'SYNC_OP_UPSERT', payload: JSON.stringify({ head_id: HEADS[i]!.headId, ...stamp }), basis: '' });
      events.push({ facetKey: `occ/${seedOcc(i)}/status`, version: version(), op: 'SYNC_OP_UPSERT', payload: JSON.stringify({ status: 'owned', ...stamp }), basis: '' });
    }
    const res = await device.connect('coordinator.v1.SyncService', 'Push', { clientId: `wk15-seed-${dev}-${start}`, events });
    expect(res.status).toBe(200);
  }
}

test.beforeAll(async () => {
  test.setTimeout(180_000);
  const found = readStackState();
  if (found === undefined) throw new Error('no stack state file: run through playwright.stack.config.ts');
  state = found;
  stack = stackClient(state.controlUrl);
  [USER_A, USER_B] = [state.users[0]!, state.users[1]!];
  HEADS = (JSON.parse(readFileSync(state.catalog.file, 'utf8')) as { heads: CatalogHead[] }).heads;
  HOME = `${state.origin}/`;
  await seedHoldings();
});

/** Record every request and every script of a context, for (e). */
function watch(context: BrowserContext): void {
  context.on('request', (req) => {
    const url = new URL(req.url());
    if (url.protocol === 'http:' || url.protocol === 'https:') origins.set(url.origin, req.url());
  });
  context.on('response', (res) => {
    const url = res.url();
    // A script a page ran, not one the service worker precached (it fetches every asset, the
    // legacy screens' lazy chunks included, without running them).
    if (res.request().serviceWorker() !== null || res.request().resourceType() !== 'script') return;
    if (!/\.js(\?|$)/.test(url) || scripts.has(url)) return;
    scripts.set(url, false);
    void res
      .text()
      .then((body) => scripts.set(url, LEGACY_AUTH.test(body)))
      .catch(() => undefined);
  });
}

test.beforeEach(async ({ context }) => {
  watch(context);
  await context.addInitScript(() => localStorage.setItem('onboarding_complete', '1'));
  await stack.edge.clearFaults();
  await stack.issuer.configure({ accessTokenTtlSeconds: 600, offlineAccess: true });
});

test.afterEach(async () => {
  await stack.edge.clearFaults();
  await stack.edge.releaseHung();
  if (!(await stack.health()).edge) await stack.edge.start();
});

// ------------------------------------------------------------------ helpers

const authStatus = (page: Page) => page.evaluate(() => window.__fcAuth?.status() ?? 'loading').catch(() => 'navigating');
const syncState = (page: Page) => page.evaluate(() => window.__fcSync!.state());

async function hooksReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__fcAuth !== undefined && window.__fcSync !== undefined, undefined, { timeout: 30_000 }).catch(() => {
    throw new Error('no window.__fcAuth / __fcSync: the stack must serve dist-stack (npm run build:stack)');
  });
}

async function signInThroughBanner(page: Page, timeout = 30_000): Promise<void> {
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect.poll(() => page.url(), { timeout }).toBe(HOME);
  await hooksReady(page);
  await expect.poll(() => authStatus(page), { timeout }).toBe('signed-in');
}

/** Open the app in `context` signed in as `user`: through the banner and the mock IdP when it is not yet. */
async function openApp(context: BrowserContext, user: StackUser, timeout = 30_000): Promise<Page> {
  await stack.issuer.loginAs(user.sub);
  const page = await context.newPage();
  await page.goto('/', { timeout });
  await hooksReady(page);
  await expect.poll(() => authStatus(page), { timeout }).toMatch(/^(signed-in|signed-out|reauth-required)$/);
  if ((await authStatus(page)) !== 'signed-in') await signInThroughBanner(page, timeout);
  return page;
}

async function settled(page: Page, timeout = 60_000): Promise<void> {
  await expect
    .poll(async () => {
      const s = await syncState(page);
      return s.phase === 'idle' && s.reachability === 'reachable' && s.pending === 0;
    }, { timeout })
    .toBe(true);
}

const seededShown = async (page: Page): Promise<number> =>
  (await page.evaluate(() => window.__fcSync!.copies())).filter((c) => c.occ_id.startsWith('5eed0000-') && c.shown_in !== null).length;

/** Go to a screen inside the app, as a tap on a link would (no reload). */
async function navigate(page: Page, path: string): Promise<void> {
  await page.evaluate((to) => {
    history.pushState(null, '', to);
    dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

/** The full-frame sign-off PNG at this project's panel, its size checked against the panel's pixels. */
async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const panel = SHOT_VIEWPORTS.find((v) => testInfo.project.name.endsWith(v.name.replace(/-full$/, '')))!;
  await page.waitForTimeout(300);
  const png = await signoffShot(page, testInfo, name);
  expect(shotSizeError(png, panel.png), png.path).toBeUndefined();
}

/** Raw IndexedDB, in the page: user `sub`'s seeded copies with a live status, and its product cards. */
function seededInIdb(page: Page, sub: string): Promise<{ copies: number; products: number }> {
  return page.evaluate(async (who) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('fc-mobile');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const ask = <T,>(req: IDBRequest<T>) =>
      new Promise<T>((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    try {
      const rows = await ask(db.transaction('facets').objectStore('facets').getAll(IDBKeyRange.bound([who, 'occ/5eed0000-'], [who, 'occ/5eed0000-\uffff'])));
      const live = (rows as Array<{ facet_key: string; value: { op: string } | null }>).filter((r) => r.facet_key.endsWith('/status') && r.value?.op === 'upsert');
      const products = await ask(db.transaction('products').objectStore('products').count(IDBKeyRange.bound([who], [who, []])));
      return { copies: live.length, products };
    } finally {
      db.close();
    }
  }, sub);
}

/**
 * Raw IndexedDB, in the page: the facet keys of user `sub`'s unanswered edits. A failed Push leaves
 * an edit PENDING or, once frozen into a batch, IN_FLIGHT (retried as sent): queued either way.
 */
function pendingInIdb(page: Page, sub: string): Promise<string[]> {
  return page.evaluate(async (who) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('fc-mobile');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      const req = db.transaction('outbox').objectStore('outbox').index('by_sub').getAll(IDBKeyRange.bound([who], [who, Infinity]));
      const rows = await new Promise<Array<{ facet_key: string; state: string }>>((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return rows.filter((e) => e.state === 'PENDING' || e.state === 'IN_FLIGHT').map((e) => e.facet_key);
    } finally {
      db.close();
    }
  }, sub);
}

// ------------------------------------------------------------------ (a)

test('(a) with 1,200 holdings the last tile is reached by scrolling, IndexedDB holds 1,200, and no request carries limit=20', async ({ context }, testInfo) => {
  test.setTimeout(240_000);
  const sent: string[] = [];
  context.on('request', (req) => sent.push(`${req.url()} ${req.postData() ?? ''}`));
  const page = await openApp(context, USER_A);
  await expect.poll(() => seededShown(page), { timeout: 120_000 }).toBe(SEED);
  await settled(page, 120_000);
  const inIdb = await seededInIdb(page, USER_A.sub);
  expect(inIdb.copies).toBe(SEED);
  expect(inIdb.products).toBeGreaterThanOrEqual(SEED);
  testInfo.annotations.push({ type: 'indexeddb', description: JSON.stringify(inIdb) });

  await navigate(page, '/?layout=rows');
  const header = page.locator('.slim-header__context');
  await expect(header).toHaveText(/^Collection \(\d+\)$/, { timeout: 30_000 });
  const total = Number((await header.innerText()).match(/\((\d+)\)/)![1]);
  expect(total).toBeGreaterThanOrEqual(SEED);
  await expect(page.getByRole('tab', { name: `Owned (${total})` })).toHaveAttribute('aria-selected', 'true');
  await shot(page, testInfo, 'collection-rows');

  // Scroll the page's scroller to its end until the virtualizer has drawn the last tile.
  const last = page.locator(`.jrows__item[data-index="${total - 1}"]`);
  await expect
    .poll(
      async () => {
        await page.locator('.app-content').evaluate((el) => el.scrollTo(0, el.scrollHeight));
        return last.count();
      },
      { timeout: 30_000 },
    )
    .toBe(1);
  await expect(last).toBeInViewport();
  await shot(page, testInfo, 'collection-rows-end');

  await navigate(page, '/?layout=case');
  await expect(page.locator('button.shelf-figure').first()).toBeVisible({ timeout: 30_000 });
  await shot(page, testInfo, 'collection-case');

  const limit20 = sent.filter((s) => /[?&]limit=20\b|"limit"\s*:\s*20\b/.test(s));
  expect(limit20).toEqual([]);
});

// ------------------------------------------------------------------ (b)

test('(b) offline, a Latin query, a JAN and a kana query each answer from the device in under 100 ms', async ({ context }, testInfo) => {
  test.setTimeout(180_000);
  const page = await openApp(context, USER_A);
  await expect.poll(() => seededShown(page), { timeout: 120_000 }).toBe(SEED);
  await settled(page, 120_000);
  await navigate(page, '/discover');
  await expect(page.getByPlaceholder('Search your figures...')).toBeVisible();
  await context.setOffline(true);

  const latin = HEADS.find((h, i) => i % 3 !== 1 && /^[\x20-\x7e]+$/.test(h.name) && h.gtin14s.length > 0)!;
  const jan = HEADS.find((h) => h.gtin14s.length > 0 && h.headId !== latin.headId)!;
  const kana = HEADS.find((h) => /スケールフィギュア/.test(h.name) && h.headId !== jan.headId)!;
  const queries = [
    { label: 'latin', q: latin.name.split(' ').slice(0, 2).join(' '), expect: latin.name },
    { label: 'jan', q: jan.gtin14s[0]!.slice(1), expect: jan.name },
    { label: 'kana', q: 'スケールフィギュア', expect: kana.name },
  ];
  const timings: Record<string, number> = {};
  for (const { label, q, expect: name } of queries) {
    await page.evaluate(() => performance.clearMeasures('fc-local-search'));
    await page.getByPlaceholder('Search your figures...').fill(q);
    // This query's own search has run (its measure is there), and its hits are shown.
    const measures = () => page.evaluate((m) => performance.getEntriesByName(m, 'measure').map((e) => e.duration), SEARCH_MEASURE);
    await expect.poll(async () => (await measures()).length, { timeout: 15_000, message: `${label}: a performance measure` }).toBeGreaterThan(0);
    const results = page.getByRole('list', { name: 'Search results' });
    await expect(results.getByRole('button', { name, exact: true }).first()).toBeVisible({ timeout: 15_000 });
    const measured = await measures();
    timings[label] = Math.max(...measured);
    expect(timings[label], `${label} query "${q}"`).toBeLessThan(100);
    if (label === 'kana') await shot(page, testInfo, 'search-offline');
  }
  testInfo.annotations.push({ type: 'search-ms', description: JSON.stringify(timings) });
  await context.setOffline(false);
});

// ------------------------------------------------------------------ (c)

test("(c) a pending edit turns known after the drain, and offline-stale tiles show their as-of with a zone", async ({ context }, testInfo) => {
  test.setTimeout(180_000);
  const page = await openApp(context, USER_B);
  await settled(page);
  // Two figures with a barcode and a name no other figure has (names repeat in the catalog).
  const unique = HEADS.filter((h) => h.gtin14s.length > 0 && HEADS.filter((o) => o.name === h.name).length === 1);
  const offset = Date.now() % Math.max(1, unique.length - 400);
  const [first, second] = [unique[offset]!, unique[offset + 200]!];

  // A tile by its figure: its sync badge is named for the head and the tab.
  const tile = (name: string) => page.locator(`.jrows__item[aria-describedby="sync-${HEADS.find((h) => h.name === name)!.headId}-wished"]`);
  const lookUp = async (head: CatalogHead) => {
    await navigate(page, '/discover');
    await page.getByLabel('Barcode', { exact: true }).fill(head.gtin14s[0]!.slice(1));
    await page.getByRole('button', { name: 'Look up' }).click();
    const hit = page.getByRole('region', { name: 'Barcode result' });
    await expect(hit.getByText(head.name)).toBeVisible({ timeout: 15_000 });
    return hit;
  };

  // A settled item, added through the barcode lookup (Compare, online): it turns known.
  await (await lookUp(first)).getByRole('button', { name: 'Add to Wished' }).click();
  await navigate(page, '/?layout=rows&tab=wished');
  await expect(tile(first.name)).toHaveAttribute('data-sync', 'known', { timeout: 20_000 });

  // A second one looked up online, then added offline: it waits.
  const hit = await lookUp(second);
  await context.setOffline(true);
  await hit.getByRole('button', { name: 'Add to Wished' }).click();
  await navigate(page, '/?layout=rows&tab=wished');
  await expect(tile(second.name)).toHaveAttribute('data-sync', 'pending', { timeout: 15_000 });
  await expect(tile(second.name).getByText('Pending')).toBeVisible();
  await expect(tile(first.name)).toHaveAttribute('data-sync', 'offline-stale', { timeout: 15_000 });
  const asOf = (await tile(first.name).locator('.sync-badge').innerText()).trim();
  expect(asOf).toMatch(/^as of (\w{3} \d{1,2}, )?\d{2}:\d{2} (CDT|CST)$/);
  testInfo.annotations.push({ type: 'as-of', description: asOf });
  await expect(page.getByText(/^Last synced/)).toBeVisible();
  await shot(page, testInfo, 'collection-offline-pending');

  await context.setOffline(false);
  await expect(tile(second.name)).toHaveAttribute('data-sync', 'known', { timeout: 20_000 });
  await expect(tile(first.name)).toHaveAttribute('data-sync', 'known');

  // The detail of the new figure: its card facts and the placeholder plate, no image.
  await tile(second.name).click();
  await page.getByRole('button', { name: 'Copies and actions' }).click();
  // The full-screen viewer took itself down before the detail opened.
  await expect(page.locator('.pswp')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(second.name);
  await expect(page.locator('.figure-detail__plate')).toBeVisible();
  await expect(page.locator('.figure-detail img')).toHaveCount(0);
  await shot(page, testInfo, 'detail');
  const copies = page.getByRole('list', { name: 'Your copies' });
  await expect(copies.getByRole('listitem')).toHaveCount(1);
  await copies.scrollIntoViewIfNeeded();
  await shot(page, testInfo, 'detail-copies');
});

// ------------------------------------------------------------------ (d)

test("(d) user B signing in on the same browser sees none of A's items, and A's pending edit stays queued under A", async ({ context }, testInfo) => {
  test.setTimeout(180_000);
  const page = await openApp(context, USER_A);
  await settled(page, 120_000);
  // Push is refused at the edge: A's edit stays in A's outbox.
  await stack.edge.fault({ match: PUSH_PATH, action: 'status', status: 503, times: 0 });
  const note = `A only ${Date.now()}`;
  await page.evaluate(([h, n]) => window.__fcSync!.writeNote(h!, n!), [HEADS[0]!.headId, note]);
  await expect.poll(async () => (await syncState(page)).pending).toBeGreaterThanOrEqual(1);
  const queuedBefore = await pendingInIdb(page, USER_A.sub);
  expect(queuedBefore).toContain(`uf/${HEADS[0]!.headId}/note`);

  await navigate(page, '/profile');
  await page.getByRole('button', { name: /sign out/i }).first().click();
  await page.locator('.sign-out-confirm').getByRole('button', { name: /^sign out$/i }).click();
  await expect.poll(() => page.url(), { timeout: 30_000 }).toBe(HOME);
  await hooksReady(page);
  await expect.poll(() => authStatus(page), { timeout: 30_000 }).toBe('signed-out');

  await stack.issuer.loginAs(USER_B.sub);
  await signInThroughBanner(page);
  await expect.poll(async () => (await syncState(page)).phase, { timeout: 30_000 }).toBe('idle');
  const bCopies = await page.evaluate(() => window.__fcSync!.copies());
  expect(bCopies.filter((c) => c.occ_id.startsWith('5eed0000-'))).toEqual([]);
  await navigate(page, '/?layout=rows');
  const header = page.locator('.slim-header__context');
  await expect(header).toHaveText(/^Collection \(\d+\)$/, { timeout: 30_000 });
  const bOwned = new Set(bCopies.filter((c) => c.status === 'owned' && c.shown_in !== null).map((c) => c.head_id)).size;
  expect(Number((await header.innerText()).match(/\((\d+)\)/)![1])).toBe(bOwned);
  expect(bOwned).toBeLessThan(SEED);
  await expect(page.getByText(note)).toHaveCount(0);

  // A's edit is still there, queued under A, untouched by B's session.
  expect(await pendingInIdb(page, USER_A.sub)).toEqual(queuedBefore);
  expect(await pendingInIdb(page, USER_B.sub)).toEqual([]);
  await shot(page, testInfo, 'collection-user-b');
  await stack.edge.clearFaults();
});

// ------------------------------------------------------------------ (f)

test('(f) importing a fixture CSV shows the counts the server returned', async ({ context }, testInfo) => {
  test.setTimeout(180_000);
  const page = await openApp(context, USER_A);
  await settled(page, 120_000);
  // Two rows A already holds as MFC says, one MFC says A wishes for while A owns it, one unknown id.
  const rows = [...[HEADS[10]!, HEADS[11]!].map((h) => `${h.mfcId},Owned,1`), `${HEADS[12]!.mfcId},Wished,1`];
  const csv = ['ID,Status,Count', ...rows, '999999999,Owned,1', ''].join('\n');
  await navigate(page, '/import');
  await page.getByLabel('MFC export (CSV)').setInputFiles({ name: 'mfc-export.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByLabel('Export date').fill('2026-10-05');
  const answered = page.waitForResponse((r) => r.url().endsWith('/coordinator.v1.ImportService/ImportMfcExport'));
  await page.getByRole('button', { name: 'Import' }).click();
  const res = await answered;
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { resolved?: number; added?: number; unresolved?: unknown[]; importNumber?: number; conflictsPending?: number };
  const result = page.getByRole('region', { name: 'Import result' });
  await expect(result).toBeVisible({ timeout: 30_000 });
  const count = (label: string) => result.locator('.page-import__count', { has: page.getByText(label, { exact: true }) }).locator('dd');
  await expect(count('Rows found')).toHaveText(String(body.resolved ?? 0));
  await expect(count('Not found')).toHaveText(String(body.unresolved?.length ?? 0));
  expect(body.resolved).toBe(3);
  expect(body.unresolved).toHaveLength(1);
  if ((body.added ?? 0) > 0) await expect(count('New figures')).toHaveText(String(body.added));
  await expect(result.getByText(`Import ${body.importNumber} done`)).toBeVisible();
  testInfo.annotations.push({ type: 'import-response', description: JSON.stringify(body) });
  await shot(page, testInfo, 'import-result');

  // The conflict review (GR-Q1): 'keep app' is a res/mfc write that syncs like any edit.
  const conflicts = body.conflictsPending ?? 0;
  testInfo.annotations.push({ type: 'conflicts-pending', description: String(conflicts) });
  if (conflicts === 0) return;
  await expect(count('Conflicts to review')).toHaveText(String(conflicts));
  await result.getByRole('button', { name: `Review ${conflicts} ${conflicts === 1 ? 'conflict' : 'conflicts'}` }).click();
  const list = page.getByRole('list', { name: 'Conflicts' });
  await expect(list).toBeVisible({ timeout: 15_000 });
  const item = list.getByRole('listitem').filter({ hasText: HEADS[12]!.name }).first();
  await expect(item).toContainText('App: ');
  await expect(item).toContainText('MFC: ');
  await expect(item).toContainText('export of Oct 5, 2026');
  await shot(page, testInfo, 'review');
  const chose = item.getByText(/^You chose: keep app/);
  if ((await chose.count()) === 0) await item.getByRole('button', { name: 'Keep app' }).click();
  await expect(chose).toBeVisible();
  await settled(page);
  const facet = await page.evaluate((h) => window.__fcSync!.facet(`res/mfc/${h}`), HEADS[12]!.headId);
  expect(facet?.pending_id ?? null).toBeNull();
  expect(JSON.parse(facet!.value!.payload)).toMatchObject({ item: 'figure', choice: 'keep' });
});

// ------------------------------------------------------------------ (e)

test('(e) the whole suite reached only the app origin and the IdP, and loaded no legacy sign-in', async () => {
  const allowed = new Set([state.origin, new URL(state.issuer.authorizationEndpoint).origin]);
  const seen = [...origins.keys()].sort();
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.filter((o) => !allowed.has(o))).toEqual([]);
  expect([...scripts.keys()].length).toBeGreaterThan(0);
  expect([...scripts].filter(([, legacy]) => legacy).map(([url]) => url)).toEqual([]);
  test.info().annotations.push({ type: 'origins', description: seen.join(' ') });
});

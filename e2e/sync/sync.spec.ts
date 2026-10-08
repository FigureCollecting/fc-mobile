// WK-13 acceptance on the local full stack: the OIDC build behind nginx, the real fc-coordinator
// (sync.proto rule 7: commit_cursor on Delta, basis on Push) through the edge, the fake SpineRead
// seeded with 1,200 products and the fake OpenFGA. User A holds 1,200 seeded copies; the edit
// scenarios run as user B on copies each test makes, so they never disturb A's 1,200.
// Screens on the local store are WK-15: here the collection is read through window.__fcSync,
// and what the user sees of sync is the status line.
import { readFileSync } from 'node:fs';
import { expect, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { guardedTest as test } from '../fixtures';
import { blockHandsOff } from '../handsOff';
import type { E2eHooks } from '../../src/auth/e2eHooks';
import type { SyncHooks } from '../../src/sync/e2eHooks';
import { loginDevice } from '../stack/src/device.js';
import { readStackState, stackClient, type StackClient } from '../stack/src/client.js';
import type { StackUser } from '../stack/src/issuer.js';
import type { StackState } from '../stack/src/stack.js';

declare global {
  interface Window {
    __fcAuth?: E2eHooks;
    __fcSync?: SyncHooks;
    SyncManager?: unknown;
  }
}

const SEED = 1200;
const SEED_PREFIX = 'occ/5eed0000-';
const seedOcc = (i: number): string => `5eed0000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`;
const PUSH_PATH = '/api/coordinator.v1.SyncService/Push';
const DELTA_PATH = '/api/coordinator.v1.SyncService/Delta';

let state: StackState;
let stack: StackClient;
let USER_A: StackUser;
let USER_B: StackUser;
let HEADS: string[];
let HOME: string;

test.describe.configure({ mode: 'serial' });

// ------------------------------------------------------------------ seeding

/** User A's 1,200 copies, written once per stack by a Node device in Push batches of 200 events. */
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
  expect((await device.enrol('wk13 seed')).status).toBe(201);
  const dev = device.deviceId!.replace(/-/g, '');
  const stamp = { edited_at: '2026-10-01T00:00:00.000+00:00', tz: 'UTC' };
  let counter = 0;
  const version = () => `2026-10-01T00:00:00.000000Z#${String(++counter).padStart(10, '0')}#${dev}`;
  for (let start = 0; start < SEED; start += 100) {
    const events = [];
    for (let i = start; i < start + 100; i++) {
      events.push({ facetKey: `occ/${seedOcc(i)}/head`, version: version(), op: 'SYNC_OP_UPSERT', payload: JSON.stringify({ head_id: HEADS[i], ...stamp }), basis: '' });
      events.push({ facetKey: `occ/${seedOcc(i)}/status`, version: version(), op: 'SYNC_OP_UPSERT', payload: JSON.stringify({ status: 'owned', ...stamp }), basis: '' });
    }
    const res = await device.connect('coordinator.v1.SyncService', 'Push', { clientId: `wk13-seed-${dev}-${start}`, events });
    expect(res.status).toBe(200);
    const outcomes = (res.body as { results: Array<{ outcome: string }> }).results.map((r) => r.outcome);
    expect(new Set(outcomes)).toEqual(new Set(['PUSH_OUTCOME_APPLIED']));
  }
}

test.beforeAll(async () => {
  test.setTimeout(180_000);
  const found = readStackState();
  if (found === undefined) throw new Error('no stack state file: run through playwright.stack.config.ts');
  state = found;
  stack = stackClient(state.controlUrl);
  [USER_A, USER_B] = [state.users[0]!, state.users[1]!];
  HEADS = (JSON.parse(readFileSync(state.catalog.file, 'utf8')) as { heads: Array<{ headId: string }> }).heads.map((h) => h.headId);
  HOME = `${state.origin}/`;
  await seedHoldings();
});

test.beforeEach(async ({ context }) => {
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

/** Another device of the user: a context of its own, on this project's screen. */
async function newDevice(browser: Browser, testInfo: TestInfo, init?: (context: BrowserContext) => Promise<void>): Promise<BrowserContext> {
  const use = testInfo.project.use;
  const context = await browser.newContext({
    baseURL: state.origin,
    ...(use.viewport ? { viewport: use.viewport } : {}),
    ...(use.deviceScaleFactor === undefined ? {} : { deviceScaleFactor: use.deviceScaleFactor }),
    ...(use.isMobile === undefined ? {} : { isMobile: use.isMobile }),
    ...(use.hasTouch === undefined ? {} : { hasTouch: use.hasTouch }),
  });
  await blockHandsOff(context);
  await context.addInitScript(() => localStorage.setItem('onboarding_complete', '1'));
  if (init !== undefined) await init(context);
  return context;
}

const authStatus = (page: Page) => page.evaluate(() => window.__fcAuth!.status());
const syncState = (page: Page) => page.evaluate(() => window.__fcSync!.state());
const counts = (page: Page) => page.evaluate(() => window.__fcSync!.counts());
const syncNow = (page: Page) => page.evaluate(() => window.__fcSync!.syncNow());

async function hooksReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__fcAuth !== undefined && window.__fcSync !== undefined, undefined, { timeout: 30_000 }).catch(() => {
    throw new Error('no window.__fcAuth / __fcSync: the stack must serve dist-stack (npm run build:stack)');
  });
}

/** Open the app in `context` signed in as `user`: through the banner and the mock IdP when it is not yet. */
async function openApp(context: BrowserContext, user: StackUser, timeout = 30_000): Promise<Page> {
  await stack.issuer.loginAs(user.sub);
  const page = await context.newPage();
  await page.goto('/', { timeout });
  await hooksReady(page);
  await expect.poll(() => authStatus(page), { timeout }).not.toBe('loading');
  if ((await authStatus(page)) !== 'signed-in') {
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect.poll(() => page.url(), { timeout }).toBe(HOME);
    await hooksReady(page);
    await expect.poll(() => authStatus(page), { timeout }).toBe('signed-in');
  }
  return page;
}

/** Wait until a pass has finished with nothing waiting and the server reached. */
async function settled(page: Page, timeout = 30_000): Promise<void> {
  await expect
    .poll(async () => {
      const s = await syncState(page);
      return s.phase === 'idle' && s.reachability === 'reachable' && s.pending === 0;
    }, { timeout })
    .toBe(true);
}

const seededShown = async (page: Page): Promise<number> =>
  (await page.evaluate(() => window.__fcSync!.copies())).filter((c) => c.occ_id.startsWith('5eed0000-') && c.shown_in !== null).length;

const statusLine = (page: Page) => page.locator('.sync-status-line');

/** Wait until the page's service worker controls it, reloading once if the first load was not controlled. */
async function controlled(page: Page): Promise<boolean> {
  const supported = await page.evaluate(() => 'serviceWorker' in navigator);
  if (!supported) return false;
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  if (!(await page.evaluate(() => navigator.serviceWorker.controller !== null))) {
    await page.reload();
    await hooksReady(page);
  }
  return page.evaluate(() => navigator.serviceWorker.controller !== null);
}

/** Make `n` copies of fresh figures as user B, synced, and return their occ ids and heads. */
async function freshCopies(page: Page, n: number, offset: number): Promise<Array<{ occ: string; head: string }>> {
  const out: Array<{ occ: string; head: string }> = [];
  for (let i = 0; i < n; i++) {
    const head = HEADS[(offset + i) % HEADS.length]!;
    out.push({ occ: await page.evaluate(([h]) => window.__fcSync!.createCopy(h!, 'ordered'), [head]), head });
  }
  await syncNow(page);
  await settled(page);
  return out;
}

let offsetSeq = 0;
/** A different slice of the catalog for each scenario run, so runs never edit the same figures. */
const nextOffset = (): number => (Date.now() % 1000) * 7 + (offsetSeq += 13);

// ------------------------------------------------------------------ (1) hydrate

test('(1) a cold start hydrates all 1,200 holdings and their products', async ({ context }) => {
  test.setTimeout(180_000);
  const from = await stack.edge.cursor();
  const page = await openApp(context, USER_A);
  await expect.poll(() => seededShown(page), { timeout: 120_000 }).toBe(SEED);
  await expect.poll(async () => (await counts(page)).products, { timeout: 120_000 }).toBeGreaterThanOrEqual(SEED);
  await settled(page);
  const deltas = (await stack.edge.log(from)).filter((e) => e.path === DELTA_PATH && e.status === 200);
  // 2,400 seeded events at 500 a page: at least five pages, walked until has_more is false.
  expect(deltas.length).toBeGreaterThanOrEqual(5);
  expect((await counts(page)).cursor).not.toBe('');
});

// ------------------------------------------------------------------ (2) offline reload

test('(2) offline, by setOffline and by killing the servers, a reload still renders the app with the collection and a deep link', async ({ context, browserName }) => {
  test.setTimeout(240_000);
  const page = await openApp(context, USER_A);
  await expect.poll(() => seededShown(page), { timeout: 120_000 }).toBe(SEED);
  await expect.poll(async () => (await counts(page)).products, { timeout: 120_000 }).toBeGreaterThanOrEqual(SEED);
  const sw = await controlled(page);
  test.skip(!sw, `${browserName}: no service worker controls the page here, so an offline reload cannot be served`);
  const deepLink = `/figure/${HEADS[0]}`;

  const offlineChecks = async () => {
    await page.reload();
    await hooksReady(page);
    await expect(page.locator('#app')).not.toBeEmpty();
    await expect.poll(() => seededShown(page), { timeout: 30_000 }).toBe(SEED);
    expect((await counts(page)).products).toBeGreaterThanOrEqual(SEED);
    await page.evaluate(() => window.__fcSync!.syncNow());
    await expect(statusLine(page)).toContainText("Can't reach server", { timeout: 15_000 });
    await page.goto(deepLink);
    await hooksReady(page);
    expect(new URL(page.url()).pathname).toBe(deepLink);
    await expect(page.locator('#app')).not.toBeEmpty();
    await page.goto('/');
    await hooksReady(page);
  };

  await context.setOffline(true);
  await offlineChecks();
  await context.setOffline(false);

  await stack.edge.stop(); // a true outage: every request to the origin is refused
  await offlineChecks();
  await stack.edge.start();
});

// ------------------------------------------------------------------ (3) and (8): offline edits

interface EditRun {
  pendingOffline: number;
  pendingAfterReload: number;
  lineAfterReload: string;
  appliedWithinMs: number;
  states: string[];
  secondDevice: { statuses: string[]; note: string | undefined };
}

/** Change the status of 3 items and a note on 1 offline, reload offline, reconnect, and read it on a second device. */
async function offlineEdits(context: BrowserContext, browser: Browser, testInfo: TestInfo): Promise<EditRun> {
  const page = await openApp(context, USER_B);
  await settled(page);
  test.skip(!(await controlled(page)), `${testInfo.project.name}: no service worker controls the page, so an offline reload cannot be served`);
  const copies = await freshCopies(page, 3, nextOffset());
  await context.setOffline(true);
  for (const c of copies) await page.evaluate(([occ]) => window.__fcSync!.setStatus(occ!, 'owned'), [c.occ]);
  const note = `offline note ${Date.now()}`;
  await page.evaluate(([h, n]) => window.__fcSync!.writeNote(h!, n!), [copies[0]!.head, note]);
  await expect.poll(async () => (await syncState(page)).pending).toBe(4);
  const pendingOffline = (await syncState(page)).pending;

  await page.reload();
  await hooksReady(page);
  await expect.poll(async () => (await syncState(page)).pending, { timeout: 15_000 }).toBe(4);
  await expect(statusLine(page)).toContainText('4 changes waiting to sync', { timeout: 15_000 });
  const lineAfterReload = (await statusLine(page).innerText()).trim();

  const back = Date.now();
  await context.setOffline(false);
  await expect
    .poll(async () => (await page.evaluate(() => window.__fcSync!.outbox())).filter((e) => e.state !== 'APPLIED').length, { timeout: 10_000 })
    .toBe(0);
  const appliedWithinMs = Date.now() - back;
  const states = [...new Set((await page.evaluate(() => window.__fcSync!.outbox())).map((e) => e.state))];

  const other = await newDevice(browser, testInfo);
  const second = await openApp(other, USER_B);
  await settled(second);
  const seen = await second.evaluate(() => window.__fcSync!.copies());
  const statuses = copies.map((c) => seen.find((s) => s.occ_id === c.occ)?.status ?? 'missing');
  const facet = await second.evaluate(([h]) => window.__fcSync!.facet(`uf/${h}/note`), [copies[0]!.head]);
  const secondNote = facet?.value === null || facet?.value === undefined ? undefined : (JSON.parse(facet.value.payload) as { note: string }).note;
  await other.close();
  return {
    pendingOffline,
    pendingAfterReload: 4,
    lineAfterReload,
    appliedWithinMs,
    states,
    secondDevice: { statuses, note: secondNote === note ? 'the note' : secondNote },
  };
}

const EXPECTED_RUN = {
  pendingOffline: 4,
  pendingAfterReload: 4,
  states: ['APPLIED'],
  secondDevice: { statuses: ['owned', 'owned', 'owned'], note: 'the note' },
};

test('(3) offline: 3 status changes and a note are 4 pending, still 4 and shown after an offline reload, all APPLIED within 10 s of reconnecting, and seen by a second device', async ({ context, browser }, testInfo) => {
  test.setTimeout(180_000);
  const run = await offlineEdits(context, browser, testInfo);
  expect(run).toMatchObject(EXPECTED_RUN);
  expect(run.lineAfterReload).toContain('4 changes waiting to sync');
  expect(run.appliedWithinMs).toBeLessThan(10_000);
});

test('(8) with window.SyncManager deleted (the iOS path), every result of (3) is the same', async ({ context, browser }, testInfo) => {
  test.setTimeout(180_000);
  await context.addInitScript(() => {
    delete window.SyncManager;
  });
  const run = await offlineEdits(context, browser, testInfo);
  expect(await context.pages()[0]!.evaluate(() => 'SyncManager' in window)).toBe(false);
  expect(run).toMatchObject(EXPECTED_RUN);
  expect(run.lineAfterReload).toContain('4 changes waiting to sync');
  expect(run.appliedWithinMs).toBeLessThan(10_000);
});

// ------------------------------------------------------------------ (4) captive Wi-Fi

test("(4) captive Wi-Fi: /api hangs while onLine stays true; edits queue, no error toast, the status reads 'can't reach server', and releasing drains", async ({ context }) => {
  test.setTimeout(120_000);
  const page = await openApp(context, USER_B);
  await settled(page);
  const [copy] = await freshCopies(page, 1, nextOffset());
  const held: Array<() => Promise<void>> = [];
  let captive = true;
  await page.route('**/api/**', async (route) => {
    if (!captive) return route.continue();
    // Never answered while captive: the request just hangs, as behind a captive portal.
    held.push(() => route.continue().catch(() => undefined));
  });
  await page.evaluate(([occ]) => window.__fcSync!.setStatus(occ!, 'owned'), [copy!.occ]);
  await page.evaluate(([h]) => window.__fcSync!.writeNote(h!, 'captive'), [copy!.head]);
  await expect(statusLine(page)).toContainText("Can't reach server", { timeout: 20_000 });
  expect(await page.evaluate(() => navigator.onLine)).toBe(true);
  expect((await syncState(page)).pending).toBe(2);
  await expect(page.locator('.toast-item')).toHaveCount(0);
  expect(held.length).toBeGreaterThan(0);

  captive = false;
  for (const release of held.splice(0)) await release();
  await expect
    .poll(async () => (await page.evaluate(() => window.__fcSync!.outbox())).filter((e) => e.state !== 'APPLIED').length, { timeout: 60_000 })
    .toBe(0);
  await expect(statusLine(page)).toHaveCount(0);
});

// ------------------------------------------------------------------ (5) dropped response

test('(5) a Push whose reply is dropped is retried with the same client_id and answered DUPLICATE: one receipt, feed unchanged', async ({ context }) => {
  test.setTimeout(120_000);
  const page = await openApp(context, USER_B);
  await settled(page);
  const [copy] = await freshCopies(page, 1, nextOffset());
  const before = await stack.sync.counts({ user: USER_B.sub });
  // The edge forwards the next Push, lets the coordinator commit it, and cuts the reply.
  await stack.edge.fault({ match: `^${PUSH_PATH.replace(/\./g, '\\.')}$`, action: 'drop-response', times: 1 });
  const from = await stack.edge.cursor();
  await page.evaluate(([h]) => window.__fcSync!.writeNote(h!, 'dropped once'), [copy!.head]);
  const mine = async () => (await page.evaluate(() => window.__fcSync!.outbox())).find((e) => e.facet_key === `uf/${copy!.head}/note`)!;
  await expect.poll(async () => (await mine()).state, { timeout: 60_000 }).toBe('APPLIED');
  const pushes = (await stack.edge.log(from)).filter((e) => e.path === PUSH_PATH);
  expect(pushes.map((e) => e.fault ?? e.status)).toEqual(['drop-response', 200]);
  const answered = await mine();
  // DUPLICATE answers only a replay of a recorded client_id with the same events.
  expect(answered).toMatchObject({ state: 'APPLIED', outcome: 'DUPLICATE', client_id: expect.any(String) });
  const after = await stack.sync.counts({ user: USER_B.sub, clientId: answered.client_id! });
  expect(after.receipts).toBe(1);
  expect((await stack.sync.counts({ user: USER_B.sub })).receipts).toBe(before.receipts + 1);
  // The first attempt wrote the one event; the retry wrote nothing.
  expect(after.feedEvents).toBe(before.feedEvents + 1);
});

// ------------------------------------------------------------------ (6) two devices, both orders

for (const order of ['first device first', 'second device first'] as const) {
  test(`(6) two devices edit the same facet offline and reconnect, ${order}: both end on the higher HLC, and the loser hears it was overwritten`, async ({ context, browser }, testInfo) => {
    test.setTimeout(180_000);
    const one = await openApp(context, USER_B);
    await settled(one);
    const [copy] = await freshCopies(one, 1, nextOffset());
    const otherContext = await newDevice(browser, testInfo);
    const two = await openApp(otherContext, USER_B);
    await settled(two);
    const key = `uf/${copy!.head}/note`;
    const overwrittenBefore = [(await syncState(one)).overwritten, (await syncState(two)).overwritten];

    await context.setOffline(true);
    await otherContext.setOffline(true);
    await one.evaluate(([h]) => window.__fcSync!.writeNote(h!, 'from the first device'), [copy!.head]);
    await new Promise((r) => setTimeout(r, 50)); // the second device edits later: its HLC is higher
    await two.evaluate(([h]) => window.__fcSync!.writeNote(h!, 'from the second device'), [copy!.head]);

    const [early, late] = order === 'first device first' ? [[context, one], [otherContext, two]] as const : [[otherContext, two], [context, one]] as const;
    await early[0].setOffline(false);
    await settled(early[1]);
    await late[0].setOffline(false);
    await settled(late[1]);
    await syncNow(early[1]);
    await settled(early[1]);

    const read = async (page: Page) => {
      const facet = await page.evaluate((k) => window.__fcSync!.facet(k), key);
      return { version: facet!.value!.version, note: (JSON.parse(facet!.value!.payload) as { note: string }).note };
    };
    const [a, b] = [await read(one), await read(two)];
    expect(a).toEqual(b);
    expect(a.note).toBe('from the second device');
    // The loser is the first device in both orders: its line says so, the winner's does not.
    expect((await syncState(one)).overwritten).toBe(overwrittenBefore[0]! + 1);
    expect((await syncState(two)).overwritten).toBe(overwrittenBefore[1]);
    await expect(statusLine(one)).toContainText('overwritten by another device');
    await otherContext.close();
  });
}

// ------------------------------------------------------------------ (7) slow link

test('(7) at 400 kbit/s and 400 ms RTT, hydrate completes with no duplicate Push', async ({ context, browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP Network.emulateNetworkConditions is Chromium-only');
  test.setTimeout(480_000);
  await stack.issuer.loginAs(USER_A.sub);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: 50_000, uploadThroughput: 50_000 });
  const from = await stack.edge.cursor();
  await page.goto('/', { timeout: 180_000 });
  await hooksReady(page);
  await page.getByRole('button', { name: 'Sign in' }).click({ timeout: 60_000 });
  await expect.poll(() => page.url(), { timeout: 180_000 }).toBe(HOME);
  // The page came back from the IdP: hold the link slow on it whatever the navigation did.
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: 50_000, uploadThroughput: 50_000 });
  const started = Date.now();
  await hooksReady(page);
  // One edit while the slow hydrate runs.
  await expect.poll(() => authStatus(page), { timeout: 60_000 }).toBe('signed-in');
  await page.evaluate(([h]) => window.__fcSync!.writeNote(h!, 'over a slow link'), [HEADS[1]]);
  await expect.poll(() => seededShown(page), { timeout: 300_000, intervals: [2_000] }).toBe(SEED);
  await expect.poll(async () => (await counts(page)).products, { timeout: 300_000, intervals: [2_000] }).toBeGreaterThanOrEqual(SEED);
  await settled(page, 120_000);
  // About 1.4 MB of feed and cards at 50 kB/s: the link really was slow.
  expect(Date.now() - started).toBeGreaterThan(15_000);
  const pushes = (await stack.edge.log(from)).filter((e) => e.path === PUSH_PATH);
  expect(pushes.map((e) => e.status)).toEqual([200]);
});

// ------------------------------------------------------------------ (9) storage cleared

test('(9) site data cleared mid-session (the 7-day eviction): no crash, sign in again, re-enrol and re-hydrate from an empty cursor', async ({ context, browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP Storage.clearDataForOrigin is Chromium-only');
  test.setTimeout(240_000);
  const page = await openApp(context, USER_A);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await expect.poll(() => seededShown(page), { timeout: 120_000 }).toBe(SEED);
  const deviceBefore = await page.evaluate(() => window.__fcAuth!.session()).then((s) => (s.body as { deviceId: string }).deviceId);

  const cdp = await context.newCDPSession(page);
  await cdp.send('Storage.clearDataForOrigin', { origin: state.origin, storageTypes: 'all' });
  await syncNow(page);
  await expect.poll(() => authStatus(page), { timeout: 15_000 }).toBe('signed-out');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  expect(errors).toEqual([]);

  const from = await stack.edge.cursor();
  await stack.issuer.loginAs(USER_A.sub);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect.poll(() => page.url(), { timeout: 30_000 }).toBe(HOME);
  await hooksReady(page);
  await expect.poll(() => authStatus(page), { timeout: 30_000 }).toBe('signed-in');
  await expect.poll(() => seededShown(page), { timeout: 120_000 }).toBe(SEED);
  const deviceAfter = await page.evaluate(() => window.__fcAuth!.session()).then((s) => (s.body as { deviceId: string }).deviceId);
  expect(deviceAfter).not.toBe(deviceBefore);
  const log = await stack.edge.log(from);
  expect(log.filter((e) => e.path === '/api/auth/devices' && e.status === 201)).toHaveLength(1);
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------------ (10) unreadable cursor

test('(10) an unreadable cursor leads to a full replay that reaches the same state', async ({ context }) => {
  test.setTimeout(180_000);
  const page = await openApp(context, USER_A);
  await expect.poll(() => seededShown(page), { timeout: 120_000 }).toBe(SEED);
  await settled(page);
  const before = await page.evaluate(() => window.__fcSync!.copies());
  const cursorBefore = (await counts(page)).cursor;
  await page.evaluate(async (sub) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('fc-mobile');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const store = db.transaction('sync_meta', 'readwrite').objectStore('sync_meta');
      const get = store.get(sub);
      get.onsuccess = () => {
        const put = store.put({ ...get.result, cursor: 'not a cursor' });
        put.onsuccess = () => resolve();
        put.onerror = () => reject(put.error);
      };
      get.onerror = () => reject(get.error);
    });
    db.close();
  }, USER_A.sub);
  expect((await counts(page)).cursor).toBe('not a cursor');
  const from = await stack.edge.cursor();
  await syncNow(page);
  await settled(page);
  const deltas = (await stack.edge.log(from)).filter((e) => e.path === DELTA_PATH).map((e) => e.status);
  expect(deltas[0]).toBe(400);
  expect(deltas.slice(1).every((s) => s === 200)).toBe(true);
  expect(deltas.length).toBeGreaterThanOrEqual(6);
  const after = await page.evaluate(() => window.__fcSync!.copies());
  const key = (c: { occ_id: string }) => c.occ_id;
  expect([...after].sort((x, y) => key(x).localeCompare(key(y)))).toEqual([...before].sort((x, y) => key(x).localeCompare(key(y))));
  expect((await counts(page)).cursor).toBe(cursorBefore);
});

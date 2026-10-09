// WK-13b acceptance on the local full stack: an edit made through the screens while offline is
// committed to the local store at once and survives the app being killed. Ross's Fold8 run
// (WK-16 F9/F10/F12/F13): three Notes edits in Airplane mode showed 'Saving…' until the screen was
// left, were gone from the shelf and the detail, were lost when the app was swiped away and
// reopened offline, and no 'N changes waiting to sync' line was shown.
// Here: three Notes edits through Edit → Save offline; each Save resolves at once; the app is killed
// (its page closed) and opened again offline; the three notes are on the detail with Pending, the
// three tiles are Pending, the status line counts 3 changes; reconnecting turns them Synced in 30 s.
import { readFileSync } from 'node:fs';
import { expect, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { guardedTest as test } from '../fixtures';
import type { E2eHooks } from '../../src/auth/e2eHooks';
import type { SyncHooks } from '../../src/sync/e2eHooks';
import { readStackState, stackClient, type StackClient } from '../stack/src/client.js';
import type { StackUser } from '../stack/src/issuer.js';
import type { StackState } from '../stack/src/stack.js';

declare global {
  interface Window {
    __fcAuth?: E2eHooks;
    __fcSync?: SyncHooks;
  }
}

const EDITS = 3;
let state: StackState;
let stack: StackClient;
let USER_B: StackUser;
let HEADS: string[];
let HOME: string;

test.beforeAll(() => {
  const found = readStackState();
  if (found === undefined) throw new Error('no stack state file: run through playwright.stack.config.ts');
  state = found;
  stack = stackClient(state.controlUrl);
  USER_B = state.users[1]!;
  HEADS = (JSON.parse(readFileSync(state.catalog.file, 'utf8')) as { heads: Array<{ headId: string }> }).heads.map((h) => h.headId);
  HOME = `${state.origin}/`;
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

const authStatus = (page: Page) => page.evaluate(() => window.__fcAuth?.status() ?? 'loading').catch(() => 'navigating');
const syncState = (page: Page) => page.evaluate(() => window.__fcSync!.state());

async function hooksReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__fcAuth !== undefined && window.__fcSync !== undefined, undefined, { timeout: 30_000 }).catch(() => {
    throw new Error('no window.__fcAuth / __fcSync: the stack must serve dist-stack (npm run build:stack)');
  });
}

async function openApp(context: BrowserContext, user: StackUser, timeout = 30_000): Promise<Page> {
  await stack.issuer.loginAs(user.sub);
  const page = await context.newPage();
  await page.goto('/', { timeout });
  await hooksReady(page);
  await expect.poll(() => authStatus(page), { timeout }).toMatch(/^(signed-in|signed-out|reauth-required)$/);
  if ((await authStatus(page)) !== 'signed-in') {
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect.poll(() => page.url(), { timeout }).toBe(HOME);
    await hooksReady(page);
    await expect.poll(() => authStatus(page), { timeout }).toBe('signed-in');
  }
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

/** Wait until the page's service worker controls it, reloading once if the first load was not controlled. */
async function controlled(page: Page): Promise<boolean> {
  if (!(await page.evaluate(() => 'serviceWorker' in navigator))) return false;
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  if (!(await page.evaluate(() => navigator.serviceWorker.controller !== null))) {
    await page.reload();
    await hooksReady(page);
  }
  return page.evaluate(() => navigator.serviceWorker.controller !== null);
}

/** Go to a screen inside the app, as a tap on a link would (no reload). */
async function navigate(page: Page, path: string): Promise<void> {
  await page.evaluate((to) => {
    history.pushState(null, '', to);
    dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

/**
 * Kill the app and open it again while offline: the page is closed (every in-memory queue goes with
 * it) and a new one loads from the service worker. Playwright's WebKit cannot navigate under
 * context.setOffline, so there the new page loads in a true outage (the edge stopped).
 */
async function restartOffline(context: BrowserContext, page: Page, testInfo: TestInfo): Promise<Page> {
  const webkit = testInfo.project.use.defaultBrowserType === 'webkit';
  await page.close();
  if (webkit) {
    await stack.edge.stop();
    await context.setOffline(false);
  }
  const next = await context.newPage();
  await next.goto('/');
  await hooksReady(next);
  if (webkit) {
    await context.setOffline(true);
    await stack.edge.start();
  }
  await expect.poll(() => authStatus(next), { timeout: 30_000 }).toBe('signed-in');
  return next;
}

const tile = (page: Page, head: string) => page.locator(`.jrows__item[aria-describedby="sync-${head}-owned"]`);

test('three Notes edits made offline commit at once, survive killing the app offline, show Pending and the waiting line, and sync within 30 s of reconnecting', async ({ context }, testInfo) => {
  test.setTimeout(240_000);
  let page = await openApp(context, USER_B);
  await settled(page);
  test.skip(!(await controlled(page)), `${testInfo.project.name}: no service worker controls the page, so an offline restart cannot be served`);

  // Three figures B holds no copy of yet, one owned copy each, synced.
  const held = new Set((await page.evaluate(() => window.__fcSync!.copies())).map((c) => c.head_id));
  const pool = HEADS.filter((h) => !held.has(h));
  const start = Date.now() % Math.max(1, pool.length - EDITS);
  const heads = pool.slice(start, start + EDITS);
  for (const head of heads) await page.evaluate(([h]) => window.__fcSync!.createCopy(h!, 'owned'), [head]);
  await page.evaluate(() => window.__fcSync!.syncNow());
  await settled(page);

  await context.setOffline(true);
  const stamp = Date.now();
  const notes = heads.map((_, i) => `offline note ${i + 1} ${stamp}`);
  for (const [i, head] of heads.entries()) {
    await navigate(page, `/figure/${head}`);
    await page.getByRole('button', { name: 'Edit' }).click();
    const sheet = page.getByRole('form', { name: 'Edit figure' });
    await sheet.getByLabel('Notes').fill(notes[i]!);
    await sheet.getByRole('button', { name: /^Save/ }).click();
    // F9: 'Saving…' resolves at the local commit, not at the network.
    await expect.soft(sheet, `Save ${i + 1} closes the sheet offline`).toBeHidden({ timeout: 3_000 });
    // F13: the detail reads the pending edit back at once.
    await expect.soft(page.locator('.figure-detail__notes', { hasText: notes[i]! })).toBeVisible({ timeout: 3_000 });
    // Back on the shelf, as Ross went: the edited figure reads Pending there too.
    await navigate(page, '/?layout=rows&tab=owned');
    await expect.soft(tile(page, head), `figure ${i + 1} Pending on the shelf`).toHaveAttribute('data-sync', 'pending', { timeout: 3_000 });
  }

  // F12: the app is swiped away with the edits pending and reopened offline.
  page = await restartOffline(context, page, testInfo);

  // F10: the status line counts the waiting edits.
  await expect(page.locator('.sync-status-line')).toContainText(`${EDITS} changes waiting to sync`, { timeout: 15_000 });
  // F13: the shelf shows each edited figure Pending.
  await navigate(page, '/?layout=rows&tab=owned');
  for (const head of heads) await expect(tile(page, head)).toHaveAttribute('data-sync', 'pending', { timeout: 15_000 });
  // The detail shows each note, Pending.
  for (const [i, head] of heads.entries()) {
    await navigate(page, `/figure/${head}`);
    await expect(page.locator('.figure-detail__notes')).toHaveText(notes[i]!, { timeout: 15_000 });
    await expect(page.locator('.figure-detail__status .sync-badge')).toHaveAttribute('data-sync', 'pending');
  }

  // Reconnect: Synced within 30 s, and the server holds the notes.
  const back = Date.now();
  await context.setOffline(false);
  await navigate(page, '/?layout=rows&tab=owned');
  for (const head of heads) await expect(tile(page, head)).toHaveAttribute('data-sync', 'known', { timeout: Math.max(1, 30_000 - (Date.now() - back)) });
  expect(Date.now() - back).toBeLessThan(30_000);
  await expect(page.locator('.sync-status-line')).toHaveCount(0);
  const outbox = await page.evaluate(() => window.__fcSync!.outbox());
  for (const head of heads) expect(outbox.filter((e) => e.facet_key === `uf/${head}/note`).map((e) => e.state)).toEqual(['APPLIED']);
});

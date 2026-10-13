// MOB-NAV-1 on the local full stack: on the case screen every control of the chrome (the header,
// the collection tabs, the filter bar, the case's pull-up tabs, the tab bar) and of the cards it
// opens is DRAWN, after each tap Ross makes: switching collection, opening and closing the
// filters and the View card, leaving for another tab and coming back. User A holds Ross's shape:
// a large Owned (the 1,200 copies of e2e/sync and e2e/screens), a small Ordered and a large Wished
// (10 and 574 copies, made here), so each tab stands a different wall. Chromium at the Fold8's
// cover and open panels, at its device pixel ratio.
// The check reads the screen (e2e/paintCheck.ts), not the DOM: the bug left the DOM, the styles
// and hit-testing whole (an "invisible" button still worked) while the compositor did not draw
// the chrome at all. The View card opened inside the page, under the tab bar and the pull-up tabs:
// each of its choices on screen must take its own tap.
import { readFileSync } from 'node:fs';
import { expect, test } from '../fixtures';
import type { Locator, Page, TestInfo } from '@playwright/test';
import type { E2eHooks } from '../../src/auth/e2eHooks';
import type { SyncHooks } from '../../src/sync/e2eHooks';
import { decodePng, inkShare } from '../paintCheck';
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
}

/** e2e/screens and e2e/sync seed user A with these 1,200 owned copies; whichever runs first writes them. */
const OWNED = 1200;
const OWNED_PREFIX = 'occ/5eed0000-';
const ownedOcc = (i: number): string => `5eed0000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`;
/** Ross's Ordered and Wished (his export: Owned 560, Ordered 10, Wished 574), on heads the owned seed also holds. */
const ORDERED = 10;
const WISHED = 574;
const SHAPE_PREFIX = 'occ/c4e50000-';
const shapeOcc = (i: number): string => `c4e50000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`;
/**
 * A control is drawn when this share of its pixels is off its background: its label, icon or edge. An undrawn
 * one is a flat colour (0); the faintest drawn here, a full-width row on the open panel, is about 0.8 %.
 */
const MIN_INK = 0.002;

let state: StackState;
let stack: StackClient;
let USER_A: StackUser;
let HEADS: CatalogHead[];

test.describe.configure({ mode: 'serial' });

async function seed(): Promise<void> {
  const owned = await stack.sync.counts({ user: USER_A.sub, prefix: OWNED_PREFIX });
  const shaped = await stack.sync.counts({ user: USER_A.sub, prefix: SHAPE_PREFIX });
  if (owned.facets >= OWNED * 2 && shaped.facets >= (ORDERED + WISHED) * 2) return;
  const device = await loginDevice({
    origin: state.origin,
    authorizationEndpoint: state.issuer.authorizationEndpoint,
    tokenEndpoint: state.issuer.tokenEndpoint,
    clientId: state.issuer.clientId,
    loginHint: USER_A.email,
  });
  expect((await device.enrol('mob-nav-1 seed')).status).toBe(201);
  const dev = device.deviceId!.replace(/-/g, '');
  const stamp = { edited_at: '2026-10-01T00:00:00.000+00:00', tz: 'UTC' };
  let counter = 0;
  const version = () => `2026-10-01T00:00:00.000000Z#${String(++counter).padStart(10, '0')}#${dev}`;
  const copies: { occ: string; head: string; status: string; tag: string }[] = [];
  if (owned.facets < OWNED * 2) {
    for (let i = 0; i < OWNED; i++) copies.push({ occ: ownedOcc(i), head: HEADS[i]!.headId, status: 'owned', tag: 'wk15-seed' });
  }
  if (shaped.facets < (ORDERED + WISHED) * 2) {
    for (let i = 0; i < ORDERED + WISHED; i++) {
      copies.push({ occ: shapeOcc(i), head: HEADS[(590 + i) % HEADS.length]!.headId, status: i < ORDERED ? 'ordered' : 'wished', tag: 'nav1-seed' });
    }
  }
  for (let start = 0; start < copies.length; start += 100) {
    const batch = copies.slice(start, start + 100);
    const events = batch.flatMap((c) => [
      { facetKey: `occ/${c.occ}/head`, version: version(), op: 'SYNC_OP_UPSERT', payload: JSON.stringify({ head_id: c.head, ...stamp }), basis: '' },
      { facetKey: `occ/${c.occ}/status`, version: version(), op: 'SYNC_OP_UPSERT', payload: JSON.stringify({ status: c.status, ...stamp }), basis: '' },
    ]);
    const res = await device.connect('coordinator.v1.SyncService', 'Push', { clientId: `${batch[0]!.tag}-${dev}-${start}`, events });
    expect(res.status).toBe(200);
  }
}

test.beforeAll(async () => {
  test.setTimeout(240_000);
  const found = readStackState();
  if (found === undefined) throw new Error('no stack state file: run through playwright.stack.config.ts');
  state = found;
  stack = stackClient(state.controlUrl);
  USER_A = state.users[0]!;
  HEADS = (JSON.parse(readFileSync(state.catalog.file, 'utf8')) as { heads: CatalogHead[] }).heads;
  await seed();
});

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem('onboarding_complete', '1'));
  await stack.edge.clearFaults();
  await stack.issuer.configure({ accessTokenTtlSeconds: 600, offlineAccess: true });
});

const authStatus = (page: Page) => page.evaluate(() => window.__fcAuth?.status() ?? 'loading').catch(() => 'navigating');

async function openApp(page: Page): Promise<void> {
  await stack.issuer.loginAs(USER_A.sub);
  await page.goto('/');
  await page.waitForFunction(() => window.__fcAuth !== undefined && window.__fcSync !== undefined, undefined, { timeout: 30_000 }).catch(() => {
    throw new Error('no window.__fcAuth / __fcSync: the stack must serve dist-stack (npm run build:stack)');
  });
  await expect.poll(() => authStatus(page), { timeout: 30_000 }).toMatch(/^(signed-in|signed-out|reauth-required)$/);
  if ((await authStatus(page)) !== 'signed-in') {
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect.poll(() => authStatus(page), { timeout: 30_000 }).toBe('signed-in');
  }
  // every seeded copy is on the device and nothing is still being pulled or sent
  await expect
    .poll(
      async () => {
        const s = await page.evaluate(() => window.__fcSync!.state());
        if (s.phase !== 'idle' || s.reachability !== 'reachable' || s.pending !== 0) return false;
        const copies = await page.evaluate(() => window.__fcSync!.copies());
        const mine = (prefix: string) => copies.filter((c) => c.occ_id.startsWith(prefix.slice(4)) && c.shown_in !== null).length;
        return mine(OWNED_PREFIX) === OWNED && mine(SHAPE_PREFIX) === ORDERED + WISHED;
      },
      { timeout: 180_000 },
    )
    .toBe(true);
}

/** Wait until `sheet` stops moving: its spring has settled. */
async function atRest(sheet: Locator): Promise<void> {
  let last = '';
  await expect
    .poll(async () => {
      const box = await sheet.boundingBox();
      const now = JSON.stringify(box && [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)]);
      const still = box !== null && now === last;
      last = now;
      return still;
    }, { intervals: [150], timeout: 10_000 })
    .toBe(true);
}

/** The case screen's chrome, each control by the name Ross would give it. */
function chrome(page: Page): [string, Locator][] {
  const tabs = page.getByRole('tablist', { name: 'Collections' });
  const controls: [string, Locator][] = [
    ['the header title', page.locator('.slim-header__context')],
    ['Select', page.locator('.page-collection__select-btn')],
    ['the layout toggle', page.locator('.slim-header .display-toggle').first()],
    ['Owned', tabs.getByRole('tab', { name: /^Owned/ })],
    ['Ordered', tabs.getByRole('tab', { name: /^Ordered/ })],
    ['Wished', tabs.getByRole('tab', { name: /^Wished/ })],
    ['Filter', page.locator('.filter-bar__btn').first()],
    ['the sort', page.locator('.filter-bar__btn').nth(1)],
    ['the View tab', page.locator('.case-tabs__tab[data-tab="view"]')],
    ['the Refine tab', page.locator('.case-tabs__tab[data-tab="refine"]')],
    ['Collection (tab bar)', page.getByRole('button', { name: 'Collection', exact: true })],
    ['Search (tab bar)', page.getByRole('button', { name: 'Search', exact: true })],
    ['Stats (tab bar)', page.getByRole('button', { name: 'Stats', exact: true })],
    ['Profile (tab bar)', page.getByRole('button', { name: 'Profile', exact: true })],
    ['Add figures (+)', page.getByRole('button', { name: 'Add figures' })],
  ];
  return controls;
}

/** The controls in `controls` the screen does not show: present in the DOM, yet no ink where they stand. */
async function undrawn(page: Page, controls: [string, Locator][]): Promise<string[]> {
  const viewport = page.viewportSize()!;
  const out: string[] = [];
  for (const [name, locator] of controls) {
    if ((await locator.count()) === 0) continue;
    const box = await locator.first().boundingBox();
    if (box === null) continue;
    const x = Math.max(0, box.x);
    const y = Math.max(0, box.y);
    const width = Math.min(viewport.width, box.x + box.width) - x;
    const height = Math.min(viewport.height, box.y + box.height) - y;
    if (width < 8 || height < 8) continue;
    const ink = inkShare(decodePng(await page.screenshot({ clip: { x, y, width, height } })));
    if (ink < MIN_INK) out.push(name);
  }
  return out;
}

async function check(page: Page, testInfo: TestInfo, failures: string[], step: string, controls: [string, Locator][]): Promise<void> {
  // two frames' grace for the compositor after the tap's own work
  await page.waitForTimeout(400);
  const missing = await undrawn(page, controls);
  if (missing.length === 0) return;
  failures.push(`${step}: ${missing.join(', ')} not drawn`);
  await testInfo.attach(`undrawn ${step}`, { body: await page.screenshot(), contentType: 'image/png' });
}

async function showTab(page: Page, name: 'Owned' | 'Ordered' | 'Wished'): Promise<void> {
  const tab = page.getByRole('tablist', { name: 'Collections' }).getByRole('tab', { name: new RegExp(`^${name}`) });
  await tab.tap();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('button.cab-figure').first()).toBeVisible({ timeout: 30_000 });
}

test("the case screen's chrome and cards are drawn after every collection switch, card and tab-bar tap", async ({ page }, testInfo) => {
  test.setTimeout(420_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openApp(page);
  await expect(page.locator('button.cab-figure').first()).toBeVisible({ timeout: 60_000 });
  const failures: string[] = [];
  const top = { x: page.viewportSize()!.width / 2, y: 12 };

  await check(page, testInfo, failures, 'the case screen', chrome(page));
  for (const name of ['Ordered', 'Wished', 'Owned', 'Wished', 'Ordered', 'Owned'] as const) {
    await showTab(page, name);
    await check(page, testInfo, failures, `after ${name}`, chrome(page));
  }

  // the filters, from the filter bar (every build has it) and from the case's Refine tab
  const filterSheet = page.locator('.detent-sheet');
  const filterControls: [string, Locator][] = [
    ['the filter groups', page.locator('.filter-sheet2__tabs')],
    ['Clear', page.locator('.filter-sheet2__btn--clear')],
    ['Apply', page.locator('.filter-sheet2__btn--apply')],
  ];
  await page.locator('.filter-bar__btn').first().tap();
  await atRest(filterSheet);
  await check(page, testInfo, failures, 'the filters (Filter)', filterControls);
  await page.locator('.detent-sheet__backdrop').tap({ position: top });
  await expect(filterSheet).toHaveCount(0);
  await check(page, testInfo, failures, 'after closing the filters', chrome(page));

  if ((await page.locator('.case-tabs__tab[data-tab="view"]').count()) > 0) {
    await page.locator('.case-tabs__tab[data-tab="view"]').tap();
    const card = page.locator('.bottom-sheet');
    await atRest(card);
    await check(page, testInfo, failures, 'the View card', [
      ['Whole cabinets', page.getByRole('radio', { name: 'Whole cabinets' })],
      ['One cabinet', page.getByRole('radio', { name: 'One cabinet' })],
      ['One shelf', page.getByRole('radio', { name: 'One shelf' })],
    ]);
    // every choice the open card shows takes its own tap: none lies under the pull-up tabs or the tab bar
    const covered = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('.case-card__choice, .case-card__ceiling, .case-card__swap')).flatMap((el) => {
        const r = el.getBoundingClientRect();
        const y = r.top + r.height / 2;
        // below the half-open card's edge: the card is dragged up to reach it
        if (y < 0 || y >= window.innerHeight) return [];
        const hit = document.elementFromPoint(r.left + Math.min(24, r.width / 2), y);
        return hit !== null && el.contains(hit) ? [] : [`${el.textContent!.trim()} (under ${hit?.closest('[class]')?.className ?? 'nothing'})`];
      }),
    );
    if (covered.length > 0) failures.push(`the View card: ${covered.join('; ')} cannot be tapped`);
    await page.locator('.bottom-sheet__backdrop').tap({ position: top });
    await expect(card).toHaveCount(0);
    await check(page, testInfo, failures, 'after closing the View card', chrome(page));

    await page.locator('.case-tabs__tab[data-tab="refine"]').tap();
    await atRest(filterSheet);
    await check(page, testInfo, failures, 'the filters (Refine)', filterControls);
    await page.locator('.detent-sheet__backdrop').tap({ position: top });
    await expect(filterSheet).toHaveCount(0);
    await check(page, testInfo, failures, 'after closing Refine', chrome(page));
  }

  // away on the tab bar and back
  for (const away of ['Search', 'Stats', 'Profile'] as const) {
    await page.getByRole('button', { name: away, exact: true }).tap();
    await expect(page.locator('.page-collection')).toHaveCount(0);
    await check(page, testInfo, failures, `on ${away}`, [
      ['Collection (tab bar)', page.getByRole('button', { name: 'Collection', exact: true })],
      [`${away} (tab bar)`, page.getByRole('button', { name: away, exact: true })],
      ['Add figures (+)', page.getByRole('button', { name: 'Add figures' })],
    ]);
    await page.getByRole('button', { name: 'Collection', exact: true }).tap();
    await expect(page.locator('button.cab-figure').first()).toBeVisible({ timeout: 30_000 });
    await check(page, testInfo, failures, `back from ${away}`, chrome(page));
  }

  expect(failures).toEqual([]);
  expect(errors).toEqual([]);
});

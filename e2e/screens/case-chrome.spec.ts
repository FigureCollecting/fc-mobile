// MOB-NAV-1 on the local full stack: on the case screen every control of the chrome (the header,
// the collection tabs, the filter bar, the case's pull-up tabs, the tab bar) and of the cards it
// opens is DRAWN, after each tap Ross makes: switching collection, opening and closing the
// filters and the View card, leaving for another tab and coming back. User A holds Ross's shape:
// a large Owned (the 1,200 copies of e2e/sync and e2e/screens), a small Ordered and a large Wished
// (10 and 574 copies, made here), so each tab stands a different wall. Chromium at the Fold8's
// cover and open panels, at its device pixel ratio. A second pass pans the wall far (CC4 pan).
// The check reads the screen (e2e/paintCheck.ts), not the DOM: the bug left the DOM, the styles
// and hit-testing whole (an "invisible" button still worked) while the compositor did not draw
// the chrome at all.
import { readFileSync } from 'node:fs';
import { expect, test } from '../fixtures';
import type { Locator, Page, TestInfo } from '@playwright/test';
import type { E2eHooks } from '../../src/auth/e2eHooks';
import type { SyncHooks } from '../../src/sync/e2eHooks';
import { decodePng, inkShare } from '../paintCheck';
import { atRest, takesTap } from '../sheetRest';
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
 * one is a flat colour (0). Each control is read by its own box (a card's choice by its radio, a filter group
 * by its tab), never a full-width row: the faintest drawn one, a tab-bar item on the open panel, reads about
 * 1.3 % (each run attaches every share it read).
 */
const MIN_INK = 0.01;
/** Every ink share read, by step and control: the threshold's evidence. */
const inks: { step: string; name: string; ink: number }[] = [];

let state: StackState;
let stack: StackClient;
let USER_A: StackUser;
let HEADS: CatalogHead[];

// each test stands alone (the seed is idempotent): a red first pass never hides the far-pan pass
test.describe.configure({ mode: 'default' });

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
  // the 4 s splash covers the chrome until it goes
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 15_000 });
}

/** The case screen's chrome, each control by the name Ross would give it. */
function chrome(page: Page): [string, Locator][] {
  // SHEETS-FB1: no Select, no holdings tab row and no filter bar; the holdings are chosen in Refine
  const controls: [string, Locator][] = [
    ['the header title', page.locator('.slim-header__context')],
    ['the layout toggle', page.locator('.slim-header .display-toggle').first()],
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

/**
 * The controls in `controls` the screen does not show: each must be in the DOM with a box of at least 8 px
 * inside the viewport (else it is named missing or off screen), and carry ink where it stands.
 */
async function undrawn(page: Page, step: string, controls: [string, Locator][]): Promise<string[]> {
  const viewport = page.viewportSize()!;
  const out: string[] = [];
  for (const [name, locator] of controls) {
    if ((await locator.count()) === 0) {
      out.push(`${name} (missing)`);
      continue;
    }
    const box = await locator.first().boundingBox();
    if (box === null) {
      out.push(`${name} (no box)`);
      continue;
    }
    const x = Math.max(0, box.x);
    const y = Math.max(0, box.y);
    const width = Math.min(viewport.width, box.x + box.width) - x;
    const height = Math.min(viewport.height, box.y + box.height) - y;
    if (width < 8 || height < 8) {
      out.push(`${name} (off screen)`);
      continue;
    }
    const ink = inkShare(decodePng(await page.screenshot({ clip: { x, y, width, height } })));
    inks.push({ step, name, ink });
    if (ink < MIN_INK) out.push(name);
  }
  return out;
}

async function check(page: Page, testInfo: TestInfo, failures: string[], step: string, controls: [string, Locator][]): Promise<void> {
  // two frames' grace for the compositor after the tap's own work
  await page.waitForTimeout(400);
  const missing = await undrawn(page, step, controls);
  if (missing.length === 0) return;
  failures.push(`${step}: ${missing.join(', ')} not drawn`);
  await testInfo.attach(`undrawn ${step}`, { body: await page.screenshot(), contentType: 'image/png' });
}

/** The View card's choices, each scrolled into the card's view on its own: a tap reaches it and its radio is drawn. */
async function checkViewCard(page: Page, testInfo: TestInfo, failures: string[], step: string): Promise<void> {
  const choices = await page.locator('.bottom-sheet label.case-card__choice').all();
  if (choices.length < 7) failures.push(`${step}: ${choices.length} choices, not the 3 views, 4 walls and 2 swipes`);
  for (const choice of choices) {
    const name = (await choice.innerText()).trim().split('\n')[0]!;
    const { hit, at } = await takesTap(choice, '.bottom-sheet__content');
    if (!hit) failures.push(`${step}: a tap on ${name} misses it (${at})`);
    await check(page, testInfo, failures, step, [[name, choice.locator('input')]]);
  }
}

/** A finger's sideways swipe of dx px across the middle of the case. */
async function swipe(page: Page, dx: number): Promise<void> {
  const scene = (await page.locator('.cabinet-scene').boundingBox())!;
  const x = scene.x + scene.width * (dx < 0 ? 0.75 : 0.25);
  const y = scene.y + scene.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + (dx * i) / 8, y);
  await page.mouse.up();
}

/** Show one holding alone, chosen in Refine (SHEETS-FB1: it applies at once), then Done. */
async function showTab(page: Page, name: 'Owned' | 'Ordered' | 'Wished'): Promise<void> {
  await page.locator('.case-tabs__tab[data-tab="refine"]').tap();
  const holding = page.getByRole('group', { name: 'Holding' });
  const choice = (label: string) => holding.getByRole('button', { name: new RegExp(`^${label}`) });
  if ((await choice(name).getAttribute('aria-pressed')) !== 'true') await choice(name).tap();
  // each other holding by its name (an nth() of the pressed ones would shift as each is let go)
  for (const other of ['Owned', 'Ordered', 'Wished', 'No longer owned'].filter((n) => n !== name)) {
    if ((await choice(other).getAttribute('aria-pressed')) === 'true') await choice(other).tap();
  }
  await expect(choice(name)).toHaveAttribute('aria-pressed', 'true');
  await expect(holding.getByRole('button', { pressed: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Done' }).tap();
  await expect(page.locator('.detent-sheet')).toHaveCount(0);
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

  // the filters, from the case's Refine tab (the filter bar is gone, SHEETS-FB1)
  const filterSheet = page.locator('.detent-sheet');
  const filterControls: [string, Locator][] = [
    ['the first filter group', page.locator('.filter-sheet2__tab').first()],
    ['Clear', page.locator('.filter-sheet2__btn--clear')],
    ['Done', page.locator('.filter-sheet2__btn--done')],
  ];

  await page.locator('.case-tabs__tab[data-tab="view"]').tap();
  const card = page.locator('.bottom-sheet');
  await atRest(card);
  await checkViewCard(page, testInfo, failures, 'the View card');
  await page.locator('.bottom-sheet__backdrop').tap({ position: top });
  await expect(card).toHaveCount(0);
  await check(page, testInfo, failures, 'after closing the View card', chrome(page));

  await page.locator('.case-tabs__tab[data-tab="refine"]').tap();
  await atRest(filterSheet);
  await check(page, testInfo, failures, 'the filters (Refine)', filterControls);
  await page.locator('.detent-sheet__backdrop').tap({ position: top });
  await expect(filterSheet).toHaveCount(0);
  await check(page, testInfo, failures, 'after closing Refine', chrome(page));

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

  await testInfo.attach('ink shares read', { body: JSON.stringify(inks, null, 1), contentType: 'application/json' });
  expect(failures).toEqual([]);
  expect(errors).toEqual([]);
});

test('after the wall is panned far (CC4 pan, 20 swipes of 400 px), the chrome, the tabs and the View card are still drawn', async ({ page, context }, testInfo) => {
  test.setTimeout(420_000);
  inks.length = 0;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await context.addInitScript(() => localStorage.setItem('fc-case-prefs', JSON.stringify({ view: 'wall', swipe: 'pan' })));
  await openApp(page);
  await expect(page.locator('button.cab-figure').first()).toBeVisible({ timeout: 60_000 });
  const scene = page.locator('.cabinet-scene');
  await expect(scene).toHaveAttribute('data-swipe', 'pan');
  const failures: string[] = [];
  const top = { x: page.viewportSize()!.width / 2, y: 12 };

  const farthest = () => page.locator('.cab').evaluateAll((els) => Math.max(...els.map((e) => Number((e as HTMLElement).dataset.index))));
  const before = await farthest();
  for (let i = 0; i < 20; i++) await swipe(page, -400);
  // 8,000 px along a wall of some hundred cabinets: cabinets far down the wall are drawn now
  await expect.poll(farthest).toBeGreaterThan(before + 5);
  await check(page, testInfo, failures, 'after 20 swipes', chrome(page));
  for (const name of ['Wished', 'Owned'] as const) {
    await showTab(page, name);
    for (let i = 0; i < 20; i++) await swipe(page, -400);
    await check(page, testInfo, failures, `after ${name} and 20 swipes`, chrome(page));
  }
  await page.locator('.case-tabs__tab[data-tab="view"]').tap();
  const card = page.locator('.bottom-sheet');
  await atRest(card);
  await checkViewCard(page, testInfo, failures, 'the View card, panned');
  await page.locator('.bottom-sheet__backdrop').tap({ position: top });
  await expect(card).toHaveCount(0);
  await check(page, testInfo, failures, 'after closing the View card, panned', chrome(page));

  await testInfo.attach('ink shares read', { body: JSON.stringify(inks, null, 1), contentType: 'application/json' });
  expect(failures).toEqual([]);
  expect(errors).toEqual([]);
});

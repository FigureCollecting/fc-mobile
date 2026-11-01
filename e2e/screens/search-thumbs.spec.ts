// SEARCH-THUMB-1 (Ross 10-31, Fold8 cover: "figure search needs thumbnail (full view but very small) to tell entries apart";
// seven rows of "Tokisaki Kurumi" told apart only by maker). On the local full stack, user A's 1,200 owned copies, each
// figure's GetProductImages answered by a page route, the photos from images.figurecollecting.com with the production
// headers, a different picture per figure. A search of 20 rows: each row starts with its figure's photo, whole (contained),
// in a box of fixed size; the rows are laid out the same before the photos come and after (no shift); a row stays a target a
// finger takes; and the rows ask GetProductImages once, not once a row. Signed in on a device that keeps no image yet (the
// app opened on Search, so the case view never synced), every row is asked for, in that one call.
// The page waits for the photos only of the rows in view (lazy-loaded); the call is made for every row.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { create, toJson } from '@bufbuild/protobuf';
import { GetProductImagesResponseSchema } from '@figurecollecting/fc-api-contract';
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

/** e2e/screens and e2e/sync seed user A with these 1,200 owned copies; whichever runs first writes them. */
const OWNED = 1200;
const OWNED_PREFIX = 'occ/5eed0000-';
const ownedOcc = (i: number): string => `5eed0000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`;
const IMAGES_PATH = '**/api/coordinator.v1.CatalogService/GetProductImages';
const MEDIA = 'https://images.figurecollecting.com/d';
const ORIGIN_HEADERS = {
  'access-control-allow-origin': '*',
  'cross-origin-resource-policy': 'cross-origin',
  'cache-control': 'public, max-age=31536000, immutable',
  vary: 'Origin',
};
/** A different picture per figure, so the rows can be told apart. */
const CLEAN = new URL('../../src/dev-fixtures/synthetic/clean/', import.meta.url);
const PICTURES = readdirSync(CLEAN)
  .filter((f) => f.endsWith('.png'))
  .sort()
  .map((f) => readFileSync(new URL(f, CLEAN)));
const SHOTS = process.env['SEARCH_THUMBS_SHOTS'];
/** The box a row's photo stands in (src/components/ui/SearchThumb.tsx), CSS px. */
const THUMB = { width: 42, height: 56 };

let state: StackState;
let stack: StackClient;
let USER_A: StackUser;
let HEADS: { headId: string; name: string }[];

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const photo = (head: string) => `${MEDIA}/${sha(`photo:${head}`)}`;
const PICTURE_OF = new Map<string, Buffer>();

async function seed(): Promise<void> {
  const owned = await stack.sync.counts({ user: USER_A.sub, prefix: OWNED_PREFIX });
  if (owned.facets >= OWNED * 2) return;
  const device = await loginDevice({
    origin: state.origin,
    authorizationEndpoint: state.issuer.authorizationEndpoint,
    tokenEndpoint: state.issuer.tokenEndpoint,
    clientId: state.issuer.clientId,
    loginHint: USER_A.email,
  });
  expect((await device.enrol('search-thumb-1 seed')).status).toBe(201);
  const dev = device.deviceId!.replace(/-/g, '');
  const stamp = { edited_at: '2026-10-01T00:00:00.000+00:00', tz: 'UTC' };
  let counter = 0;
  const version = () => `2026-10-01T00:00:00.000000Z#${String(++counter).padStart(10, '0')}#${dev}`;
  for (let start = 0; start < OWNED; start += 100) {
    const events = [];
    for (let i = start; i < start + 100; i++) {
      events.push({ facetKey: `occ/${ownedOcc(i)}/head`, version: version(), op: 'SYNC_OP_UPSERT', payload: JSON.stringify({ head_id: HEADS[i]!.headId, ...stamp }), basis: '' });
      events.push({ facetKey: `occ/${ownedOcc(i)}/status`, version: version(), op: 'SYNC_OP_UPSERT', payload: JSON.stringify({ status: 'owned', ...stamp }), basis: '' });
    }
    const res = await device.connect('coordinator.v1.SyncService', 'Push', { clientId: `search-thumb-seed-${dev}-${start}`, events });
    expect(res.status).toBe(200);
  }
}

test.describe.configure({ mode: 'default' });

test.beforeAll(async () => {
  test.setTimeout(240_000);
  const found = readStackState();
  if (found === undefined) throw new Error('no stack state file: run through playwright.stack.config.ts');
  state = found;
  stack = stackClient(state.controlUrl);
  USER_A = state.users[0]!;
  HEADS = (JSON.parse(readFileSync(state.catalog.file, 'utf8')) as { heads: { headId: string; name: string }[] }).heads;
  HEADS.slice(0, OWNED).forEach((h, i) => PICTURE_OF.set(photo(h.headId), PICTURES[i % PICTURES.length]!));
  await seed();
});

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem('onboarding_complete', '1'));
  await stack.edge.clearFaults();
  await stack.issuer.configure({ accessTokenTtlSeconds: 600, offlineAccess: true });
});

/** GetProductImages as the coordinator answers it (each figure's photo, the primary, with a dominant colour, and a second), paged by rows; every call's heads recorded. */
async function imageLists(page: Page): Promise<string[][]> {
  const calls: string[][] = [];
  await page.route(IMAGES_PATH, async (route) => {
    const req = route.request().postDataJSON() as { headIds: string[]; pageSize?: number; pageToken?: string };
    calls.push(req.headIds);
    const rows = req.headIds.flatMap((head) => [
      { head, row: { derivativeId: sha(`photo:${head}`), role: 'gallery', contentType: 'image/png', primary: true, width: 400, height: 600, url: photo(head), dominantColor: '#5a6b7c' } },
      { head, row: { derivativeId: sha(`second:${head}`), role: 'gallery', contentType: 'image/png', primary: false, width: 400, height: 600, url: `${MEDIA}/${sha(`second:${head}`)}` } },
    ]);
    const size = req.pageSize || 50;
    const at = req.pageToken ? Number(req.pageToken) : 0;
    const products: { headId: string; images: (typeof rows)[number]['row'][] }[] = [];
    for (const { head, row } of rows.slice(at, at + size)) {
      const last = products[products.length - 1];
      if (last?.headId === head) last.images.push(row);
      else products.push({ headId: head, images: [row] });
    }
    const nextPageToken = at + size < rows.length ? String(at + size) : '';
    const body = toJson(GetProductImagesResponseSchema, create(GetProductImagesResponseSchema, { products, nextPageToken }));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return calls;
}

/** The image host: holds every answer until `release`, then answers each figure its own picture. */
async function imageHost(context: BrowserContext): Promise<{ release: () => void; served: string[] }> {
  let release!: () => void;
  const released = new Promise<void>((res) => (release = res));
  const served: string[] = [];
  await context.route(/^https:\/\/images\.figurecollecting\.com\//, async (route) => {
    const url = route.request().url();
    await released;
    try {
      await route.fulfill({ status: 200, body: PICTURE_OF.get(url) ?? PICTURES[0]!, headers: { 'content-type': 'image/png', ...ORIGIN_HEADERS } });
      served.push(url);
    } catch {
      // the page went away
    }
  });
  return { release, served };
}

const authStatus = (page: Page) => page.evaluate(() => window.__fcAuth?.status() ?? 'loading').catch(() => 'navigating');

/** The app signed in as A on Search, with every owned copy on the device; the case view never opened, so nothing is kept. */
async function openSearch(page: Page): Promise<void> {
  await stack.issuer.loginAs(USER_A.sub);
  await page.goto('/discover');
  await page.waitForFunction(() => window.__fcAuth !== undefined && window.__fcSync !== undefined, undefined, { timeout: 30_000 }).catch(() => {
    throw new Error('no window.__fcAuth / __fcSync: the stack must serve dist-stack (npm run build:stack)');
  });
  await expect.poll(() => authStatus(page), { timeout: 30_000 }).toMatch(/^(signed-in|signed-out|reauth-required)$/);
  if ((await authStatus(page)) !== 'signed-in') {
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect.poll(() => authStatus(page), { timeout: 30_000 }).toBe('signed-in');
  }
  await expect
    .poll(async () => (await page.evaluate(() => window.__fcSync!.copies())).filter((c) => c.occ_id.startsWith(OWNED_PREFIX.slice(4)) && c.shown_in !== null).length, {
      timeout: 180_000,
    })
    .toBe(OWNED);
  if (!page.url().endsWith('/discover')) await page.goto('/discover');
  await expect(page.getByPlaceholder(/search your figures/i)).toBeVisible({ timeout: 30_000 });
}

/** Each local row's box and its photo box, CSS px. */
const geometry = (page: Page) =>
  page.locator('ul[aria-label="Search results"] > li').evaluateAll((rows) =>
    rows.map((row) => {
      const r = row.getBoundingClientRect();
      const t = row.querySelector('.search-thumb')!.getBoundingClientRect();
      return { top: Math.round(r.top), height: Math.round(r.height), thumb: { left: Math.round(t.left - r.left), width: Math.round(t.width), height: Math.round(t.height) } };
    }),
  );

async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const panel = SHOT_VIEWPORTS.find((v) => testInfo.project.name.endsWith(v.name.replace(/-full$/, '')))!;
  await page.waitForTimeout(300);
  const png = await signoffShot(page, testInfo, name);
  expect(shotSizeError(png, panel.png), png.path).toBeUndefined();
  if (SHOTS !== undefined) await page.screenshot({ path: `${SHOTS}/${name}-${panel.name}.png`, scale: 'device', animations: 'disabled', caret: 'hide' });
}

test('search rows start with their figure\'s photo, whole and small, laid out the same before and after it comes, asked once for all of them', async ({ page, context }, testInfo) => {
  test.setTimeout(420_000);
  const calls = await imageLists(page);
  const host = await imageHost(context);
  await openSearch(page);
  const asked = calls.length;
  // シロコ (Shiroko): the stack's catalog names 20 of A's figures so
  await page.getByPlaceholder(/search your figures/i).fill('シロコ');
  const rows = page.locator('ul[aria-label="Search results"] > li');
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });
  const count = await rows.count();
  expect(count, 'a search of 20 rows or more').toBeGreaterThanOrEqual(20);

  // before any photo comes: every row has its box, at its size, at the row's start
  await expect.poll(() => calls.length - asked, { message: 'the rows were asked for' }).toBeGreaterThan(0);
  const before = await geometry(page);
  await shot(page, testInfo, 'search-thumbs-before-photos');
  for (const g of before) {
    expect({ width: g.thumb.width, height: g.thumb.height }).toEqual(THUMB);
    expect(g.thumb.left, 'the box is at the row\'s start').toBeLessThanOrEqual(8);
    expect(g.height, 'a row is a target a finger takes').toBeGreaterThanOrEqual(44);
  }
  console.log(`row height ${before[0]!.height} px, box ${before[0]!.thumb.width} x ${before[0]!.thumb.height} px at ${before[0]!.thumb.left} px from the row's start`);

  host.release();
  const imgs = page.locator('ul[aria-label="Search results"] img.search-thumb__img');
  await expect.poll(() => imgs.evaluateAll((all) => all.filter((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0).length), {
    timeout: 30_000,
    message: 'the rows in view show their photos',
  }).toBeGreaterThanOrEqual(Math.min(count, 6));
  const after = await geometry(page);
  expect(after, 'no row moved or changed size when the photos came').toEqual(before);
  // whole, never cropped: contained in the box
  expect(await imgs.first().evaluate((i) => getComputedStyle(i).objectFit)).toBe('contain');
  expect(await imgs.first().getAttribute('loading')).toBe('lazy');
  // each row its own figure's photo
  const srcs = await imgs.evaluateAll((all) => all.map((i) => (i as HTMLImageElement).getAttribute('src')));
  expect(new Set(srcs).size).toBe(srcs.length);

  // one GetProductImages call for all the rows (2 list rows each: one page of 200), never one a row; the catalog's rows below them,
  // when the catalog answers any, in one more
  const headOf = new Map(HEADS.slice(0, OWNED).map((h) => [photo(h.headId), h.headId]));
  const local = new Set(srcs.map((u) => headOf.get(u!)!));
  const searchCalls = calls.slice(asked);
  const forRows = searchCalls.filter((c) => c.some((h) => local.has(h)));
  console.log(`GetProductImages calls after the search: ${searchCalls.length} (heads per call: ${searchCalls.map((c) => c.length).join(', ')}); for the ${count} rows: ${forRows.length}`);
  expect(forRows, 'the rows were asked in one call').toHaveLength(1);
  expect(new Set(forRows[0])).toEqual(local);
  expect(searchCalls.length, 'the rows and the catalog\'s, at most one call each').toBeLessThanOrEqual(2);
  await shot(page, testInfo, 'search-thumbs-with-photos');
});

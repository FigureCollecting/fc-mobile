// PICK-CASE-1 (Ross 10-31, Fold8 cover, canary): in his Tokisaki Kurumi's Photos sheet he chose photo 3, a back view with no
// cut-out; the sheet marked it in use and said "No cut-out yet: the case shows this photo as it is", and the case went on
// drawing photo 1 as its cut-out, through a switch to the tiles and back. The same morning one of his image list calls
// answered 503 (NEWHOLD-IMG-1).
// On the local full stack: user A's 1,200 owned copies, each figure's GetProductImages answered by a page route (photo 1 the
// primary with a mask, photos 2 and 3 plain), the images from images.figurecollecting.com with the production headers. The
// case keeps photo 1 of a figure in view; then, from the moment the pick is made, every list call answers 503. The figure
// must stand as photo 3, as it is (framed), on the case and on the tiles.
// On 1fb5561 the case drew photo 1's cut-out: a pick reached the case only through a sync that reads every kept figure's
// list again first, and that sync ended at the first list call that failed, before it fetched photo 3.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { create, toJson } from '@bufbuild/protobuf';
import { GetProductImagesResponseSchema } from '@figurecollecting/fc-api-contract';
import { expect, test } from '../fixtures';
import type { BrowserContext, Locator, Page, TestInfo } from '@playwright/test';
import type { E2eHooks } from '../../src/auth/e2eHooks';
import type { SyncHooks } from '../../src/sync/e2eHooks';
import { SHOT_VIEWPORTS } from '../caseViewports';
import { shotSizeError, signoffShot } from '../signoffShots';
import { atRest } from '../sheetRest';
import { touchTap } from '../touch';
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
const JPEG = readFileSync(new URL('./assets/derivative.jpg', import.meta.url));
const MASK = readFileSync(new URL('../../src/dev-fixtures/synthetic/mask/rem.png', import.meta.url));
/** Photo 3, Ross's back view: another picture, so the panel shows which photo stands. */
const BACK = readFileSync(new URL('../../src/dev-fixtures/synthetic/clean/dark-angel.png', import.meta.url));
const ORIGIN_HEADERS = {
  'access-control-allow-origin': '*',
  'cross-origin-resource-policy': 'cross-origin',
  'cache-control': 'public, max-age=31536000, immutable',
  vary: 'Origin',
};
const SHOTS = process.env['PICK_CASE_SHOTS'];

let state: StackState;
let stack: StackClient;
let USER_A: StackUser;
let HEADS: { headId: string }[];

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
/** A figure's three photos: 1 the primary with its mask, 2 and 3 plain (3: Ross's back view). */
const photo = (head: string, n: 1 | 2 | 3) => `${MEDIA}/${sha(`photo${n}:${head}`)}`;
const maskOf = (head: string) => `${MEDIA}/${sha(`mask:${head}`)}`;
const MASKS = new Set<string>();
const BACKS = new Set<string>();

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
  expect((await device.enrol('pick-case-1 seed')).status).toBe(201);
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
    const res = await device.connect('coordinator.v1.SyncService', 'Push', { clientId: `pick-case-seed-${dev}-${start}`, events });
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
  HEADS = (JSON.parse(readFileSync(state.catalog.file, 'utf8')) as { heads: { headId: string }[] }).heads;
  for (const h of HEADS.slice(0, OWNED)) {
    MASKS.add(maskOf(h.headId));
    BACKS.add(photo(h.headId, 3));
  }
  await seed();
});

test.beforeEach(async ({ context }, testInfo) => {
  test.skip(!testInfo.project.name.endsWith('fold8-cover'), 'Ross reported it on the cover panel');
  await context.addInitScript(() => localStorage.setItem('onboarding_complete', '1'));
  await stack.edge.clearFaults();
  await stack.issuer.configure({ accessTokenTtlSeconds: 600, offlineAccess: true });
});

/** GetProductImages as the coordinator answers it, every figure's three photos, paged by rows; 503 once `failing()`. */
async function imageLists(page: Page, failing: () => boolean): Promise<{ calls: () => number; refused: () => number }> {
  let calls = 0;
  let refused = 0;
  await page.route(IMAGES_PATH, async (route) => {
    calls += 1;
    if (failing()) {
      refused += 1;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'unavailable', message: 'upstream answered 503' }) });
      return;
    }
    const req = route.request().postDataJSON() as { headIds: string[]; pageSize?: number; pageToken?: string };
    const rows = req.headIds.flatMap((head) =>
      ([1, 2, 3] as const).map((n) => ({
        head,
        row: {
          derivativeId: photo(head, n).slice(MEDIA.length + 1),
          role: 'gallery',
          contentType: 'image/jpeg',
          primary: n === 1,
          width: 550,
          height: 800,
          url: photo(head, n),
          ...(n === 1 ? { mask: { maskId: maskOf(head).slice(MEDIA.length + 1), contentType: 'image/png', url: maskOf(head) }, bottomMarginFrac: 0.03 } : {}),
        },
      })),
    );
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
  return { calls: () => calls, refused: () => refused };
}

/** The image host, as production serves it; records what it served. */
async function imageHost(context: BrowserContext): Promise<string[]> {
  const served: string[] = [];
  await context.route(/^https:\/\/images\.figurecollecting\.com\//, async (route) => {
    const url = route.request().url();
    const png = MASKS.has(url) ? MASK : BACKS.has(url) ? BACK : undefined;
    try {
      await route.fulfill({ status: 200, body: png ?? JPEG, headers: { 'content-type': png === undefined ? 'image/jpeg' : 'image/png', ...ORIGIN_HEADERS } });
      served.push(url);
    } catch {
      // the page went away, or the sync aborted the fetch
    }
  });
  return served;
}

const authStatus = (page: Page) => page.evaluate(() => window.__fcAuth?.status() ?? 'loading').catch(() => 'navigating');

/** The app signed in as A with every owned copy on the device, on the case view. */
async function openCase(page: Page): Promise<void> {
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
  await expect
    .poll(async () => (await page.evaluate(() => window.__fcSync!.copies())).filter((c) => c.occ_id.startsWith(OWNED_PREFIX.slice(4)) && c.shown_in !== null).length, {
      timeout: 180_000,
    })
    .toBe(OWNED);
  await expect(page.locator('button.cab-figure').first()).toBeVisible({ timeout: 30_000 });
}

/** What the case draws for a figure: its art, and the photo (a cut-out's image, a framed photo's src). */
const drawnOf = (page: Page, id: string) =>
  page.locator(`button.cab-figure[data-figure-id="${id}"]`).evaluate((b) => ({
    art: b.getAttribute('data-art'),
    photo: b.querySelector('.cab-figure__art--masked')?.getAttribute('data-image-url') ?? b.querySelector('img.cab-figure__art')?.getAttribute('src') ?? null,
  }));

/** A figure standing whole in the case's frame, drawn as its photo 1 cut-out. */
async function cutOutInFrame(page: Page): Promise<string> {
  let id: string | undefined;
  await expect
    .poll(
      async () => {
        const frame = (await page.locator('.cabinet-scene').boundingBox())!;
        const figures = page.locator('button.cab-figure');
        for (let i = 0; i < (await figures.count()); i++) {
          const b = await figures.nth(i).boundingBox();
          if (!b || b.y < frame.y || b.y + b.height > frame.y + frame.height || b.x < frame.x || b.x + b.width > frame.x + frame.width) continue;
          const fid = (await figures.nth(i).getAttribute('data-figure-id'))!;
          const d = await drawnOf(page, fid);
          if (d.art === 'masked' && d.photo === photo(fid, 1)) {
            id = fid;
            return true;
          }
        }
        return false;
      },
      { timeout: 120_000, message: 'a figure in the frame stands as its photo 1 cut-out' },
    )
    .toBe(true);
  return id!;
}

const tap = async (page: Page, locator: Locator) => {
  const b = (await locator.boundingBox())!;
  await touchTap(page, b.x + b.width / 2, b.y + b.height / 2);
};

async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const panel = SHOT_VIEWPORTS.find((v) => testInfo.project.name.endsWith(v.name.replace(/-full$/, '')))!;
  await page.waitForTimeout(300);
  const png = await signoffShot(page, testInfo, name);
  expect(shotSizeError(png, panel.png), png.path).toBeUndefined();
  if (SHOTS !== undefined) await page.screenshot({ path: `${SHOTS}/${name}.png`, scale: 'device', animations: 'disabled', caret: 'hide' });
}

test('a photo with no cut-out chosen in the Photos sheet stands in the case as it is, though the lists then answer 503', async ({ page, context }, testInfo) => {
  test.setTimeout(420_000);
  let failing = false;
  const lists = await imageLists(page, () => failing);
  const served = await imageHost(context);
  await openCase(page);
  const id = await cutOutInFrame(page);
  await shot(page, testInfo, 'pick-case-1-before-pick');

  // Info, then its Photos sheet: three photos, the first in use
  await tap(page, page.locator(`button.cab-figure[data-figure-id="${id}"]`));
  const viewer = page.locator('.figure-viewer-sheet');
  await expect(viewer).toBeVisible();
  await atRest(viewer);
  await tap(page, page.getByRole('navigation', { name: 'Figure sections' }).getByRole('button', { name: 'Photos' }));
  const sheet = page.getByRole('dialog', { name: 'Photos' });
  await expect(sheet).toBeVisible();
  await atRest(sheet);
  const tiles = sheet.getByRole('button', { name: /^Photo \d/ });
  await expect(tiles).toHaveCount(3);
  await expect(tiles.nth(0)).toHaveAttribute('aria-label', 'Photo 1 of 3, the default, in use');

  // photo 3, the one with no cut-out; from now on no list is answered
  await tap(page, tiles.nth(2));
  await expect(sheet.getByText('No cut-out yet: the case shows this photo as it is.')).toBeVisible();
  failing = true;
  await tap(page, sheet.getByRole('button', { name: 'Use for me' }));
  await expect(sheet).toHaveCount(0);
  await tap(page, page.locator('.figure-viewer__close'));
  await expect(viewer).toHaveCount(0);

  // the case stands the figure as photo 3, as it is (the panel is shot either way, for the record)
  const notDrawn = await expect
    .poll(() => drawnOf(page, id), { timeout: 20_000, message: 'the case draws the chosen photo, framed' })
    .toEqual({ art: 'framed', photo: photo(id, 3) })
    .then(
      () => undefined,
      (e: unknown) => e,
    );
  await shot(page, testInfo, 'pick-case-1-after-pick');
  if (notDrawn !== undefined) throw notDrawn;
  await expect.poll(() => lists.refused(), { message: 'the lists were asked again after the pick and refused' }).toBeGreaterThan(0);
  expect(served, 'photo 3 came from the image host').toContain(photo(id, 3));

  // Ross's refresh: the tiles and back; the case is drawn again from the start, the figure still as photo 3
  await tap(page, page.locator('button.display-toggle__btn[data-mode="rows"]'));
  await expect(page.locator('button.cab-figure')).toHaveCount(0);
  await tap(page, page.locator('button.display-toggle__btn[data-mode="case"]'));
  await expect.poll(() => drawnOf(page, id), { timeout: 20_000 }).toEqual({ art: 'framed', photo: photo(id, 3) });
});

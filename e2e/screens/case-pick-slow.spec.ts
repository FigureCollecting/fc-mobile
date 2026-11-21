// PICK-SLOW (Ross 11-19, on cellular): "updated an image selection for a displayed figure and it took a looooong time to
// update (scrolled away; when I came back it finally showed the new selection)".
// On the local full stack: user A's 1,200 owned copies, each figure's GetProductImages answered by a page route (photo 1 the
// primary with a mask, photos 2 and 3 plain), the images by a route as production serves them; both through a slow cellular
// link (slowLink.ts: 1.6 Mbit/s down, 150 ms round trip). 30 older choices whose photos are not on the device (a first sync
// on the move not done yet, or evicted), 15 of them ahead of the picked figure in head order. The picked photo was loaded by
// the Photos sheet just before.
// On 3cb6dd6 the case and Info dropped to plates for 1.4-3.0 s at the pick (a new key with no answer while every kept
// figure was read), then drew the old cut-out, and the pick only after every older choice ahead of it in head order was
// downloaded one at a time, then the pick itself again: 25.7 s in this spec. It must stand within PICK_SHOWN_MS, with the
// figure never a plate meanwhile, and the picked photo never asked of the network.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { create, toJson } from '@bufbuild/protobuf';
import { GetProductImagesResponseSchema } from '@figurecollecting/fc-api-contract';
import { expect, test } from '../fixtures';
import type { BrowserContext, Locator, Page } from '@playwright/test';
import type { E2eHooks } from '../../src/auth/e2eHooks';
import type { SyncHooks } from '../../src/sync/e2eHooks';
import { atRest } from '../sheetRest';
import { touchTap } from '../touch';
import { loginDevice } from '../stack/src/device.js';
import { readStackState, stackClient, type StackClient } from '../stack/src/client.js';
import type { StackUser } from '../stack/src/issuer.js';
import type { StackState } from '../stack/src/stack.js';
import { SLOW_CELL, SlowLink } from './slowLink';

declare global {
  interface Window {
    __fcAuth?: E2eHooks;
    __fcSync?: SyncHooks;
  }
}

/**
 * From "Use for me" to the case and Info drawing the pick. With the fix the pick's path asks the network nothing (its bytes
 * come from the sheet's copy on the device); what is left is the query's start and a few cache reads: 0.39-1.1 s over 33
 * runs of an unmasked pick on both cellular profiles. 2 s holds that with room for a loaded runner, and is under the 4.5 s
 * the old path took even with no older choice (one 136 KB download plus two reads of every kept figure).
 */
const PICK_SHOWN_MS = 2000;
const OLDER = 30;
const OWNED = 1200;
const OWNED_PREFIX = 'occ/5eed0000-';
const ownedOcc = (i: number): string => `5eed0000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`;
const IMAGES_PATH = '**/api/coordinator.v1.CatalogService/GetProductImages';
const MEDIA = 'https://images.figurecollecting.com/d';
const JPEG = readFileSync(new URL('./assets/derivative.jpg', import.meta.url));
const MASK = readFileSync(new URL('../../src/dev-fixtures/synthetic/mask/rem.png', import.meta.url));
const ORIGIN_HEADERS = {
  'access-control-allow-origin': '*',
  'cross-origin-resource-policy': 'cross-origin',
  'cache-control': 'public, max-age=31536000, immutable',
  vary: 'Origin',
};
const OWNED_MEDIA = 'fc-owned-media-v1';

let state: StackState;
let stack: StackClient;
let USER_A: StackUser;
let HEADS: string[];
const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const photo = (head: string, n: 1 | 2 | 3) => `${MEDIA}/${sha(`photo${n}:${head}`)}`;
const maskOf = (head: string) => `${MEDIA}/${sha(`mask:${head}`)}`;
const MASKS = new Set<string>();

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
  expect((await device.enrol('pick-slow seed')).status).toBe(201);
  const dev = device.deviceId!.replace(/-/g, '');
  const stamp = { edited_at: '2026-10-01T00:00:00.000+00:00', tz: 'UTC' };
  let counter = 0;
  const version = () => `2026-10-01T00:00:00.000000Z#${String(++counter).padStart(10, '0')}#${dev}`;
  for (let start = 0; start < OWNED; start += 100) {
    const events = [];
    for (let i = start; i < start + 100; i++) {
      events.push({ facetKey: `occ/${ownedOcc(i)}/head`, version: version(), op: 'SYNC_OP_UPSERT', payload: JSON.stringify({ head_id: HEADS[i]!, ...stamp }), basis: '' });
      events.push({ facetKey: `occ/${ownedOcc(i)}/status`, version: version(), op: 'SYNC_OP_UPSERT', payload: JSON.stringify({ status: 'owned', ...stamp }), basis: '' });
    }
    const res = await device.connect('coordinator.v1.SyncService', 'Push', { clientId: `pick-slow-seed-${dev}-${start}`, events });
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
  HEADS = (JSON.parse(readFileSync(state.catalog.file, 'utf8')) as { heads: { headId: string }[] }).heads.map((h) => h.headId);
  for (const h of HEADS.slice(0, OWNED)) MASKS.add(maskOf(h));
  await seed();
});

test.beforeEach(async ({ context }, testInfo) => {
  test.skip(!testInfo.project.name.endsWith('fold8-cover'), 'Ross reported it on the cover panel');
  await context.addInitScript(() => localStorage.setItem('onboarding_complete', '1'));
  await stack.edge.clearFaults();
  await stack.issuer.configure({ accessTokenTtlSeconds: 600, offlineAccess: true });
});

/** GetProductImages as the coordinator answers it, every figure's three photos, paged by rows, through the link. */
async function imageLists(page: Page, link: SlowLink): Promise<void> {
  await page.route(IMAGES_PATH, async (route) => {
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
    const body = JSON.stringify(toJson(GetProductImagesResponseSchema, create(GetProductImagesResponseSchema, { products, nextPageToken })));
    await link.pass(IMAGES_PATH, body.length);
    try {
      await route.fulfill({ status: 200, contentType: 'application/json', body });
    } catch {
      // the page went away, or the sync aborted the call
    }
  });
}

/** The image host, as production serves it, through the link. */
async function imageHost(context: BrowserContext, link: SlowLink): Promise<void> {
  await context.route(/^https:\/\/images\.figurecollecting\.com\//, async (route) => {
    const url = route.request().url();
    const body = MASKS.has(url) ? MASK : JPEG;
    await link.pass(url, body.length);
    try {
      await route.fulfill({ status: 200, body, headers: { 'content-type': MASKS.has(url) ? 'image/png' : 'image/jpeg', ...ORIGIN_HEADERS } });
    } catch {
      // the page went away, or the sync aborted the fetch
    }
  });
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

/** A figure standing whole in the case's frame as its photo 1 cut-out, whose head sorts after `after`. */
async function cutOutInFrame(page: Page, after: string): Promise<string> {
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
          if (fid <= after) continue;
          const d = await drawnOf(page, fid);
          if (d.art === 'masked' && d.photo === photo(fid, 1)) {
            id = fid;
            return true;
          }
        }
        return false;
      },
      { timeout: 180_000, message: 'a figure in the frame stands as its photo 1 cut-out' },
    )
    .toBe(true);
  return id!;
}

const tap = async (page: Page, locator: Locator) => {
  const b = (await locator.boundingBox())!;
  await touchTap(page, b.x + b.width / 2, b.y + b.height / 2);
};

const inOwned = (page: Page, urls: string[]) =>
  page.evaluate(
    async ([name, us]) => {
      const c = await caches.open(name);
      let n = 0;
      for (const u of us) if ((await c.match(u, { ignoreVary: true })) !== undefined) n++;
      return n;
    },
    [OWNED_MEDIA, urls] as const,
  );

test('a pick on a slow cellular link stands in the case and Info at once, never behind older choices still to download', async ({ page, context }) => {
  test.setTimeout(600_000);
  const link = new SlowLink();
  await imageLists(page, link);
  await imageHost(context, link);
  await openCase(page);
  const sorted = HEADS.slice(0, OWNED).slice().sort();
  const id = await cutOutInFrame(page, sorted[OLDER]!);
  const older = sorted.filter((h) => h !== id).slice(0, OLDER);

  // the older choices (photo 3 of each), as another tab of the app writes them, kept by the sync that starts; then their
  // bytes gone from the device, as before a first sync on the move is done
  const olderPhotos = older.map((h) => photo(h, 3));
  await page.evaluate(
    ([sub, heads, urls]) => {
      const key = `fc-photo-choices-v1:${sub}`;
      localStorage.setItem(key, JSON.stringify(Object.fromEntries(heads.map((h, i) => [h, urls[i]]))));
      window.dispatchEvent(new StorageEvent('storage', { key }));
    },
    [USER_A.sub, older, olderPhotos] as const,
  );
  await expect.poll(() => inOwned(page, olderPhotos), { timeout: 300_000 }).toBe(OLDER);
  await page.evaluate(
    async ([name, us]) => {
      const cache = await caches.open(name);
      for (const u of us) await cache.delete(u, { ignoreVary: true });
    },
    [OWNED_MEDIA, olderPhotos] as const,
  );
  expect(await inOwned(page, olderPhotos)).toBe(0);

  // Info, its Photos sheet, photo 2 (plain): the sheet loads it
  // the older choices' sync re-lays the wall: a tap that lands where the figure stood a moment ago is made again
  const viewer = page.locator('.figure-viewer-sheet');
  for (let attempt = 0; ; attempt++) {
    await tap(page, page.locator(`button.cab-figure[data-figure-id="${id}"]`));
    const opened = await atRest(viewer).then(
      () => viewer.isVisible(),
      () => false,
    );
    if (opened) break;
    if (attempt === 2) throw new Error('Info did not open on the figure');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
  }
  await tap(page, page.getByRole('navigation', { name: 'Figure sections' }).getByRole('button', { name: 'Photos' }));
  const sheet = page.getByRole('dialog', { name: 'Photos' });
  await expect(sheet).toBeVisible();
  await atRest(sheet);
  const tiles = sheet.getByRole('button', { name: /^Photo \d/ });
  await expect(tiles).toHaveCount(3);
  await tap(page, tiles.nth(1));
  const picked = photo(id, 2);
  await expect.poll(() => sheet.locator(`img[src="${picked}"]`).evaluate((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0)).toBe(true);

  // from the pick on: the slow link, and what the case and Info draw, frame by frame
  await page.evaluate(
    ([fid, url]) => {
      const w = window as unknown as { __pick: { t0?: number; caseLog: [number, string][]; infoLog: [number, boolean][] } };
      w.__pick = { caseLog: [], infoLog: [] };
      document.addEventListener(
        'click',
        (e) => {
          if ((e.target as Element).closest?.('.photos-sheet__use')) w.__pick.t0 ??= Date.now();
        },
        true,
      );
      let lastCase = '';
      let lastInfo: boolean | undefined;
      const look = () => {
        const b = document.querySelector(`button.cab-figure[data-figure-id="${fid}"]`);
        const shown = b === null ? 'gone' : `${b.getAttribute('data-art')}:${b.querySelector('.cab-figure__art--masked')?.getAttribute('data-image-url') ?? b.querySelector('img.cab-figure__art')?.getAttribute('src') ?? ''}`;
        if (shown !== lastCase) w.__pick.caseLog.push([Date.now(), (lastCase = shown)]);
        const info = [...document.querySelectorAll('.pswp__img')].some((i) => (i as HTMLImageElement).src === url);
        if (info !== lastInfo) w.__pick.infoLog.push([Date.now(), (lastInfo = info)]);
        requestAnimationFrame(look);
      };
      look();
    },
    [id, picked] as const,
  );
  link.profile = SLOW_CELL;
  await tap(page, sheet.getByRole('button', { name: 'Use for me' }));
  await expect(sheet).toHaveCount(0);
  await expect.poll(() => drawnOf(page, id), { timeout: 120_000, message: 'the case draws the pick, framed' }).toEqual({ art: 'framed', photo: picked });
  await page.waitForTimeout(1000);
  const pick = await page.evaluate(() => (window as unknown as { __pick: { t0: number; caseLog: [number, string][]; infoLog: [number, boolean][] } }).__pick);
  const caseLog = pick.caseLog.filter(([t]) => t >= pick.t0).map(([t, s]) => [t - pick.t0, s] as const);
  const infoLog = pick.infoLog.filter(([t]) => t >= pick.t0).map(([t, s]) => [t - pick.t0, s] as const);
  const caseAt = caseLog.find(([, s]) => s === `framed:${picked}`)?.[0];
  // Info showed the photo picked in the sheet until it closed; when it last came to show it (0: it never stopped)
  const infoAt = infoLog.length === 0 ? 0 : infoLog.filter(([, on]) => on).at(-1)?.[0];
  test.info().annotations.push({ type: 'pick-shown-ms', description: JSON.stringify({ caseAt, infoAt, caseLog, infoLog }) });
  expect(caseAt, JSON.stringify(caseLog)).toBeLessThanOrEqual(PICK_SHOWN_MS);
  // never a plate (nor nothing) between the pick and the pick drawn
  expect(caseLog.filter(([t, s]) => t <= caseAt! && !s.startsWith('masked:') && !s.startsWith('framed:')), JSON.stringify(caseLog)).toEqual([]);
  // Info shows the pick within the bound too, and stays on it
  expect(infoAt, JSON.stringify(infoLog)).toBeLessThanOrEqual(PICK_SHOWN_MS);
  expect(infoLog.at(-1)?.[1] ?? pick.infoLog.at(-1)?.[1]).toBe(true);
  // the picked photo came from the sheet's copy on the device, never the network again
  expect(link.passed.map((p) => p.url)).not.toContain(picked);
});

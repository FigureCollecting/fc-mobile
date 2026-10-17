// PINCH-1 on the local full stack (Ross 10-16, after seeing the live cut-outs on his Fold8: "Pinch zoom is very much
// needed so people can look closer and go back to the view's normal quickly and easily"): the case view of user A's
// 1,200 owned copies with their images as production serves them (IMG-SHOW-1's doubles: a 550 x 800 JPEG derivative
// and a PNG mask from images.figurecollecting.com), at the Fold8's cover and open panels, through Chromium's own
// touch pipeline (CDP touch events; two fingers for a pinch):
//   (a) a two-finger pinch zooms toward the midpoint between the fingers: the figure under it stays under it, twice
//       the size, its neighbours pushed out from it; 4x at most; the camera never moves;
//   (b) zoomed, one finger pans the magnified picture up to its edges and never walks the wall or changes cabinets;
//   (c) a double-tap on an empty spot and the Reset view chip each return to 1x with a transition of about 200 ms
//       (at once with reduced motion); the chip sits in the frame's top corner, clear of the tab bar and the tabs;
//       a double-tap at 1x zooms 2x at that point;
//   (d) zoomed, a tap on a figure opens THAT figure, where at 1x the same spot showed something else;
//   (e) a filter picked in Refine, or leaving the case and coming back, starts at 1x;
//   (f) the sign-off shots at 1x, 2x and 4x (the chip showing), and how sharp a cut-out is at 2x and 4x: its art
//       against the same derivative and mask drawn flat at the same size on screen.
// On 1e44dfe9 (develop) the case had no zoom (the scene had no data-zoom, no zoom layer and no chip).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { create, toJson } from '@bufbuild/protobuf';
import { GetProductImagesResponseSchema } from '@figurecollecting/fc-api-contract';
import { expect, test } from '../fixtures';
import type { BrowserContext, Page, TestInfo } from '@playwright/test';
import type { E2eHooks } from '../../src/auth/e2eHooks';
import type { SyncHooks } from '../../src/sync/e2eHooks';
import { decodePng } from '../paintCheck';
import { FOLD8_DPR, SHOT_VIEWPORTS } from '../caseViewports';
import { shotSizeError, signoffShot } from '../signoffShots';
import { touchDoubleTap, touchPinch, touchSwipe, touchTap } from '../touch';
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
/** The derivative's natural size (assets/derivative.jpg, as the image list gives it). */
const DERIVATIVE = { width: 550, height: 800 };
const ORIGIN_HEADERS = {
  'access-control-allow-origin': '*',
  'cross-origin-resource-policy': 'cross-origin',
  'cache-control': 'public, max-age=31536000, immutable',
  vary: 'Origin',
};
/** Where a box is compared on screen: within this many CSS px (a touch lands on device pixels). */
const NEAR_PX = 3;

let state: StackState;
let stack: StackClient;
let USER_A: StackUser;
let HEADS: { headId: string }[];

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const imageId = (head: string) => sha(`derivative:${head}`);
const maskId = (head: string) => sha(`mask:${head}`);
const MASKS = new Set<string>();
/** About half the figures have images, fixed by their head ids (as e2e/screens/case-images.spec.ts). */
const imaged = (head: string): boolean => parseInt(sha(head).slice(0, 2), 16) % 2 === 0;

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
  expect((await device.enrol('pinch-1 seed')).status).toBe(201);
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
    const res = await device.connect('coordinator.v1.SyncService', 'Push', { clientId: `wk15-seed-${dev}-${start}`, events });
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
  for (const h of HEADS.slice(0, OWNED)) MASKS.add(maskId(h.headId));
  await seed();
});

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem('onboarding_complete', '1'));
  await stack.edge.clearFaults();
  await stack.issuer.configure({ accessTokenTtlSeconds: 600, offlineAccess: true });
});

// ------------------------------------------------------------------ the doubles (IMG-SHOW-1's)

const rowsOf = (head: string) => [
  {
    derivativeId: imageId(head),
    role: 'gallery',
    contentType: 'image/jpeg',
    width: DERIVATIVE.width,
    height: DERIVATIVE.height,
    url: `${MEDIA}/${imageId(head)}`,
    mask: { maskId: maskId(head), contentType: 'image/png', url: `${MEDIA}/${maskId(head)}` },
    bottomMarginFrac: 0.03,
    contactBand: { centerXFrac: 0.48, widthFrac: 0.6 },
    dominantColor: '#8a9bb0',
  },
];

async function imageLists(page: Page): Promise<void> {
  await page.route(IMAGES_PATH, async (route) => {
    const req = route.request().postDataJSON() as { headIds: string[]; pageSize?: number; pageToken?: string };
    const rows = req.headIds.filter(imaged).flatMap((head) => rowsOf(head).map((row) => ({ head, row })));
    const size = req.pageSize || 50;
    const at = req.pageToken ? Number(req.pageToken) : 0;
    const products: { headId: string; images: ReturnType<typeof rowsOf> }[] = [];
    for (const { head, row } of rows.slice(at, at + size)) {
      const last = products[products.length - 1];
      if (last?.headId === head) last.images.push(row);
      else products.push({ headId: head, images: [row] });
    }
    const nextPageToken = at + size < rows.length ? String(at + size) : '';
    const body = toJson(GetProductImagesResponseSchema, create(GetProductImagesResponseSchema, { products, nextPageToken }));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

async function imageHost(context: BrowserContext): Promise<void> {
  await context.route(/^https:\/\/images\.figurecollecting\.com\//, async (route) => {
    const url = route.request().url();
    const mask = MASKS.has(url.slice(url.lastIndexOf('/') + 1));
    try {
      await route.fulfill({ status: 200, body: mask ? MASK : JPEG, headers: { 'content-type': mask ? 'image/png' : 'image/jpeg', ...ORIGIN_HEADERS } });
    } catch {
      // the page went away
    }
  });
}

// ------------------------------------------------------------------ helpers

const authStatus = (page: Page) => page.evaluate(() => window.__fcAuth?.status() ?? 'loading').catch(() => 'navigating');

/** The app signed in as A with every owned copy on the device, on the case view, with cut-outs drawn. */
async function openCase(context: BrowserContext, page: Page): Promise<void> {
  await imageHost(context);
  await imageLists(page);
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
  await expect.poll(async () => (await cutOuts(page)).length, { timeout: 120_000 }).toBeGreaterThanOrEqual(4);
  // the 4 s splash takes the touches until it goes
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 15_000 });
  await settledWall(page);
}

/**
 * Wait for a settled wall: the packed wall (data-wall), the figures drawn and the cut-outs among them the same across
 * two animation frames, and still the same a second later. While pictures land the wall re-packs (428 to 416 cabinets
 * at the open panel), and a pinch measured across a re-pack misplaces every figure.
 */
async function settledWall(page: Page): Promise<void> {
  const signature = () =>
    page.locator('.cabinet-scene').evaluate(async (scene) => {
      const read = () => {
        const d = (scene as HTMLElement).dataset;
        const cut = scene.querySelectorAll('button.cab-figure[data-art="masked"][data-grounded="1"]').length;
        return `${d.wall}|${d.drawnFigures}|${cut}`;
      };
      const before = read();
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      return before === read() ? before : null;
    });
  let last: string | null = null;
  let since = Date.now();
  await expect
    .poll(
      async () => {
        const now = await signature();
        if (now === null || now !== last) {
          last = now;
          since = Date.now();
          return false;
        }
        return Date.now() - since >= 1_000;
      },
      { timeout: 120_000, intervals: [250], message: 'a settled wall' },
    )
    .toBe(true);
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface Zoom {
  k: number;
  x: number;
  y: number;
}
const centre = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const inside = (b: Box, f: Box, margin = 0) => b.x >= f.x + margin && b.y >= f.y + margin && b.x + b.width <= f.x + f.width - margin && b.y + b.height <= f.y + f.height - margin;
const meets = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The scene's zoom (PINCH-1's data-zoom); NaN where the scene has none (develop). */
async function zoomOf(page: Page): Promise<Zoom> {
  const z = await page.locator('.cabinet-scene').getAttribute('data-zoom');
  return z === null ? { k: Number.NaN, x: Number.NaN, y: Number.NaN } : (JSON.parse(z) as Zoom);
}

/** What a zoom must never change: the camera, the walk, the pan, the cull and the drawn cabinets. */
const still = (page: Page) =>
  page.locator('.cabinet-scene').evaluate((el) => {
    const d = (el as HTMLElement).dataset;
    return { camera: d.camera, focus: d.focus, pan: d.pan, panY: d.panY, cullX: d.cullX, cullPan: d.cullPan, view: d.view };
  });

const frameBox = async (page: Page): Promise<Box> => (await page.locator('.cabinet-scene__frame').boundingBox())!;

interface Drawn {
  id: string;
  name: string;
  /** Its tap box (the button) and its picture's box, on screen. */
  tap: Box;
  art: Box;
}

/** Every figure drawn as its cut-out (masked, grounded, its derivative loaded), with its boxes on screen. */
const cutOuts = (page: Page): Promise<Drawn[]> =>
  page.locator('button.cab-figure').evaluateAll((buttons) =>
    buttons.flatMap((b) => {
      const art = b.querySelector('.cab-figure__art--masked');
      if (b.getAttribute('data-art') !== 'masked' || b.getAttribute('data-grounded') !== '1' || art === null) return [];
      const box = (r: DOMRect) => ({ x: r.x, y: r.y, width: r.width, height: r.height });
      return [{ id: b.getAttribute('data-figure-id')!, name: b.getAttribute('aria-label')!, tap: box(b.getBoundingClientRect()), art: box(b.querySelector('.cab-figure__box')!.getBoundingClientRect()) }];
    }),
  );

/** The cut-out whose tap box sits nearest the frame's centre, wholly inside the frame by `margin`. */
async function central(page: Page, margin = 24): Promise<Drawn> {
  const frame = await frameBox(page);
  const mid = centre(frame);
  const all = (await cutOuts(page)).filter((d) => inside(d.tap, frame, margin) && d.tap.height >= 24);
  expect(all.length, 'a cut-out inside the frame').toBeGreaterThan(0);
  const away = (d: Drawn) => Math.hypot(centre(d.tap).x - mid.x, centre(d.tap).y - mid.y);
  return all.sort((a, b) => away(a) - away(b))[0]!;
}

/** Spread two fingers about m from `from` to `to` px apart, sideways: a zoom of to / from. */
async function pinchAbout(page: Page, m: { x: number; y: number }, from: number, to: number): Promise<void> {
  await touchPinch(page, { x: m.x - from / 2, y: m.y }, { x: m.x + from / 2, y: m.y }, { x: m.x - to / 2, y: m.y }, { x: m.x + to / 2, y: m.y });
  // let go: the layer is no longer promoted, and rasters again at its zoom
  await expect(page.locator('.cabinet-scene__zoom--live')).toHaveCount(0);
}

/** A point of the frame where a tap lands on no figure and no control: the room. */
async function emptySpot(page: Page): Promise<{ x: number; y: number }> {
  const frame = await frameBox(page);
  const spot = await page.evaluate((f) => {
    for (let fy = 0.08; fy < 0.95; fy += 0.04) {
      for (let fx = 0.3; fx < 0.75; fx += 0.04) {
        const x = f.x + f.width * fx;
        const y = f.y + f.height * fy;
        const hit = document.elementFromPoint(x, y);
        if (hit?.closest('.cabinet-scene__frame') && !hit.closest('button, a, details')) return { x, y };
      }
    }
    return null;
  }, frame);
  expect(spot, 'an empty spot in the frame').not.toBeNull();
  return spot!;
}

/** Record the zoom layer's transform transitions from now: when each began and ended (ms). */
const watchTransitions = (page: Page) =>
  page.locator('.cabinet-scene__zoom').evaluate((layer) => {
    const w = window as unknown as { __zoomTransitions: { run: number[]; end: number[] } };
    const first = w.__zoomTransitions === undefined;
    w.__zoomTransitions = { run: [], end: [] };
    if (!first) return;
    layer.addEventListener('transitionrun', (e) => (e as TransitionEvent).propertyName === 'transform' && w.__zoomTransitions.run.push(performance.now()));
    layer.addEventListener('transitionend', (e) => (e as TransitionEvent).propertyName === 'transform' && w.__zoomTransitions.end.push(performance.now()));
  });
const transitions = (page: Page) => page.evaluate(() => (window as unknown as { __zoomTransitions: { run: number[]; end: number[] } }).__zoomTransitions);

interface ScaleSamples {
  from: number;
  samples: { t: number; k: number }[];
}
/** Sample the zoom layer's drawn scale every frame from now (ms on the page clock; 1 with no transform), for at most 600 frames. */
const watchScale = (page: Page) =>
  page.locator('.cabinet-scene__zoom').evaluate((layer) => {
    const w = window as unknown as { __zoomScale: ScaleSamples };
    const mine: ScaleSamples = { from: performance.now(), samples: [] };
    w.__zoomScale = mine;
    const frame = () => {
      if (w.__zoomScale !== mine) return;
      const m = getComputedStyle(layer).transform;
      mine.samples.push({ t: performance.now(), k: m === 'none' ? 1 : new DOMMatrixReadOnly(m).a });
      if (mine.samples.length < 600) requestAnimationFrame(frame);
    };
    frame();
  });
const scaleSamples = (page: Page) => page.evaluate(() => (window as unknown as { __zoomScale: ScaleSamples }).__zoomScale);
/** Frames drawn strictly between 1x and `start`: the reset animated rather than jumped. */
const between = (s: ScaleSamples, start: number) => s.samples.filter((f) => f.k > 1 + 1e-3 && f.k < start - 1e-3);
const layerTransform = (page: Page) => page.locator('.cabinet-scene__zoom').evaluate((l) => getComputedStyle(l).transform);

async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const panel = SHOT_VIEWPORTS.find((v) => testInfo.project.name.endsWith(v.name.replace(/-full$/, '')))!;
  await page.waitForTimeout(300);
  const png = await signoffShot(page, testInfo, name);
  expect(shotSizeError(png, panel.png), png.path).toBeUndefined();
}

const opened = (page: Page) => page.locator('.detail-pane, .figure-viewer-sheet');

// ------------------------------------------------------------------ (a)

test('(a) a two-finger pinch zooms toward the midpoint between the fingers, 4x at most; the camera never moves', async ({ context, page }) => {
  test.setTimeout(240_000);
  await openCase(context, page);
  const before = await still(page);
  const target = await central(page);
  const m = centre(target.tap);
  const others = (await cutOuts(page)).filter((d) => d.id !== target.id);

  await pinchAbout(page, m, 40, 80);
  const z = await zoomOf(page);
  expect(z.k).toBeCloseTo(2, 1);
  const now = new Map((await cutOuts(page)).map((d) => [d.id, d]));
  // the figure under the fingers' midpoint stays under it, twice the size
  const under = now.get(target.id)!;
  expect(Math.abs(centre(under.tap).x - m.x)).toBeLessThanOrEqual(NEAR_PX);
  expect(Math.abs(centre(under.tap).y - m.y)).toBeLessThanOrEqual(NEAR_PX);
  expect(under.tap.width / target.tap.width).toBeCloseTo(z.k, 1);
  // its neighbours are pushed out from it: each at m + k (c - m)
  const moved = others.filter((d) => now.has(d.id)).slice(0, 6);
  expect(moved.length).toBeGreaterThan(0);
  for (const d of moved) {
    const c0 = centre(d.tap);
    const c1 = centre(now.get(d.id)!.tap);
    expect(Math.abs(c1.x - (m.x + z.k * (c0.x - m.x))), d.name).toBeLessThanOrEqual(NEAR_PX);
    expect(Math.abs(c1.y - (m.y + z.k * (c0.y - m.y))), d.name).toBeLessThanOrEqual(NEAR_PX);
  }
  expect(await still(page)).toEqual(before);
  await expect(page.getByRole('button', { name: 'Reset view' })).toBeVisible();

  // twice again is 4x; past it, still 4x
  await pinchAbout(page, m, 40, 80);
  expect((await zoomOf(page)).k).toBeCloseTo(4, 1);
  await pinchAbout(page, m, 20, 120);
  expect((await zoomOf(page)).k).toBe(4);
  expect(await still(page)).toEqual(before);
  await expect(opened(page)).toHaveCount(0);
});

// ------------------------------------------------------------------ (b)

test('(b) zoomed, one finger pans the magnified picture to its edges and never walks the wall or changes cabinets', async ({ context, page }) => {
  test.setTimeout(240_000);
  await openCase(context, page);
  const frame = await frameBox(page);
  const before = await still(page);
  const mid = centre(frame);
  await pinchAbout(page, mid, 40, 100);
  const z0 = await zoomOf(page);
  expect(z0.k).toBeCloseTo(2.5, 1);

  await touchSwipe(page, mid.x + 60, mid.y, -120, 0);
  const z1 = await zoomOf(page);
  expect(z1.k).toBe(z0.k);
  expect(z1.x - z0.x).toBeCloseTo(-120, 0);
  expect(z1.y).toBeCloseTo(z0.y, 0);
  // far right, then far down: the picture's corners stop at the frame's
  for (let i = 0; i < 4; i++) await touchSwipe(page, frame.x + 30, mid.y, frame.width * 0.8, 0);
  for (let i = 0; i < 4; i++) await touchSwipe(page, mid.x, frame.y + 30, 0, frame.height * 0.8);
  expect(await zoomOf(page)).toEqual({ k: z0.k, x: 0, y: 0 });
  // far left and up
  for (let i = 0; i < 6; i++) await touchSwipe(page, frame.x + frame.width - 30, mid.y, -frame.width * 0.8, 0);
  for (let i = 0; i < 6; i++) await touchSwipe(page, mid.x, frame.y + frame.height - 30, 0, -frame.height * 0.8);
  const end = await zoomOf(page);
  expect(end.x).toBeCloseTo(frame.width * (1 - z0.k), 0);
  expect(end.y).toBeCloseTo(frame.height * (1 - z0.k), 0);
  // the magnified picture still covers the frame
  const layer = (await page.locator('.cabinet-scene__zoom').boundingBox())!;
  expect(layer.x).toBeLessThanOrEqual(frame.x + 0.5);
  expect(layer.y).toBeLessThanOrEqual(frame.y + 0.5);
  expect(layer.x + layer.width).toBeGreaterThanOrEqual(frame.x + frame.width - 0.5);
  expect(layer.y + layer.height).toBeGreaterThanOrEqual(frame.y + frame.height - 0.5);
  // no walk, no cabinet change, no lift, no pan of the wall, and no figure opened by a swipe
  expect(await still(page)).toEqual(before);
  await expect(opened(page)).toHaveCount(0);
});

// ------------------------------------------------------------------ (c)

test('(c) a double-tap on an empty spot and the Reset view chip each return to 1x, animated; a double-tap at 1x zooms 2x there', async ({ context, page }) => {
  test.setTimeout(240_000);
  await openCase(context, page);
  const frame = await frameBox(page);
  const mid = centre(frame);
  await pinchAbout(page, mid, 40, 100);
  expect((await zoomOf(page)).k).toBeCloseTo(2.5, 1);

  // the double-tap: back to 1x through a transition (about 200 ms; its measured length on a loaded runner ranged
  // 140 to 419 ms, so it is held to finishing within 1 s and to drawing at least one frame between the two scales)
  const spot = await emptySpot(page);
  const start = (await zoomOf(page)).k;
  await watchTransitions(page);
  await watchScale(page);
  await touchDoubleTap(page, spot.x, spot.y);
  expect(await zoomOf(page)).toEqual({ k: 1, x: 0, y: 0 });
  await expect.poll(async () => (await transitions(page)).end.length, { timeout: 2_000 }).toBe(1);
  expect((await transitions(page)).run).toHaveLength(1);
  const drawn = await scaleSamples(page);
  const back = drawn.samples.find((f) => f.k === 1);
  expect(back, 'drawn back at exactly 1x').toBeDefined();
  expect(back!.t - drawn.from, 'back at 1x within 1 s of the double-tap').toBeLessThanOrEqual(1_000);
  expect(between(drawn, start).length, 'a frame between: animated, not instant').toBeGreaterThan(0);
  expect(await layerTransform(page)).toBe('none');
  await expect(page.getByRole('button', { name: 'Reset view' })).toHaveCount(0);

  // the chip: in the frame's top corner, clear of the tab bar, the pull-up tabs and the cabinet steps
  await pinchAbout(page, mid, 40, 100);
  const chip = page.getByRole('button', { name: 'Reset view' });
  await expect(chip).toBeVisible();
  const c = (await chip.boundingBox())!;
  expect(inside(c, frame)).toBe(true);
  expect(c.y - frame.y).toBeLessThanOrEqual(12);
  expect(frame.x + frame.width - (c.x + c.width)).toBeLessThanOrEqual(60);
  for (const clear of ['.tab-bar', '.case-tabs', '.cabinet-scene__step:not(:disabled)', '.cabinet-scene__shelves', '.cabinet-scene__fit summary']) {
    for (const box of await page.locator(clear).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as Box))) {
      expect(meets(c, box), `the chip meets ${clear}`).toBe(false);
    }
  }
  await watchTransitions(page);
  await touchTap(page, c.x + c.width / 2, c.y + c.height / 2);
  expect(await zoomOf(page)).toEqual({ k: 1, x: 0, y: 0 });
  await expect.poll(async () => (await transitions(page)).end.length, { timeout: 2_000 }).toBe(1);
  await expect(chip).toHaveCount(0);
  await expect(opened(page)).toHaveCount(0);

  // at 1x, a double-tap zooms 2x at the tapped point: the point stays where it was
  const at = await emptySpot(page);
  await touchDoubleTap(page, at.x, at.y);
  const z = await zoomOf(page);
  expect(z.k).toBe(2);
  expect(z.x).toBeCloseTo(-(at.x - frame.x), 0);
  expect(z.y).toBeCloseTo(-(at.y - frame.y), 0);
  await expect(chip).toBeVisible();
});

test('(c) with reduced motion the double-tap and the chip return to 1x at once, with no transition', async ({ context, page }, testInfo) => {
  test.skip(!testInfo.project.name.endsWith('cover'), 'one panel is enough: (c) covers the animation at both');
  test.setTimeout(240_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openCase(context, page);
  const mid = centre(await frameBox(page));
  await pinchAbout(page, mid, 40, 100);
  const spot = await emptySpot(page);
  const start = (await zoomOf(page)).k;
  await watchTransitions(page);
  await watchScale(page);
  await touchDoubleTap(page, spot.x, spot.y);
  expect(await layerTransform(page)).toBe('none');
  // instant: no frame drawn between the two scales
  expect(between(await scaleSamples(page), start)).toEqual([]);
  await pinchAbout(page, mid, 40, 100);
  const chip = centre((await page.getByRole('button', { name: 'Reset view' }).boundingBox())!);
  await touchTap(page, chip.x, chip.y);
  expect(await layerTransform(page)).toBe('none');
  await page.waitForTimeout(400);
  expect(await transitions(page)).toEqual({ run: [], end: [] });
  expect((await zoomOf(page)).k).toBe(1);
});

// ------------------------------------------------------------------ (d)

test('(d) zoomed, a tap on a figure opens THAT figure, where at 1x the same spot showed something else', async ({ context, page }) => {
  test.setTimeout(240_000);
  await openCase(context, page);
  const frame = await frameBox(page);
  const at1x = new Map((await cutOuts(page)).map((d) => [d.id, d]));
  const m = centre((await central(page)).tap);
  await pinchAbout(page, { x: m.x - 30, y: m.y }, 40, 120);
  expect((await zoomOf(page)).k).toBeCloseTo(3, 1);

  // a figure the zoom brought to where, at 1x, it was not; the browser's own hit test finds it there
  const hitAt = (p: { x: number; y: number }) =>
    page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button.cab-figure')?.getAttribute('data-figure-id') ?? null, p);
  let pick: { d: Drawn; p: { x: number; y: number } } | undefined;
  for (const d of (await cutOuts(page)).filter((x) => inside(x.tap, frame, 8))) {
    const p = centre(d.tap);
    const was = at1x.get(d.id);
    if (was && inside({ ...p, width: 0, height: 0 }, was.tap)) continue;
    if ((await hitAt(p)) === d.id) {
      pick = { d, p };
      break;
    }
  }
  expect(pick, 'a figure moved by the zoom, under its own centre').toBeDefined();
  const { d, p } = pick!;
  // at 1x that spot held another figure or none: tapped there, it is THIS one that opens
  await touchTap(page, p.x, p.y);
  await expect(opened(page)).toBeVisible();
  await expect(opened(page)).toContainText(d.name);
});

// ------------------------------------------------------------------ (e)

test('(e) a filter picked in Refine starts the picture at 1x, and so does leaving the case and coming back', async ({ context, page }) => {
  test.setTimeout(240_000);
  await openCase(context, page);
  const mid = centre(await frameBox(page));
  await pinchAbout(page, mid, 40, 100);
  expect((await zoomOf(page)).k).toBeCloseTo(2.5, 1);

  // Refine: Wished too (SHEETS-FB1: it applies at once), then Done
  await page.locator('.case-tabs__tab[data-tab="refine"]').tap();
  await page.getByRole('group', { name: 'Holding' }).getByRole('button', { name: /^Wished/ }).tap();
  await page.getByRole('button', { name: 'Done' }).tap();
  await expect(page.locator('.detent-sheet')).toHaveCount(0);
  await expect(page.locator('button.cab-figure').first()).toBeVisible();
  expect(await zoomOf(page)).toEqual({ k: 1, x: 0, y: 0 });
  await expect(page.getByRole('button', { name: 'Reset view' })).toHaveCount(0);

  // away to Stats and back
  await pinchAbout(page, mid, 40, 100);
  expect((await zoomOf(page)).k).toBeCloseTo(2.5, 1);
  await page.evaluate(() => {
    history.pushState(null, '', '/stats');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.locator('.cabinet-scene')).toHaveCount(0);
  await page.evaluate(() => {
    history.back();
  });
  await expect(page.locator('button.cab-figure').first()).toBeVisible({ timeout: 30_000 });
  expect(await zoomOf(page)).toEqual({ k: 1, x: 0, y: 0 });
});

// ------------------------------------------------------------------ (f)

/**
 * How crisp a picture's edges are: the 99th percentile of the Sobel gradient of its grey levels, so its strongest
 * edges (a figure's outline, its dress against its coat) and not the derivative's grain. A picture magnified from a
 * coarser raster spreads each edge over more device pixels and lowers it.
 */
function edges(png: Buffer): number {
  const img = decodePng(png);
  const w = img.width;
  const g = new Float64Array(w * img.height);
  for (let i = 0; i < g.length; i++) g[i] = 0.299 * img.data[i * 4]! + 0.587 * img.data[i * 4 + 1]! + 0.114 * img.data[i * 4 + 2]!;
  const mags: number[] = [];
  for (let y = 1; y < img.height - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = g[i - w + 1]! + 2 * g[i + 1]! + g[i + w + 1]! - g[i - w - 1]! - 2 * g[i - 1]! - g[i + w - 1]!;
      const gy = g[i + w - 1]! + 2 * g[i + w]! + g[i + w + 1]! - g[i - w - 1]! - 2 * g[i - w]! - g[i - w + 1]!;
      mags.push(Math.hypot(gx, gy));
    }
  }
  mags.sort((a, b) => a - b);
  return mags[Math.floor(0.99 * (mags.length - 1))]!;
}

/**
 * How sharp a cut-out's art is at the zoom: the middle of its picture box on screen, shot as the case draws it and
 * as the same derivative and mask draw flat over it at the same size (the sharpest that derivative gives there);
 * and how many device pixels each pixel of the derivative takes there (over 1, the derivative itself runs short).
 */
async function sharpness(page: Page, d: Drawn): Promise<{ boxCssPx: number; devicePxPerImagePx: number; case: number; flat: number; ratio: number }> {
  const art = page.locator(`button.cab-figure[data-figure-id="${d.id}"] .cab-figure__box`);
  const box = (await art.boundingBox())!;
  const clip = { x: box.x + box.width * 0.25, y: box.y + box.height * 0.2, width: box.width * 0.5, height: box.height * 0.6 };
  const drawn = await page.screenshot({ clip, scale: 'device', animations: 'disabled' });
  await page.evaluate(
    ({ id, b }) => {
      const src = document.querySelector(`button.cab-figure[data-figure-id="${id}"] .cab-figure__art--masked`) as HTMLElement;
      const flat = document.createElement('div');
      flat.id = 'pinch-flat';
      Object.assign(flat.style, {
        position: 'fixed',
        left: `${b.x}px`,
        top: `${b.y}px`,
        width: `${b.width}px`,
        height: `${b.height}px`,
        zIndex: '2147483647',
        background: '#0b0c0f',
      });
      const pic = document.createElement('div');
      Object.assign(pic.style, {
        width: '100%',
        height: '100%',
        backgroundImage: src.style.backgroundImage,
        backgroundSize: '100% 100%',
        maskImage: src.style.maskImage,
        maskSize: '100% 100%',
        webkitMaskImage: src.style.maskImage,
        webkitMaskSize: '100% 100%',
      });
      flat.append(pic);
      document.body.append(flat);
    },
    { id: d.id, b: box },
  );
  await page.waitForTimeout(200);
  const ref = await page.screenshot({ clip, scale: 'device', animations: 'disabled' });
  await page.evaluate(() => document.getElementById('pinch-flat')?.remove());
  const caseEdges = edges(drawn);
  const flatEdges = edges(ref);
  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    boxCssPx: round(box.height),
    devicePxPerImagePx: round((box.height * FOLD8_DPR) / DERIVATIVE.height),
    case: round(caseEdges),
    flat: round(flatEdges),
    ratio: round(caseEdges / flatEdges),
  };
}

/** The case scene's composited layers, in viewports of pixels (CDP LayerTree, as e2e/case-budget.spec.ts reads them). */
async function sceneLayerViewports(page: Page): Promise<number> {
  const cdp = await page.context().newCDPSession(page);
  try {
    type Layer = { backendNodeId?: number; width: number; height: number; drawsContent: boolean };
    // the first tree after LayerTree.enable can come before the frame is committed, with almost nothing drawing:
    // of the trees a few frames bring, the one with the most drawing layers
    const trees: Layer[][] = [];
    const drawing = (ls: Layer[]) => ls.filter((l) => l.drawsContent && l.backendNodeId !== undefined);
    cdp.on('LayerTree.layerTreeDidChange', (e: { layers?: Layer[] }) => e.layers && trees.push(drawing(e.layers)));
    await cdp.send('LayerTree.enable');
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await expect.poll(() => trees.length, { timeout: 10_000, message: 'a LayerTree.layerTreeDidChange' }).toBeGreaterThan(0);
    await page.waitForTimeout(300);
    const layers = trees.reduce((a, b) => (b.length > a.length ? b : a));
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeIds: inScene } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '.cabinet-scene, .cabinet-scene *' });
    const { nodeIds } = await cdp.send('DOM.pushNodesByBackendIdsToFrontend', { backendNodeIds: layers.map((l) => l.backendNodeId!) });
    const scene = new Set(inScene);
    await cdp.send('LayerTree.disable');
    const area = layers.filter((_, i) => scene.has(nodeIds[i]!)).reduce((a, l) => a + l.width * l.height, 0);
    const viewport = page.viewportSize()!;
    return Math.round((area / (viewport.width * viewport.height)) * 100) / 100;
  } finally {
    await cdp.detach();
  }
}

/** MOB-NAV-2's ceiling on the scene's layers, in viewports of pixels (e2e/case-budget.spec.ts). */
const CEILING_VIEWPORTS = 3;
/**
 * Zoomed, a cut-out's edges stay at least this share as crisp, against the derivative drawn flat at the same size,
 * as at 1x: once a zoom settles its layer is drawn at the zoom's px per mm. Magnified from its 1x layer instead (the
 * zoom's first cut) they kept 0.65 at 2x and 0.40 at 4x on the cover, 0.61 and 0.37 on the open panel.
 */
const KEPT_EDGES = 0.72;

test('(f) the sign-off shots at 1x, 2x and 4x with the chip; a cut-out as sharp zoomed as at 1x, within the layer ceiling', async ({ context, page }, testInfo) => {
  test.setTimeout(300_000);
  await openCase(context, page);
  const target = await central(page, 40);
  const m = centre(target.tap);
  const measured: Record<string, Awaited<ReturnType<typeof sharpness>> & { layerViewports: number }> = {};
  const measure = async (at: string) => {
    await page.waitForTimeout(500);
    measured[at] = { ...(await sharpness(page, target)), layerViewports: await sceneLayerViewports(page) };
  };
  await measure('1x');
  await shot(page, testInfo, 'case-zoom-1x');
  await pinchAbout(page, m, 40, 80);
  await expect(page.getByRole('button', { name: 'Reset view' })).toBeVisible();
  await measure('2x');
  await shot(page, testInfo, 'case-zoom-2x');
  await pinchAbout(page, m, 40, 80);
  expect((await zoomOf(page)).k).toBeCloseTo(4, 1);
  await measure('4x');
  await shot(page, testInfo, 'case-zoom-4x');
  testInfo.annotations.push({ type: 'sharpness', description: JSON.stringify({ figure: target.id, derivative: DERIVATIVE, ...measured }) });
  for (const at of ['2x', '4x']) expect(measured[at]!.ratio / measured['1x']!.ratio, `the edges kept at ${at}`).toBeGreaterThanOrEqual(KEPT_EDGES);
  for (const at of ['1x', '2x', '4x']) expect(measured[at]!.layerViewports, `the scene layers at ${at}`).toBeLessThanOrEqual(CEILING_VIEWPORTS);
});


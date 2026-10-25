// MEM-1 on the local full stack (Ross 10-16, his Fold8 on sha-4d3333b: "As I scroll repeatedly to the right, I started
// having empty cases, then menus ... we need to reclaim/deallocate the memory of figures and mattes that have fully
// scrolled out of view"): the case view of user A's 1,200 owned copies, about 93 % of them with a 550 x 800 JPEG
// derivative and a PNG mask from images.figurecollecting.com (another origin, the production headers), drawn as masked
// cut-outs, at the Fold8's cover and open panels at its device pixel ratio, through Chromium's own touch pipeline. Once
// the sync has kept every image and the wall stands packed, it is walked right swipe by swipe to its far end (a pinch to
// 4x and Reset view on the way), then back to its start. After every swipe the page holds only what the case draws:
//   - the figures drawn are at most the drawn cabinets' cap (data-figure-cap), and the elements that hold a figure's
//     picture (a CSS background or mask, an img) are those figures' own, at most two each;
//   - the case scene's composited layers are at most 3 viewports of pixels (CDP LayerTree, as e2e/case-budget);
//   - after a garbage collection, at most DETACHED_MAX detached DOM nodes are alive (CDP DOM.getDetachedDomNodes), and
//     the DOM's nodes and listeners (CDP Memory.getDOMCounters) are at most GROWTH over what the page holds at that
//     step: its document's nodes at the warm-up's nodes alive per node in the document, and the case scene's own
//     listeners (CDP DOMDebugger.getEventListeners) plus the warm-up's past them; the document outside the scene is at
//     most GROWTH over the warm-up's; back at the start, the DOM is within GROWTH of what the start held.
// The walk draws every cabinet of the packed wall on the way out and again on the way back. At the far end and back at
// the start the chrome is drawn (its ink: e2e/paintCheck), and back at the start the cabinet the walk ends on holds its
// figures, each imaged one standing as its cut-out, the central ones drawing their art.
// What a cabinet holds is the packing's (CASE-FB2b takes shelves out for tall figures, so stretches of the wall draw a
// third more figures than its start), so each bound follows what the page holds at that step and the walk's length the
// wall's cabinets, never a wall of a given shape. Alive per node in the document runs steady along the walk (3.43 to
// 3.60 at both panels on a wall of 109 cabinets), where the DOM's nodes rose up to 17 % past the warm-up's.
// On 4d3333b3 the walk failed at both panels: Preact left the scene's vnode of the collection page's last render in that
// render's JSX with the children it drew then, so every cabinet and figure drawn at that render stayed alive, detached,
// once walked past: on the open panel 8,762 detached nodes five swipes in and 15,351 DOM nodes (7,989 once released),
// on the cover 2,227 detached.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { create, toJson } from '@bufbuild/protobuf';
import { GetProductImagesResponseSchema } from '@figurecollecting/fc-api-contract';
import { expect, test } from '../fixtures';
import type { BrowserContext, Locator, Page, TestInfo } from '@playwright/test';
import type { E2eHooks } from '../../src/auth/e2eHooks';
import type { SyncHooks } from '../../src/sync/e2eHooks';
import { decodePng, inkShare } from '../paintCheck';
import { touchPinch, touchSwipe } from '../touch';
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
const IMAGE_HOST = 'https://images.figurecollecting.com';
const MEDIA = `${IMAGE_HOST}/d`;
const JPEG = readFileSync(new URL('./assets/derivative.jpg', import.meta.url));
const MASK = readFileSync(new URL('../../src/dev-fixtures/synthetic/mask/rem.png', import.meta.url));
/** The production image origin's headers (the canary's, 10-16). */
const ORIGIN_HEADERS = {
  'access-control-allow-origin': '*',
  'cross-origin-resource-policy': 'cross-origin',
  'cache-control': 'public, max-age=31536000, immutable',
  vary: 'Origin',
};

/** The kept images' bytes (src/media/keptImages.ts OWNED_MEDIA_CACHE; that module reads the build's env). */
const OWNED_MEDIA_CACHE = 'fc-owned-media-v1';
/** MOB-NAV-2's ceiling on the scene's layers, in viewports of pixels (e2e/case-budget.spec.ts). */
const CEILING_VIEWPORTS = 3;
/** Detached DOM nodes a garbage collection may leave alive: what the app holds besides the case (measured 2 to 10). */
const DETACHED_MAX = 100;
/** How far the DOM's nodes and listeners may stray past what the page holds at the warm-up's rates, and from the start's on the way back. */
const GROWTH = 0.1;
/** The swipes, the open, and the two after it whose largest DOM for what the page held is the warm-up. */
const WARM_UP = 3;
/** A finger's swipe across this share of the frame: about 7 cabinets on the open panel, 3 on the cover. */
const SWIPE_SHARE = 0.85;
/**
 * NAV-PTR-1 (Ross 10-25): a press on a step arrow (32 px wide, 4 px in from the scene's sides, at mid-height) is the
 * arrow's and never drags the scene, so a swipe starts at least this far (CSS px) in from the frame's sides.
 */
const CLEAR_OF_STEPS_PX = 48;
/** A cut-out is drawn when hiding its art changes at least this share of its box on screen (e2e/screens/case-images). */
const MIN_DRAWN_SHARE = 0.05;
/** A control is drawn when this share of its pixels is off its background (e2e/screens/case-chrome). */
const MIN_INK = 0.01;

let state: StackState;
let stack: StackClient;
let USER_A: StackUser;
let HEADS: { headId: string }[];

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const imageId = (head: string) => sha(`derivative:${head}`);
const maskId = (head: string) => sha(`mask:${head}`);
const MASKS = new Set<string>();
/** Ross's share (10-16): about 93 % of his figures have a derivative and a mask, fixed here by their head ids. */
const imaged = (head: string): boolean => parseInt(sha(head).slice(0, 4), 16) % 100 < 93;

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
  expect((await device.enrol('mem-1 seed')).status).toBe(201);
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
    width: 550,
    height: 800,
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

/**
 * The app signed in as A with every owned copy on the device, on the case view, once the sync has kept every image
 * (their bytes in the kept cache) and the wall stands packed: every picture read, so no cabinet comes or goes.
 */
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
  const kept = 2 * HEADS.slice(0, OWNED).filter((h) => imaged(h.headId)).length;
  await expect
    .poll(() => page.evaluate(async (name) => (await (await caches.open(name)).keys()).length, OWNED_MEDIA_CACHE), { timeout: 180_000, message: 'every image kept' })
    .toBeGreaterThanOrEqual(kept);
  // LAYOUT-FINAL: laid out by every picture once all are read too (kept is not yet read), then the same cabinets three reads
  // running, two seconds apart
  await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-layout-final', '1', { timeout: 180_000 });
  const walls: number[] = [];
  await expect
    .poll(
      async () => {
        walls.push(JSON.parse((await page.locator('.cabinet-scene').getAttribute('data-wall'))!).length);
        return walls.length >= 3 && walls.slice(-3).every((n) => n === walls[walls.length - 1]);
      },
      { timeout: 120_000, intervals: [2000] },
    )
    .toBe(true);
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What the page holds of the case now, read from the DOM: the drawn set, and every element holding a figure's picture. */
const domState = (page: Page) =>
  page.evaluate((host) => {
    const scene = document.querySelector<HTMLElement>('.cabinet-scene')!;
    const figures = scene.querySelectorAll('button.cab-figure');
    let pictures = 0;
    const strays: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const cs = getComputedStyle(el);
      const held = [cs.backgroundImage, cs.maskImage || cs.webkitMaskImage, el instanceof HTMLImageElement ? el.currentSrc || el.src : ''].filter((v) => v.includes(host));
      if (held.length === 0) continue;
      pictures += held.length;
      if (!el.closest('button.cab-figure')) strays.push(`${el.tagName.toLowerCase()}.${el.className}`);
    }
    const count = (root: Node) => {
      let n = 1;
      for (const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL); walker.nextNode(); ) n++;
      return n;
    };
    return {
      /** Every node in the document, and those of the case scene. */
      pageNodes: count(document),
      sceneNodes: count(scene),
      drawnAt: Array.from(scene.querySelectorAll<HTMLElement>('.cab[data-index]'), (c) => Number(c.dataset.index)),
      focus: Number(scene.dataset.focus),
      cameraX: Number(scene.dataset.cameraX),
      cabinets: Number(scene.dataset.drawnCabinets),
      cabinetCap: Number(scene.dataset.drawnCap),
      figures: figures.length,
      figureCap: Number(scene.dataset.figureCap),
      masked: scene.querySelectorAll('.cab-figure__art--masked').length,
      pictures,
      strays,
    };
  }, IMAGE_HOST);

/** The case scene's composited layers, in viewports of pixels (CDP LayerTree, as e2e/case-budget.spec.ts reads them). */
async function sceneLayerViewports(page: Page): Promise<number> {
  const cdp = await page.context().newCDPSession(page);
  try {
    type Layer = { backendNodeId?: number; width: number; height: number; drawsContent: boolean };
    // the first tree after LayerTree.enable can come before the frame is committed: of a few, the one drawing the most
    const trees: Layer[][] = [];
    const drawing = (ls: Layer[]) => ls.filter((l) => l.drawsContent && l.backendNodeId !== undefined);
    cdp.on('LayerTree.layerTreeDidChange', (e: { layers?: Layer[] }) => e.layers && trees.push(drawing(e.layers)));
    await cdp.send('LayerTree.enable');
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await expect.poll(() => trees.length, { timeout: 10_000, message: 'a LayerTree.layerTreeDidChange' }).toBeGreaterThan(0);
    await page.waitForTimeout(150);
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
    // a session of its own: its DOM agent holds every node it bound to an id while it lives
    await cdp.detach();
  }
}

/**
 * After a garbage collection: the DOM's nodes and listeners (Memory.getDOMCounters), the listeners on the case scene and
 * everything in it, and the detached nodes still alive.
 */
async function retained(page: Page): Promise<{ nodes: number; listeners: number; sceneListeners: number; detached: number }> {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('HeapProfiler.collectGarbage');
    const { nodes, jsEventListeners } = await cdp.send('Memory.getDOMCounters');
    const { result: scene } = await cdp.send('Runtime.evaluate', { expression: "document.querySelector('.cabinet-scene')" });
    const { listeners: inScene } = await cdp.send('DOMDebugger.getEventListeners', { objectId: scene.objectId!, depth: -1 });
    await cdp.send('DOM.enable');
    // experimental (Chromium): each detached tree and the nodes it keeps alive
    const { detachedNodes } = await cdp.send('DOM.getDetachedDomNodes');
    return { nodes, listeners: jsEventListeners, sceneListeners: inScene.length, detached: detachedNodes.reduce((n, t) => n + t.retainedNodeIds.length, 0) };
  } finally {
    await cdp.detach();
  }
}

const frameBox = async (page: Page): Promise<Box> => (await page.locator('.cabinet-scene__frame').boundingBox())!;

/** Settled: a swipe's walk lands at once; a zoom's settle takes 200 ms. */
const settle = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 250)))));

/** One finger across SWIPE_SHARE of the frame: from its right to its left walks right (dir 1), the other way left. */
async function walk(page: Page, dir: 1 | -1): Promise<void> {
  const f = await frameBox(page);
  const x = Math.min(f.x + f.width - CLEAR_OF_STEPS_PX, Math.max(f.x + CLEAR_OF_STEPS_PX, f.x + f.width * (0.5 + (dir * SWIPE_SHARE) / 2)));
  await touchSwipe(page, x, f.y + f.height * 0.5, -dir * f.width * SWIPE_SHARE, 0, 10, 16);
  await settle(page);
}

/** A pinch to 2x and on to 4x about the frame's middle, then Reset view: back to 1x. */
async function pinchAndReset(page: Page): Promise<void> {
  const f = await frameBox(page);
  const m = { x: f.x + f.width / 2, y: f.y + f.height * 0.55 };
  for (let i = 0; i < 2; i++) {
    await touchPinch(page, { x: m.x - 20, y: m.y }, { x: m.x + 20, y: m.y }, { x: m.x - 40, y: m.y }, { x: m.x + 40, y: m.y });
    await expect(page.locator('.cabinet-scene__zoom--live')).toHaveCount(0);
    await settle(page);
  }
  await page.getByRole('button', { name: 'Reset view' }).tap();
  await expect(page.getByRole('button', { name: 'Reset view' })).toHaveCount(0);
  await page.waitForTimeout(300);
}

/**
 * The case screen's chrome (e2e/screens/case-chrome), each control by the name Ross would give it, and the step that
 * leads back along the wall from `end` (the one leading past it is disabled there, drawn faint).
 */
function chrome(page: Page, end: 'start' | 'far'): [string, Locator][] {
  return [
    ['the header title', page.locator('.slim-header__context')],
    ['the View tab', page.locator('.case-tabs__tab[data-tab="view"]')],
    ['the Refine tab', page.locator('.case-tabs__tab[data-tab="refine"]')],
    ['Collection (tab bar)', page.getByRole('button', { name: 'Collection', exact: true })],
    ['Search (tab bar)', page.getByRole('button', { name: 'Search', exact: true })],
    ['Profile (tab bar)', page.getByRole('button', { name: 'Profile', exact: true })],
    ['Add figures (+)', page.getByRole('button', { name: 'Add figures' })],
    end === 'far' ? ['Previous cabinet', page.locator('.cabinet-scene__step--prev')] : ['Next cabinet', page.locator('.cabinet-scene__step--next')],
  ];
}

/** The controls the screen does not draw: each in the DOM, at least 8 px of it on screen, with ink where it stands. */
async function undrawn(page: Page, end: 'start' | 'far'): Promise<string[]> {
  const viewport = page.viewportSize()!;
  const out: string[] = [];
  for (const [name, locator] of chrome(page, end)) {
    const box = (await locator.count()) > 0 ? await locator.first().boundingBox() : null;
    if (box === null) {
      out.push(`${name} (missing)`);
      continue;
    }
    const x = Math.max(0, box.x);
    const y = Math.max(0, box.y);
    const width = Math.min(viewport.width, box.x + box.width) - x;
    const height = Math.min(viewport.height, box.y + box.height) - y;
    if (width < 8 || height < 8) out.push(`${name} (off screen)`);
    else if (inkShare(decodePng(await page.screenshot({ clip: { x, y, width, height } }))) < MIN_INK) out.push(name);
  }
  return out;
}

interface Drawn {
  id: string;
  art: string;
  grounded: boolean;
  image: string | null;
  mask: string | null;
  /** The middle of its footprint along the wall (mm), and its tap box on screen. */
  xMm: number;
  tap: Box;
}

const drawn = (page: Page): Promise<Drawn[]> =>
  page.locator('button.cab-figure').evaluateAll((buttons) =>
    buttons.map((b) => {
      const masked = b.querySelector('.cab-figure__art--masked');
      const world = JSON.parse(b.getAttribute('data-world')!) as { x0: number; x1: number };
      const r = b.getBoundingClientRect();
      return {
        id: b.getAttribute('data-figure-id')!,
        art: b.getAttribute('data-art')!,
        grounded: b.getAttribute('data-grounded') === '1',
        image: masked?.getAttribute('data-image-url') ?? null,
        mask: masked?.getAttribute('data-mask-url') ?? null,
        xMm: (world.x0 + world.x1) / 2,
        tap: { x: r.x, y: r.y, width: r.width, height: r.height },
      };
    }),
  );

const cutOut = (d: Drawn): boolean => d.art === 'masked' && d.grounded && d.image === `${MEDIA}/${imageId(d.id)}` && d.mask === `${MEDIA}/${maskId(d.id)}`;

/** The share of pixels that differ between two shots of one box by more than 24 on a channel. */
function changed(a: Buffer, b: Buffer): number {
  const [x, y] = [decodePng(a), decodePng(b)];
  let n = 0;
  for (let i = 0; i < x.data.length; i += 4) {
    if (Math.max(Math.abs(x.data[i]! - y.data[i]!), Math.abs(x.data[i + 1]! - y.data[i + 1]!), Math.abs(x.data[i + 2]! - y.data[i + 2]!)) > 24) n++;
  }
  return n / (x.width * x.height);
}

/** How much of a cut-out's box its art draws on screen: the box shot with the art and without it. */
async function drawnShare(page: Page, id: string): Promise<number | null> {
  const viewport = page.viewportSize()!;
  const art = page.locator(`button.cab-figure[data-figure-id="${id}"] .cab-figure__art`);
  const box = await page.locator(`button.cab-figure[data-figure-id="${id}"] .cab-figure__box`).boundingBox();
  if (box === null) return null;
  const x = Math.max(0, box.x);
  const y = Math.max(0, box.y);
  const clip = { x, y, width: Math.min(viewport.width, box.x + box.width) - x, height: Math.min(viewport.height, box.y + box.height) - y };
  if (clip.width < 12 || clip.height < 12) return null;
  const shown = await page.screenshot({ clip });
  await art.evaluate((el) => ((el as HTMLElement).style.opacity = '0'));
  const hidden = await page.screenshot({ clip });
  await art.evaluate((el) => ((el as HTMLElement).style.opacity = ''));
  return changed(shown, hidden);
}

/** The cabinet the walk ends on (data-focus): what it holds is drawn, each imaged figure as its cut-out, drawing its art. */
async function endCabinet(page: Page): Promise<string[]> {
  const scene = page.locator('.cabinet-scene');
  const focus = Number(await scene.getAttribute('data-focus'));
  const [x0, x1] = (JSON.parse((await scene.getAttribute('data-wall'))!) as number[][])[focus]!;
  const frame = await frameBox(page);
  const mine = (await drawn(page)).filter((d) => d.xMm >= x0! && d.xMm <= x1!);
  const out: string[] = [];
  if (mine.length === 0) out.push(`cabinet ${focus}: no figure drawn`);
  for (const d of mine) if (imaged(d.id) ? !cutOut(d) : d.art !== 'plate') out.push(`${d.id}: ${d.art}${d.grounded ? '' : ' (reading)'}`);
  const mid = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
  const near = mine
    .filter((d) => imaged(d.id) && d.tap.x >= frame.x && d.tap.x + d.tap.width <= frame.x + frame.width && d.tap.height >= 24)
    .sort((a, b) => Math.hypot(a.tap.x - mid.x, a.tap.y - mid.y) - Math.hypot(b.tap.x - mid.x, b.tap.y - mid.y));
  let read = 0;
  for (const d of near) {
    if (read === 4) break;
    const share = await drawnShare(page, d.id);
    if (share === null) continue;
    read++;
    if (share < MIN_DRAWN_SHARE) out.push(`${d.id}: its art draws ${share.toFixed(3)} of its box`);
  }
  if (read === 0) out.push(`cabinet ${focus}: no cut-out to read`);
  return out;
}

interface Step {
  step: number;
  what: string;
  /** ms since the walk began */
  t: number;
  dom: Awaited<ReturnType<typeof domState>>;
  sceneViewports: number;
  nodes: number;
  listeners: number;
  sceneListeners: number;
  detached: number;
}

const began = Date.now();
async function measure(page: Page, step: number, what: string): Promise<Step> {
  const dom = await domState(page);
  const sceneViewports = await sceneLayerViewports(page);
  return { step, what, t: Date.now() - began, dom, sceneViewports, ...(await retained(page)) };
}

/** Everything a step shows past what the case draws. */
function overruns(s: Step): string[] {
  const out: string[] = [];
  const at = `step ${s.step} (${s.what}, cabinet ${s.dom.focus})`;
  if (s.dom.cabinets > s.dom.cabinetCap) out.push(`${at}: ${s.dom.cabinets} cabinets drawn, cap ${s.dom.cabinetCap}`);
  if (s.dom.figures > s.dom.figureCap) out.push(`${at}: ${s.dom.figures} figures drawn, cap ${s.dom.figureCap}`);
  if (s.dom.pictures > 2 * s.dom.figures) out.push(`${at}: ${s.dom.pictures} pictures held for ${s.dom.figures} figures`);
  if (s.dom.strays.length > 0) out.push(`${at}: pictures held outside a drawn figure: ${s.dom.strays.slice(0, 3).join(', ')}`);
  if (s.sceneViewports > CEILING_VIEWPORTS) out.push(`${at}: the scene's layers ${s.sceneViewports} viewports`);
  if (s.detached > DETACHED_MAX) out.push(`${at}: ${s.detached} detached nodes alive after a collection`);
  return out;
}

/** The warm-up's DOM for what its page held, the largest of its steps'. */
interface Rates {
  /** DOM nodes alive per node in the document */
  perNode: number;
  /** nodes in the document outside the case scene */
  outsideScene: number;
  /** DOM listeners past the case scene's own */
  pastScene: number;
}

const ratesOf = (warm: Step[]): Rates => ({
  perNode: Math.max(...warm.map((s) => s.nodes / s.dom.pageNodes)),
  outsideScene: Math.max(...warm.map((s) => s.dom.pageNodes - s.dom.sceneNodes)),
  pastScene: Math.max(...warm.map((s) => s.listeners - s.sceneListeners)),
});

/** A step's DOM past what its page holds, at the warm-up's rates, by more than GROWTH. */
function domOverruns(s: Step, r: Rates): string[] {
  const out: string[] = [];
  const at = `step ${s.step} (${s.what}, cabinet ${s.dom.focus})`;
  const nodes = r.perNode * s.dom.pageNodes * (1 + GROWTH);
  if (s.nodes > nodes) out.push(`${at}: ${s.nodes} DOM nodes for ${s.dom.pageNodes} in the document, over ${Math.round(nodes)}`);
  const outside = s.dom.pageNodes - s.dom.sceneNodes;
  if (outside > r.outsideScene * (1 + GROWTH)) out.push(`${at}: ${outside} nodes in the document outside the case, over ${Math.round(r.outsideScene * (1 + GROWTH))}`);
  const listeners = (r.pastScene + s.sceneListeners) * (1 + GROWTH);
  if (s.listeners > listeners) out.push(`${at}: ${s.listeners} DOM listeners for the case's ${s.sceneListeners}, over ${Math.round(listeners)}`);
  return out;
}

async function attachSteps(testInfo: TestInfo, steps: Step[]): Promise<void> {
  await testInfo.attach('case-memory steps', {
    body: JSON.stringify(steps.map((s) => ({ ...s, dom: { ...s.dom, strays: s.dom.strays.length } })), null, 1),
    contentType: 'application/json',
  });
}

test('walking the wall end to end and back keeps only what the case draws, the chrome and the cut-outs drawn', async ({ context, page }, testInfo) => {
  test.setTimeout(900_000);
  await openCase(context, page);
  const scene = page.locator('.cabinet-scene');
  const at = async () => Number(await scene.getAttribute('data-camera-x'));
  const lastIndex = JSON.parse((await scene.getAttribute('data-wall'))!).length - 1;
  // from the wall's start: the stop a walk back left lands on (the case opens framed a little way in)
  await walk(page, -1);
  const start = await at();
  const steps: Step[] = [await measure(page, 0, 'at the start')];
  const failures: string[] = overruns(steps[0]!);
  let rates: Rates | undefined;

  // out to the far end, a pinch on the way, then back to the start, each swipe a step
  let pinched = false;
  let lastDrawn = false;
  for (const dir of [1, -1] as const) {
    for (let moved = true; moved; ) {
      const before = await at();
      await walk(page, dir);
      let what = dir > 0 ? 'right' : 'left';
      if (dir > 0 && !pinched && Number(await scene.getAttribute('data-focus')) >= lastIndex / 3) {
        await pinchAndReset(page);
        pinched = true;
        what += ', pinch to 4x, Reset view';
      }
      moved = (await at()) !== before;
      let s = await measure(page, steps.length, what);
      if (rates !== undefined && domOverruns(s, rates).length > 0) {
        // requests in flight (the sync's IndexedDB, a fetch) hold listeners for a moment: a second on, what the page keeps
        // (its layers as read: an idle page commits no new layer tree)
        await page.waitForTimeout(1000);
        s = { ...s, dom: await domState(page), ...(await retained(page)) };
      }
      steps.push(s);
      failures.push(...overruns(s), ...(rates === undefined ? [] : domOverruns(s, rates)));
      if (steps.length === WARM_UP) rates = ratesOf(steps);
      if (steps.length > 400) throw new Error('the walk never reached the end of the wall');
    }
    if (dir > 0) {
      lastDrawn = (await page.locator(`.cabinet-scene .cab[data-index="${lastIndex}"]`).count()) === 1;
      failures.push(...(await undrawn(page, 'far')).map((c) => `at the far end (cabinet ${steps[steps.length - 1]!.dom.focus}): ${c} not drawn`));
    }
  }
  await attachSteps(testInfo, steps);
  expect(lastDrawn, `the far end draws the last cabinet (${lastIndex})`).toBe(true);
  expect(await at(), 'back at the start').toBe(start);
  expect(rates, `a walk past its warm-up (${steps.length} swipes)`).toBeDefined();

  // every cabinet of the packed wall drawn on the way out (the far end's step closes it) and on the way back from there
  const turn = steps.findIndex((s) => s.what.startsWith('left'));
  for (const [way, part] of [['out', steps.slice(0, turn)], ['back', steps.slice(turn - 1)]] as const) {
    const seen = new Set(part.flatMap((s) => s.dom.drawnAt));
    const missed = Array.from({ length: lastIndex + 1 }, (_, i) => i).filter((i) => !seen.has(i));
    if (missed.length > 0) failures.push(`on the way ${way}: ${missed.length} of the wall's ${lastIndex + 1} cabinets never drawn, from ${missed[0]}`);
  }

  // the DOM back at the start: what the start held
  for (const k of ['nodes', 'listeners'] as const) {
    const [first, last] = [steps[0]![k], steps[steps.length - 1]![k]];
    if (Math.abs(last - first) > first * GROWTH) failures.push(`back at the start: ${last} DOM ${k}, the start held ${first}`);
  }

  // back at the start: the chrome drawn, and the cabinet the walk ends on holds its cut-outs, drawn
  failures.push(...(await undrawn(page, 'start')).map((c) => `back at the start: ${c} not drawn`));
  failures.push(...(await endCabinet(page)).map((c) => `back at the start: ${c}`));

  const peak = (k: 'nodes' | 'detached' | 'sceneViewports') => Math.max(...steps.map((s) => s[k]));
  const perNode = steps.map((s) => s.nodes / s.dom.pageNodes);
  testInfo.annotations.push({
    type: 'case-memory',
    description: JSON.stringify({
      steps: steps.length,
      cabinets: lastIndex + 1,
      warm: rates,
      perNode: [Math.min(...perNode), Math.max(...perNode)].map((r) => Math.round(r * 1000) / 1000),
      peakNodes: peak('nodes'),
      peakDetached: peak('detached'),
      peakSceneViewports: peak('sceneViewports'),
    }),
  });
  expect(failures).toEqual([]);
});

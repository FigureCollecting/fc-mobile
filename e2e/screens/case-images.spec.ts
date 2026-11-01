// IMG-SHOW-1 on the local full stack: the case view of user A's 1,200 owned copies (Ross had 559) with
// their images as production serves them. GetProductImages is answered by a page route as the live
// coordinator answers it (fc-coordinator 235e844, Connect JSON): no row marked primary, the mask and
// its grounding on the first of two gallery rows, pages of 200 rows that split a figure's rows. The
// images come from images.figurecollecting.com, another origin than the app, with the production
// headers (ACAO *, CORP cross-origin, Vary: Origin, immutable): a 136 KB JPEG derivative and a PNG
// mask. About half the figures have images. The sync fetches first those of the figures the case view shows, then
// the rest in the order it stands them (FETCH-FIRST), whatever the case's arrangement.
//   (a) once the sync has kept them, every figure in view with an image stands as its cut-out (masked,
//       grounded and drawn), every other one as its plate; the tiles and the figure page show it too.
//   (b) on a slow link, while the sync is still fetching, the figures it kept already stand as pictures.
//   (c) a case view left part way shows what its sync kept the moment it opens again, and its sync
//       carries on with only what is missing.
//   (d) user C's Ordered and Wished (on figures C owns none of): filtered to each, every figure in view
//       with an image stands as its cut-out, and the tiles show the pictures (FB-QUICK, Ross 10-16).
// On 6f458ce3 every figure stood as its plate until the whole sync ended (all 1,200 images), a case
// view left part way showed nothing when it opened again, and a synced one drew framed pictures only.
// On 692149fe only the owned figures were synced: an Ordered or Wished figure not also owned stood as its plate.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { create, toJson } from '@bufbuild/protobuf';
import { GetProductImagesResponseSchema } from '@figurecollecting/fc-api-contract';
import { expect, test } from '../fixtures';
import type { BrowserContext, Page, TestInfo } from '@playwright/test';
import type { E2eHooks } from '../../src/auth/e2eHooks';
import type { SyncHooks } from '../../src/sync/e2eHooks';
import { decodePng } from '../paintCheck';
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
const JPEG = readFileSync(new URL('./assets/derivative.jpg', import.meta.url));
const MASK = readFileSync(new URL('../../src/dev-fixtures/synthetic/mask/rem.png', import.meta.url));
/** The production image origin's headers (the canary's, 10-16). */
const ORIGIN_HEADERS = {
  'access-control-allow-origin': '*',
  'cross-origin-resource-policy': 'cross-origin',
  'cache-control': 'public, max-age=31536000, immutable',
  vary: 'Origin',
};
/**
 * A cut-out is drawn when hiding its art changes at least this share of its box on screen: the figure in it
 * (measured 0.10 to 0.18 at both panels). One whose mask draws nothing changes none (measured 0 with the
 * mask broken); an ink share of the box does not tell them apart (the shelf and neighbours in it).
 */
const MIN_DRAWN_SHARE = 0.05;

/** User C's Ordered and Wished (Ross's shape: a few ordered, many wished), from head HELD_FROM on. C owns nothing. */
const HELD_ORDERED = 8;
const HELD_WISHED = 40;
const HELD_FROM = 900;
const HELD_PREFIX = 'occ/fb0c0000-';
const heldOcc = (i: number): string => `fb0c0000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`;

let state: StackState;
let stack: StackClient;
let USER_A: StackUser;
let USER_C: StackUser;
let HEADS: { headId: string }[];

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const imageId = (head: string) => sha(`derivative:${head}`);
const maskId = (head: string) => sha(`mask:${head}`);
const MASKS = new Set<string>();
/** About half the figures have images, fixed by their head ids. */
const imaged = (head: string): boolean => parseInt(sha(head).slice(0, 2), 16) % 2 === 0;
/** The owned figures with images. */
let IMAGED = new Set<string>();

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
  expect((await device.enrol('img-show-1 seed')).status).toBe(201);
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

/** C's ordered and wished copies (no other suite signs C in). */
async function seedHeld(): Promise<void> {
  const held = await stack.sync.counts({ user: USER_C.sub, prefix: HELD_PREFIX });
  if (held.facets >= (HELD_ORDERED + HELD_WISHED) * 2) return;
  const device = await loginDevice({
    origin: state.origin,
    authorizationEndpoint: state.issuer.authorizationEndpoint,
    tokenEndpoint: state.issuer.tokenEndpoint,
    clientId: state.issuer.clientId,
    loginHint: USER_C.email,
  });
  expect((await device.enrol('fb-quick seed')).status).toBe(201);
  const dev = device.deviceId!.replace(/-/g, '');
  const stamp = { edited_at: '2026-10-01T00:00:00.000+00:00', tz: 'UTC' };
  let counter = 0;
  const version = () => `2026-10-01T00:00:00.000000Z#${String(++counter).padStart(10, '0')}#${dev}`;
  const events = [];
  for (let i = 0; i < HELD_ORDERED + HELD_WISHED; i++) {
    const status = i < HELD_ORDERED ? 'ordered' : 'wished';
    events.push({ facetKey: `occ/${heldOcc(i)}/head`, version: version(), op: 'SYNC_OP_UPSERT', payload: JSON.stringify({ head_id: HEADS[HELD_FROM + i]!.headId, ...stamp }), basis: '' });
    events.push({ facetKey: `occ/${heldOcc(i)}/status`, version: version(), op: 'SYNC_OP_UPSERT', payload: JSON.stringify({ status, ...stamp }), basis: '' });
  }
  const res = await device.connect('coordinator.v1.SyncService', 'Push', { clientId: `fb-quick-seed-${dev}`, events });
  expect(res.status).toBe(200);
}

test.describe.configure({ mode: 'default' });

test.beforeAll(async () => {
  test.setTimeout(240_000);
  const found = readStackState();
  if (found === undefined) throw new Error('no stack state file: run through playwright.stack.config.ts');
  state = found;
  stack = stackClient(state.controlUrl);
  [USER_A, USER_C] = [state.users[0]!, state.users[2]!];
  HEADS = (JSON.parse(readFileSync(state.catalog.file, 'utf8')) as { heads: { headId: string }[] }).heads;
  for (const h of HEADS.slice(0, OWNED)) MASKS.add(maskId(h.headId));
  IMAGED = new Set(
    HEADS.slice(0, OWNED)
      .map((h) => h.headId)
      .filter(imaged),
  );
  await seed();
  await seedHeld();
});

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem('onboarding_complete', '1'));
  await stack.edge.clearFaults();
  await stack.issuer.configure({ accessTokenTtlSeconds: 600, offlineAccess: true });
});

// ------------------------------------------------------------------ the doubles

/** A figure's two gallery rows as the coordinator sends them: neither primary, the mask and grounding on the first. */
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
  { derivativeId: sha(`second:${head}`), role: 'gallery', contentType: 'image/jpeg', width: 550, height: 800, url: `${MEDIA}/${sha(`second:${head}`)}` },
];

/** GetProductImages as the coordinator answers it, paged by rows; returns how many calls it answered. */
async function imageLists(page: Page): Promise<{ calls: () => number }> {
  let calls = 0;
  await page.route(IMAGES_PATH, async (route) => {
    calls += 1;
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
  return { calls: () => calls };
}

/** The image host: answers each address once `ready(head)` settles, and records what it served. */
async function imageHost(context: BrowserContext, ready: (head: string | undefined) => Promise<void> = async () => {}): Promise<string[]> {
  const served: string[] = [];
  const headOf = new Map(HEADS.slice(0, OWNED).flatMap((h) => [[imageId(h.headId), h.headId], [maskId(h.headId), h.headId]] as const));
  await context.route(/^https:\/\/images\.figurecollecting\.com\//, async (route) => {
    const url = route.request().url();
    const id = url.slice(url.lastIndexOf('/') + 1);
    await ready(headOf.get(id));
    const mask = MASKS.has(id);
    try {
      await route.fulfill({ status: 200, body: mask ? MASK : JPEG, headers: { 'content-type': mask ? 'image/png' : 'image/jpeg', ...ORIGIN_HEADERS } });
      served.push(url);
    } catch {
      // the page went away, or the sync aborted the fetch
    }
  });
  return served;
}

// ------------------------------------------------------------------ helpers

const authStatus = (page: Page) => page.evaluate(() => window.__fcAuth?.status() ?? 'loading').catch(() => 'navigating');

/** The app signed in as A with every owned copy on the device, on the case view. */
async function openCase(page: Page): Promise<void> {
  await openAs(page, USER_A, OWNED_PREFIX, OWNED);
  await expect(page.locator('button.cab-figure').first()).toBeVisible({ timeout: 30_000 });
}

/** The app signed in as `user` with the `count` copies whose occ ids start `prefix` on the device. */
async function openAs(page: Page, user: StackUser, prefix: string, count: number): Promise<void> {
  await stack.issuer.loginAs(user.sub);
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
    .poll(async () => (await page.evaluate(() => window.__fcSync!.copies())).filter((c) => c.occ_id.startsWith(prefix.slice(4)) && c.shown_in !== null).length, {
      timeout: 180_000,
    })
    .toBe(count);
}

interface Drawn {
  id: string;
  art: string;
  grounded: boolean;
  image: string | null;
  mask: string | null;
}

/** Every figure the case draws now. */
const drawn = (page: Page): Promise<Drawn[]> =>
  page.locator('button.cab-figure').evaluateAll((buttons) =>
    buttons.map((b) => {
      const masked = b.querySelector('.cab-figure__art--masked');
      return {
        id: b.getAttribute('data-figure-id')!,
        art: b.getAttribute('data-art')!,
        grounded: b.getAttribute('data-grounded') === '1',
        image: masked?.getAttribute('data-image-url') ?? null,
        mask: masked?.getAttribute('data-mask-url') ?? null,
      };
    }),
  );

/** A figure with an image drawn as its cut-out: its derivative under its mask, grounded on it. */
const cutOut = (d: Drawn): boolean => d.art === 'masked' && d.grounded && d.image === `${MEDIA}/${imageId(d.id)}` && d.mask === `${MEDIA}/${maskId(d.id)}`;

/** What the case draws wrong once every image is kept: an imaged figure not as its cut-out, another not as its plate. */
const wrong = (all: Drawn[]): string[] => all.filter((d) => (imaged(d.id) ? !cutOut(d) : d.art !== 'plate')).map((d) => `${d.id} ${d.art}${d.grounded ? '' : ' (reading)'}`);

/** Go to a screen inside the app, as a tap on a link would (no reload). */
async function navigate(page: Page, path: string): Promise<void> {
  await page.evaluate((to) => {
    history.pushState(null, '', to);
    dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

/** The share of pixels that differ between two shots of one box by more than 24 on a channel. */
function changed(a: Buffer, b: Buffer): number {
  const [x, y] = [decodePng(a), decodePng(b)];
  let n = 0;
  for (let i = 0; i < x.data.length; i += 4) {
    if (Math.max(Math.abs(x.data[i]! - y.data[i]!), Math.abs(x.data[i + 1]! - y.data[i + 1]!), Math.abs(x.data[i + 2]! - y.data[i + 2]!)) > 24) n++;
  }
  return n / (x.width * x.height);
}

/** How much of each cut-out's box its art draws on screen (at most `n`): the box shot with the art and without it. */
async function drawnShares(page: Page, ids: string[], n = 4): Promise<{ id: string; share: number }[]> {
  const viewport = page.viewportSize()!;
  const out: { id: string; share: number }[] = [];
  for (const id of ids) {
    if (out.length === n) break;
    const art = page.locator(`button.cab-figure[data-figure-id="${id}"] .cab-figure__art`);
    const box = await page.locator(`button.cab-figure[data-figure-id="${id}"] .cab-figure__box`).boundingBox();
    if (box === null) continue;
    const x = Math.max(0, box.x);
    const y = Math.max(0, box.y);
    const clip = { x, y, width: Math.min(viewport.width, box.x + box.width) - x, height: Math.min(viewport.height, box.y + box.height) - y };
    if (clip.width < 12 || clip.height < 12) continue;
    const shown = await page.screenshot({ clip });
    await art.evaluate((el) => ((el as HTMLElement).style.opacity = '0'));
    const hidden = await page.screenshot({ clip });
    await art.evaluate((el) => ((el as HTMLElement).style.opacity = ''));
    out.push({ id, share: changed(shown, hidden) });
  }
  return out;
}

async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const panel = SHOT_VIEWPORTS.find((v) => testInfo.project.name.endsWith(v.name.replace(/-full$/, '')))!;
  await page.waitForTimeout(300);
  const png = await signoffShot(page, testInfo, name);
  expect(shotSizeError(png, panel.png), png.path).toBeUndefined();
}

// ------------------------------------------------------------------ (a)

test('(a) once its sync has kept them, every figure in view with an image stands as its cut-out and every other as its plate; the tiles and the figure page show the pictures', async ({ context, page }, testInfo) => {
  test.setTimeout(240_000);
  const served = await imageHost(context);
  await imageLists(page);
  await openCase(page);

  await expect
    .poll(async () => {
      const all = await drawn(page);
      return all.filter(cutOut).length >= 6 && wrong(all).length === 0 ? 'ok' : `${all.filter(cutOut).length} cut-outs; wrong: ${wrong(all).slice(0, 6).join(', ')}`;
    }, { timeout: 120_000 })
    .toBe('ok');
  const cutOuts = (await drawn(page)).filter(cutOut).map((d) => d.id);
  const shares = await drawnShares(page, cutOuts);
  testInfo.annotations.push({ type: 'drawn share', description: JSON.stringify(shares) });
  expect(shares.length).toBeGreaterThan(0);
  for (const { id, share } of shares) expect(share, `the cut-out of ${id} is drawn`).toBeGreaterThanOrEqual(MIN_DRAWN_SHARE);
  testInfo.annotations.push({ type: 'served', description: String(served.length) });
  await shot(page, testInfo, 'case-images-cutouts');

  // the tiles show each owned figure's picture, a CORS image through the worker
  await navigate(page, '/?layout=rows');
  await expect
    .poll(
      () =>
        page.locator('img.jrows__img').evaluateAll((imgs) =>
          (imgs as HTMLImageElement[]).filter((i) => i.complete && i.naturalWidth > 0).map((i) => i.src),
        ),
      { timeout: 30_000 },
    )
    .toEqual(expect.arrayContaining([expect.stringMatching(/^https:\/\/images\.figurecollecting\.com\/d\/[0-9a-f]{64}$/)]));
  const tiles = await page.locator('img.jrows__img').evaluateAll((imgs) => (imgs as HTMLImageElement[]).map((i) => i.src));
  expect(tiles.every((src) => [...IMAGED].some((h) => src === `${MEDIA}/${imageId(h)}`))).toBe(true);
  await shot(page, testInfo, 'case-images-tiles');

  // the figure page asks the coordinator for its own picture and shows it
  await navigate(page, `/figure/${encodeURIComponent(cutOuts[0]!)}`);
  const picture = page.locator('img.figure-detail__image');
  await expect(picture).toHaveAttribute('src', `${MEDIA}/${imageId(cutOuts[0]!)}`, { timeout: 30_000 });
  await expect.poll(() => picture.evaluate((i) => (i as HTMLImageElement).naturalWidth), { timeout: 30_000 }).toBeGreaterThan(0);
});

// ------------------------------------------------------------------ (b)

/**
 * The images of the first three figures the sync asks for arrive at once, every later one's take 2.5 s (a slow
 * link, never a stalled one). The sync asks first for the figures in the case's view (FETCH-FIRST), in its default
 * arrangement too, and the cover's first view has more than three with images (six, 10-31): so it shows both.
 * Asked in head-id order, the wall arranged by series opened on figures from anywhere in that order: none of the
 * first dozen stood in view, and the first picture in view came after about a minute.
 */
const SLOW_FROM = 3;
/** A slow link, and the figures its host was asked for, in the order first asked. */
function slowLink(): { ready: (head: string | undefined) => Promise<void>; asked: string[] } {
  const asked: string[] = [];
  const ready = (head: string | undefined): Promise<void> => {
    if (head !== undefined && !asked.includes(head)) asked.push(head);
    return new Promise((res) => setTimeout(res, head !== undefined && asked.indexOf(head) >= SLOW_FROM ? 2500 : 0));
  };
  return { ready, asked };
}

test('(b) on a slow link, while its sync is still fetching, the figures it kept already stand as pictures', async ({ context, page }, testInfo) => {
  test.skip(!testInfo.project.name.endsWith('cover'), 'one panel is enough: (a) covers both');
  test.setTimeout(240_000);
  const link = slowLink();
  const served = await imageHost(context, link.ready);
  await imageLists(page);
  await openCase(page);
  await expect.poll(() => link.asked.length, { timeout: 60_000 }).toBeGreaterThanOrEqual(SLOW_FROM);
  const first = new Set(link.asked.slice(0, SLOW_FROM));
  const early = (await drawn(page)).filter((d) => first.has(d.id));
  testInfo.annotations.push({ type: 'first asked in view', description: `${early.length} of ${SLOW_FROM}` });
  expect(early.length, 'figures in view the sync fetches first').toBeGreaterThan(0);

  await expect
    .poll(async () => (await drawn(page)).filter((d) => cutOut(d) && first.has(d.id)).length, { timeout: 60_000 })
    .toBeGreaterThan(0);
  // still fetching: the slow half has hardly begun
  expect(served.length).toBeLessThan(IMAGED.size * 2);
  const now = await drawn(page);
  expect(now.filter((d) => imaged(d.id) && !cutOut(d)).length, 'figures in view still to come').toBeGreaterThan(0);
  const late = new Set(link.asked.slice(SLOW_FROM + 50));
  expect(now.filter((d) => cutOut(d) && late.has(d.id))).toEqual([]);
  testInfo.annotations.push({ type: 'served while fetching', description: `${served.length} of ${IMAGED.size * 2}` });
  await shot(page, testInfo, 'case-images-while-syncing');
});

// ------------------------------------------------------------------ (c)

test('(c) a case view left part way shows what its sync kept the moment it opens again, and its sync carries on with only what is missing', async ({ context, page }, testInfo) => {
  test.skip(!testInfo.project.name.endsWith('cover'), 'one panel is enough: (a) covers both');
  test.setTimeout(240_000);
  // while it is away and until released, the image host answers nothing; once released, everything at once
  let held: Promise<void> | undefined;
  let release = () => {};
  let fast = false;
  const link = slowLink();
  const served = await imageHost(context, (head) => held ?? (fast ? Promise.resolve() : link.ready(head)));
  const lists = await imageLists(page);
  await openCase(page);
  await expect.poll(async () => (await drawn(page)).filter(cutOut).length, { timeout: 60_000 }).toBeGreaterThan(0);
  const kept = (await drawn(page)).filter(cutOut).map((d) => d.id);

  // away to Stats: the case view goes and its sync stops
  await navigate(page, '/stats');
  await expect(page.locator('button.cab-figure')).toHaveCount(0);
  held = new Promise((res) => (release = res));
  // the slow answers already under way end first
  await page.waitForTimeout(3_000);
  const servedAway = served.length;
  const asked = lists.calls();

  // back: what it kept stands at once, before any image arrives
  await navigate(page, '/');
  await expect.poll(async () => (await drawn(page)).filter((d) => kept.includes(d.id) && cutOut(d)).length, { timeout: 5_000 }).toBe(kept.length);
  expect(served.length).toBe(servedAway);
  await shot(page, testInfo, 'case-images-reopened');

  // and its sync carries on: it reads the lists again and fetches only what it had not kept
  await expect.poll(() => lists.calls(), { timeout: 30_000 }).toBeGreaterThan(asked);
  fast = true;
  held = undefined;
  release();
  await expect.poll(async () => wrong(await drawn(page)).length, { timeout: 180_000 }).toBe(0);
  const twice = served.filter((u, i) => served.indexOf(u) !== i);
  // at most the fetches in flight when the case view went away are asked again
  expect(twice.length, twice.join('\n')).toBeLessThanOrEqual(4);
});

// ------------------------------------------------------------------ (d)

/** Show one holding alone, chosen in Refine (SHEETS-FB1: it applies at once), then Done. */
async function showHolding(page: Page, name: 'Owned' | 'Ordered' | 'Wished'): Promise<void> {
  await page.locator('.case-tabs__tab[data-tab="refine"]').tap();
  const holding = page.getByRole('group', { name: 'Holding' });
  const choice = (label: string) => holding.getByRole('button', { name: new RegExp(`^${label}`) });
  if ((await choice(name).getAttribute('aria-pressed')) !== 'true') await choice(name).tap();
  for (const other of ['Owned', 'Ordered', 'Wished', 'No longer owned'].filter((n) => n !== name)) {
    if ((await choice(other).getAttribute('aria-pressed')) === 'true') await choice(other).tap();
  }
  await expect(holding.getByRole('button', { pressed: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Done' }).tap();
  await expect(page.locator('.detent-sheet')).toHaveCount(0);
  await expect(page.locator('button.cab-figure').first()).toBeVisible({ timeout: 30_000 });
}

test("(d) filtered to Ordered and to Wished, figures not owned stand as their cut-outs, not plates, and the tiles show their pictures", async ({ context, page }, testInfo) => {
  test.setTimeout(240_000);
  await imageHost(context);
  await imageLists(page);
  await openAs(page, USER_C, HELD_PREFIX, HELD_ORDERED + HELD_WISHED);
  // C owns nothing (so on 692149fe, which synced owned figures only, every one stood as its plate): an empty Owned
  expect((await page.evaluate(() => window.__fcSync!.copies())).filter((c) => c.status === 'owned')).toEqual([]);
  await expect(page.locator('.case-tabs__tab[data-tab="refine"]')).toBeVisible({ timeout: 30_000 });

  // each holding told on its own: a red Ordered still shows what the Wished draws
  const soft = expect.configure({ soft: true });
  for (const holding of ['Ordered', 'Wished'] as const) {
    await showHolding(page, holding);
    await soft
      .poll(async () => {
        const all = await drawn(page);
        const cutOuts = all.filter(cutOut).length;
        return cutOuts >= 3 && wrong(all).length === 0 ? 'ok' : `${cutOuts} cut-outs; wrong: ${wrong(all).slice(0, 6).join(', ')}`;
      }, { timeout: 60_000, message: holding })
      .toBe('ok');
    const shares = await drawnShares(page, (await drawn(page)).filter(cutOut).map((d) => d.id), 2);
    testInfo.annotations.push({ type: `drawn share, ${holding}`, description: JSON.stringify(shares) });
    for (const { id, share } of shares) expect(share, `the cut-out of ${id} is drawn (${holding})`).toBeGreaterThanOrEqual(MIN_DRAWN_SHARE);
    await shot(page, testInfo, `case-images-${holding.toLowerCase()}`);
  }

  // the tiles of the Wished show their pictures
  await navigate(page, '/?status=wished&layout=rows');
  const wishedPictures = () =>
    page.locator('img.jrows__img').evaluateAll((imgs) => (imgs as HTMLImageElement[]).filter((i) => i.complete && i.naturalWidth > 0).map((i) => i.src));
  const wishedImages = new Set(HEADS.slice(HELD_FROM + HELD_ORDERED, HELD_FROM + HELD_ORDERED + HELD_WISHED).map((h) => h.headId).filter(imaged).map((h) => `${MEDIA}/${imageId(h)}`));
  await expect.poll(async () => (await wishedPictures()).filter((src) => wishedImages.has(src)).length, { timeout: 30_000 }).toBeGreaterThan(0);
  await shot(page, testInfo, 'case-images-wished-tiles');
});

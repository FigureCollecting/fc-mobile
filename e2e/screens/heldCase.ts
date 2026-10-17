// The screens' stack users and their cases (FB-QUICK's holdings, IMG-SHOW-1's seed and image doubles): user C's 8
// Ordered and 40 Wished copies of heads 900 to 947 (C owns nothing), user A's 1,200 owned copies of heads 0 to 1,199
// (ownedStack), their images answered as production answers them: GetProductImages
// by a page route as the live coordinator answers it, and the images from images.figurecollecting.com with the
// production headers. About half the figures have images, fixed by their head ids. The same seed as
// e2e/screens/case-images.spec.ts (d): whichever runs first writes it.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { create, toJson } from '@bufbuild/protobuf';
import { GetProductImagesResponseSchema } from '@figurecollecting/fc-api-contract';
import { expect } from '../fixtures';
import type { BrowserContext, Page } from '@playwright/test';
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
  }
}

export const HELD_ORDERED = 8;
export const HELD_WISHED = 40;
const HELD_FROM = 900;
export const HELD_PREFIX = 'occ/fb0c0000-';
const heldOcc = (i: number): string => `fb0c0000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`;

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

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const imageId = (head: string) => sha(`derivative:${head}`);
const maskId = (head: string) => sha(`mask:${head}`);
const imaged = (head: string): boolean => parseInt(sha(head).slice(0, 2), 16) % 2 === 0;

export interface HeldStack {
  readonly state: StackState;
  readonly stack: StackClient;
  readonly user: StackUser;
  /** The held heads, Ordered first: [0, HELD_ORDERED) are ordered, the rest wished. */
  readonly heads: readonly string[];
  /** The ordered figures' ids (the case's data-figure-id is the head id). */
  readonly ordered: readonly string[];
}

/** The stack, user C and C's held copies on the server (seeded once). */
export async function heldStack(): Promise<HeldStack> {
  const state = readStackState();
  if (state === undefined) throw new Error('no stack state file: run through playwright.stack.config.ts');
  const stack = stackClient(state.controlUrl);
  const user = state.users[2]!;
  const all = (JSON.parse(readFileSync(state.catalog.file, 'utf8')) as { heads: { headId: string }[] }).heads;
  const heads = all.slice(HELD_FROM, HELD_FROM + HELD_ORDERED + HELD_WISHED).map((h) => h.headId);
  const held = await stack.sync.counts({ user: user.sub, prefix: HELD_PREFIX });
  if (held.facets < heads.length * 2) {
    const device = await loginDevice({
      origin: state.origin,
      authorizationEndpoint: state.issuer.authorizationEndpoint,
      tokenEndpoint: state.issuer.tokenEndpoint,
      clientId: state.issuer.clientId,
      loginHint: user.email,
    });
    expect((await device.enrol('fb-quick seed')).status).toBe(201);
    const dev = device.deviceId!.replace(/-/g, '');
    const stamp = { edited_at: '2026-10-01T00:00:00.000+00:00', tz: 'UTC' };
    let counter = 0;
    const version = () => `2026-10-01T00:00:00.000000Z#${String(++counter).padStart(10, '0')}#${dev}`;
    const events = heads.flatMap((head, i) => [
      { facetKey: `occ/${heldOcc(i)}/head`, version: version(), op: 'SYNC_OP_UPSERT', payload: JSON.stringify({ head_id: head, ...stamp }), basis: '' },
      {
        facetKey: `occ/${heldOcc(i)}/status`,
        version: version(),
        op: 'SYNC_OP_UPSERT',
        payload: JSON.stringify({ status: i < HELD_ORDERED ? 'ordered' : 'wished', ...stamp }),
        basis: '',
      },
    ]);
    const res = await device.connect('coordinator.v1.SyncService', 'Push', { clientId: `fb-quick-seed-${dev}`, events });
    expect(res.status).toBe(200);
  }
  return { state, stack, user, heads, ordered: heads.slice(0, HELD_ORDERED) };
}

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

/** GetProductImages and the image host for the held heads, answered at once. */
export async function heldImages(context: BrowserContext, page: Page, heads: readonly string[]): Promise<void> {
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
  const masks = new Set(heads.map(maskId));
  await context.route(/^https:\/\/images\.figurecollecting\.com\//, async (route) => {
    const url = route.request().url();
    const mask = masks.has(url.slice(url.lastIndexOf('/') + 1));
    try {
      await route.fulfill({ status: 200, body: mask ? MASK : JPEG, headers: { 'content-type': mask ? 'image/png' : 'image/jpeg', ...ORIGIN_HEADERS } });
    } catch {
      // the page went away
    }
  });
}

const authStatus = (page: Page) => page.evaluate(() => window.__fcAuth?.status() ?? 'loading').catch(() => 'navigating');

/** The app signed in as C with every held copy on the device. */
export async function openHeld(page: Page, held: HeldStack): Promise<void> {
  await openAs(page, held, HELD_PREFIX);
}

/** The app signed in as `who.user` with its `who.heads.length` copies whose occ ids start `prefix` on the device. */
async function openAs(page: Page, who: Pick<HeldStack, 'stack' | 'user' | 'heads'>, prefix: string): Promise<void> {
  await who.stack.issuer.loginAs(who.user.sub);
  await page.goto('/');
  await page.waitForFunction(() => window.__fcAuth !== undefined && window.__fcSync !== undefined, undefined, { timeout: 30_000 }).catch(() => {
    throw new Error('no window.__fcAuth / __fcSync: the stack must serve dist-stack (npm run build:stack)');
  });
  await expect.poll(() => authStatus(page), { timeout: 30_000 }).toMatch(/^(signed-in|signed-out|reauth-required)$/);
  if ((await authStatus(page)) !== 'signed-in') {
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect.poll(() => authStatus(page), { timeout: 30_000 }).toBe('signed-in');
  }
  const occ = prefix.slice(4);
  await expect
    .poll(async () => (await page.evaluate(() => window.__fcSync!.copies())).filter((c) => c.occ_id.startsWith(occ) && c.shown_in !== null).length, {
      timeout: 180_000,
    })
    .toBe(who.heads.length);
  await expect(page.locator('.case-tabs__tab[data-tab="refine"]')).toBeVisible({ timeout: 30_000 });
  // the 4 s splash covers the case until it goes
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 15_000 });
}

const OWNED = 1200;
const OWNED_PREFIX = 'occ/5eed0000-';
const ownedOcc = (i: number): string => `5eed0000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`;

/**
 * User A's 1,200 owned copies of heads 0 to 1,199 (IMG-SHOW-1's seed, the same as e2e/screens/case-images.spec.ts and
 * e2e/sync: whichever runs first writes them), on the server.
 */
export async function ownedStack(): Promise<Omit<HeldStack, 'ordered'>> {
  const state = readStackState();
  if (state === undefined) throw new Error('no stack state file: run through playwright.stack.config.ts');
  const stack = stackClient(state.controlUrl);
  const user = state.users[0]!;
  const heads = (JSON.parse(readFileSync(state.catalog.file, 'utf8')) as { heads: { headId: string }[] }).heads.slice(0, OWNED).map((h) => h.headId);
  const owned = await stack.sync.counts({ user: user.sub, prefix: OWNED_PREFIX });
  if (owned.facets < OWNED * 2) {
    const device = await loginDevice({
      origin: state.origin,
      authorizationEndpoint: state.issuer.authorizationEndpoint,
      tokenEndpoint: state.issuer.tokenEndpoint,
      clientId: state.issuer.clientId,
      loginHint: user.email,
    });
    expect((await device.enrol('img-show-1 seed')).status).toBe(201);
    const dev = device.deviceId!.replace(/-/g, '');
    const stamp = { edited_at: '2026-10-01T00:00:00.000+00:00', tz: 'UTC' };
    let counter = 0;
    const version = () => `2026-10-01T00:00:00.000000Z#${String(++counter).padStart(10, '0')}#${dev}`;
    for (let start = 0; start < OWNED; start += 100) {
      const events = heads.slice(start, start + 100).flatMap((head, j) => [
        { facetKey: `occ/${ownedOcc(start + j)}/head`, version: version(), op: 'SYNC_OP_UPSERT', payload: JSON.stringify({ head_id: head, ...stamp }), basis: '' },
        { facetKey: `occ/${ownedOcc(start + j)}/status`, version: version(), op: 'SYNC_OP_UPSERT', payload: JSON.stringify({ status: 'owned', ...stamp }), basis: '' },
      ]);
      const res = await device.connect('coordinator.v1.SyncService', 'Push', { clientId: `wk15-seed-${dev}-${start}`, events });
      expect(res.status).toBe(200);
    }
  }
  return { state, stack, user, heads };
}

/** The app signed in as A with every owned copy on the device. */
export async function openOwned(page: Page, owned: Omit<HeldStack, 'ordered'>): Promise<void> {
  await openAs(page, owned, OWNED_PREFIX);
}

export type Holding = 'Owned' | 'Ordered' | 'Wished' | 'No longer owned';

/** Show exactly these holdings, chosen in Refine (SHEETS-FB1: each applies at once), then Done; what the case then draws is the caller's to check. */
export async function showHoldings(page: Page, names: readonly Holding[]): Promise<void> {
  await page.locator('.case-tabs__tab[data-tab="refine"]').tap();
  const holding = page.getByRole('group', { name: 'Holding' });
  const choice = (label: string) => holding.getByRole('button', { name: new RegExp(`^${label}`) });
  for (const name of names) {
    if ((await choice(name).getAttribute('aria-pressed')) !== 'true') await choice(name).tap();
  }
  // each other holding by its name (an nth() of the pressed ones would shift as each is let go)
  for (const other of (['Owned', 'Ordered', 'Wished', 'No longer owned'] as const).filter((n) => !names.includes(n))) {
    if ((await choice(other).getAttribute('aria-pressed')) === 'true') await choice(other).tap();
  }
  await expect(holding.getByRole('button', { pressed: true })).toHaveCount(names.length);
  await page.getByRole('button', { name: 'Done' }).tap();
  await expect(page.locator('.detent-sheet')).toHaveCount(0);
}

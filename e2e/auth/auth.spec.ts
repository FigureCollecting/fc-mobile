// WK-08 acceptance on the local full stack: the OIDC build behind nginx, the
// real fc-coordinator through the edge, the PKCE-verifying mock issuer.
import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { guardedTest as test } from '../fixtures';
import type { E2eHooks } from '../../src/auth/e2eHooks';
import { readStackState, stackClient, type StackClient } from '../stack/src/client.js';
import type { StackUser } from '../stack/src/issuer.js';
import type { StackState } from '../stack/src/stack.js';

declare global {
  interface Window {
    __fcAuth?: E2eHooks;
  }
}

// Read once globalSetup has the stack up (listing the suite must not need one).
let state: StackState;
let stack: StackClient;
let USER_A: StackUser;
let GTIN: string;
let HOME: string;

test.beforeAll(() => {
  const found = readStackState();
  if (found === undefined) throw new Error('no stack state file: run through playwright.stack.config.ts');
  state = found;
  stack = stackClient(state.controlUrl);
  USER_A = state.users[0]!;
  const heads = (JSON.parse(readFileSync(state.catalog.file, 'utf8')) as { heads: Array<{ gtin14s: string[] }> }).heads;
  GTIN = heads.find((h) => h.gtin14s.length > 0)!.gtin14s[0]!;
  HOME = `${state.origin}/`;
});

interface Snapshot {
  current: string | null;
  tokens: { accessToken: string; refreshToken?: string; expiresAt: number; reauth?: boolean } | null;
  key: { jkt: string; deviceId?: string; extractable: boolean } | null;
  outbox: number;
}

async function hooks(page: Page): Promise<void> {
  // A stack started with the plain `npm run build` has no handles: say so instead of timing out vaguely.
  await page
    .waitForFunction(() => window.__fcAuth !== undefined, undefined, { timeout: 15_000 })
    .catch(() => {
      throw new Error('no window.__fcAuth: the stack must serve dist-stack (npm run build:stack)');
    });
}

const status = (page: Page) => page.evaluate(() => window.__fcAuth!.status());
const compare = (page: Page) => page.evaluate((gtin) => window.__fcAuth!.compare(gtin), GTIN);

/** Everything the auth unit keeps for the signed-in user, read straight from IndexedDB. */
function snapshot(page: Page, sub: string = USER_A.sub): Promise<Snapshot> {
  return page.evaluate(async (s) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('fc-mobile');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const get = (store: string, key: IDBValidKey) =>
      new Promise<unknown>((resolve, reject) => {
        const req = db.transaction(store).objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    const count = new Promise<number>((resolve, reject) => {
      const req = db.transaction('outbox').objectStore('outbox').index('by_sub').count(IDBKeyRange.bound([s], [s, []]));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const current = (await get('auth', 'current')) as { sub: string } | undefined;
    const tokens = (await get('auth', `tokens:${s}`)) as Snapshot['tokens'] | undefined;
    const key = (await get('device_key', s)) as { jkt: string; deviceId?: string; privateKey: CryptoKey } | undefined;
    const outbox = await count;
    db.close();
    return {
      current: current?.sub ?? null,
      tokens: tokens ?? null,
      key: key === undefined ? null : { jkt: key.jkt, deviceId: key.deviceId, extractable: key.privateKey.extractable },
      outbox,
    };
  }, sub);
}

function seedOutbox(page: Page, sub: string = USER_A.sub): Promise<number> {
  return page.evaluate(async (s) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('fc-mobile');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const id = await new Promise<number>((resolve, reject) => {
      const req = db.transaction('outbox', 'readwrite').objectStore('outbox').add({
        sub: s,
        facet_key: 'holding/1b4e28ba-2fa1-11d2-883f-0016d3cca427/status',
        op: 'upsert',
        payload: '{"status":"owned"}',
        edit_version: '2026-09-26T12:00:00.000000Z-0000-0f3a5c7e9b1d2f4a6c8e0b2d4f6a8c0e',
        base_version: null,
        state: 'PENDING',
        attempts: 0,
        created_at: Date.now(),
      });
      req.onsuccess = () => resolve(req.result as number);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return id;
  }, sub);
}

/** Sign in through the banner: the IdP, /callback, back home, enrolled. Returns the URLs the page committed. */
async function signInThroughBanner(page: Page): Promise<string[]> {
  const committed: string[] = [];
  const record = (frame: ReturnType<Page['mainFrame']>): void => {
    if (frame === page.mainFrame()) committed.push(frame.url());
  };
  page.on('framenavigated', record);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect.poll(() => committed.some((u) => u.startsWith(`${state.origin}/callback?code=`)), { timeout: 20_000 }).toBe(true);
  await expect.poll(() => page.url(), { timeout: 20_000 }).toBe(HOME);
  page.off('framenavigated', record);
  await hooks(page);
  await expect.poll(() => status(page)).toBe('signed-in');
  await expect.poll(async () => (await snapshot(page)).key?.deviceId).toMatch(/^[0-9a-f-]{36}$/);
  return committed;
}

async function openSignedOut(page: Page): Promise<void> {
  await page.goto('/');
  await hooks(page);
  await expect.poll(() => status(page)).toBe('signed-out');
}

/** Wait until the stored access token is past its expiry, by the page's own clock. */
async function waitForExpiry(page: Page): Promise<void> {
  const { tokens } = await snapshot(page);
  const wait = tokens!.expiresAt - (await page.evaluate(() => Date.now())) + 500;
  if (wait > 0) await page.waitForTimeout(wait);
}

// Logs are read from a cursor: the edge keeps only its last 2,000 entries, so an index goes stale.
const apiEntries = async (since: number) => (await stack.edge.log(since)).filter((e) => e.path.startsWith('/api/'));
const issuerSince = async (since: number) =>
  (await stack.issuer.log(since)).map((e) => `${e.grantType ?? e.endpoint}:${e.outcome}`);
const TWENTY_MIN = 20 * 60_000;

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem('onboarding_complete', '1'));
  await stack.issuer.configure({ accessTokenTtlSeconds: 600, offlineAccess: true });
  await stack.issuer.loginAs(USER_A.sub);
});

test.afterAll(async () => {
  await stack.issuer.configure({ accessTokenTtlSeconds: 600, offlineAccess: true });
});

test('(a) login, /callback, device enrolment, then Compare returns 200', async ({ page }) => {
  await openSignedOut(page);
  await expect(page.getByRole('status').filter({ hasText: /sign in to sync/i })).toBeVisible();
  const from = await stack.edge.cursor();
  const issuerFrom = await stack.issuer.cursor();
  const committed = await signInThroughBanner(page);
  // Out to the IdP, back to /callback, then /callback replaced by where the user started.
  expect(committed.at(-1)).toBe(HOME);
  expect(await stack.issuer.log(issuerFrom)).toMatchObject([
    { endpoint: 'authorize', outcome: 'ok' },
    { grantType: 'authorization_code', outcome: 'ok', sub: USER_A.sub },
  ]);
  const enrol = (await apiEntries(from)).filter((e) => e.path === '/api/auth/devices');
  expect(enrol.map((e) => [e.method, e.status])).toEqual([
    ['POST', 401],
    ['POST', 201],
  ]);

  const compareFrom = await stack.edge.cursor();
  expect(await compare(page)).toEqual({ ok: true, redacted: [] });
  expect((await apiEntries(compareFrom)).map((e) => [e.path, e.status])).toEqual([
    ['/api/coordinator.v1.CompareService/Compare', 200],
  ]);
  const { key, tokens } = await snapshot(page);
  expect(await page.evaluate(() => window.__fcAuth!.session())).toMatchObject({
    status: 200,
    body: { userId: USER_A.sub, deviceId: key!.deviceId, jkt: key!.jkt },
  });
  const webStorage = await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }]));
  expect(webStorage).not.toContain(tokens!.accessToken);
  expect(webStorage).not.toContain(tokens!.refreshToken!);

  // /callback was replaced, not pushed: Back never revisits the spent code.
  const back: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) back.push(frame.url());
  });
  await page.evaluate(() => history.back());
  await expect.poll(() => back.length, { timeout: 10_000 }).toBeGreaterThan(0);
  expect(back.filter((u) => u.includes('code='))).toEqual([]);
  expect(page.url()).toBe(HOME);
});

test('(b) the stored device key cannot be exported', async ({ page }) => {
  await openSignedOut(page);
  await signInThroughBanner(page);
  const probe = await page.evaluate(async (sub) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('fc-mobile');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const rec = await new Promise<{ privateKey: CryptoKey }>((resolve, reject) => {
      const req = db.transaction('device_key').objectStore('device_key').get(sub);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    const attempt = async (format: 'jwk' | 'pkcs8'): Promise<string> => {
      try {
        await crypto.subtle.exportKey(format, rec.privateKey);
        return 'exported';
      } catch (err) {
        return (err as Error).name;
      }
    };
    return {
      extractable: rec.privateKey.extractable,
      algorithm: rec.privateKey.algorithm,
      usages: rec.privateKey.usages,
      jwk: await attempt('jwk'),
      pkcs8: await attempt('pkcs8'),
    };
  }, USER_A.sub);
  expect(probe).toEqual({
    extractable: false,
    algorithm: { name: 'ECDSA', namedCurve: 'P-256' },
    usages: ['sign'],
    jwk: 'InvalidAccessError',
    pkcs8: 'InvalidAccessError',
  });
});

test('(c) with the device clock 90 s fast, calls still succeed', async ({ page }) => {
  await page.clock.install({ time: Date.now() + 90_000 });
  await openSignedOut(page);
  expect((await page.evaluate(() => Date.now())) - Date.now()).toBeGreaterThan(85_000);
  const from = await stack.edge.cursor();
  await signInThroughBanner(page);
  // The first proof's iat is 90 s ahead and refused; the 401's Date corrects it and the retry enrols.
  expect((await apiEntries(from)).map((e) => e.status)).toEqual([401, 201]);
  const compareFrom = await stack.edge.cursor();
  expect(await compare(page)).toEqual({ ok: true, redacted: [] });
  expect(await compare(page)).toEqual({ ok: true, redacted: [] });
  expect((await apiEntries(compareFrom)).map((e) => e.status)).toEqual([200, 200]);
});

// Past the ID token's lifetime plus leeway (10 + 5 min): only a server-corrected clock may judge exp.
test('(c) with the device clock 20 min fast, sign-in still completes', async ({ page }) => {
  await page.clock.install({ time: Date.now() + TWENTY_MIN });
  await openSignedOut(page);
  expect((await page.evaluate(() => Date.now())) - Date.now()).toBeGreaterThan(TWENTY_MIN - 60_000);
  const issuerFrom = await stack.issuer.cursor();
  await signInThroughBanner(page);
  expect(await issuerSince(issuerFrom)).toEqual(['authorize:ok', 'authorization_code:ok']);
  expect(await compare(page)).toEqual({ ok: true, redacted: [] });
  expect(await status(page)).toBe('signed-in');
});

test('(c) a cold start with the device clock 20 min fast refreshes once and keeps the rotated refresh token', async ({
  context,
  page,
}) => {
  await openSignedOut(page);
  await signInThroughBanner(page);
  const before = (await snapshot(page)).tokens!;
  await page.close();
  const issuerFrom = await stack.issuer.cursor();
  const cold = await context.newPage();
  await cold.clock.install({ time: Date.now() + TWENTY_MIN });
  await cold.goto('/');
  await hooks(cold);
  expect((await cold.evaluate(() => Date.now())) - Date.now()).toBeGreaterThan(TWENTY_MIN - 60_000);
  expect(await compare(cold)).toEqual({ ok: true, redacted: [] });
  expect(await status(cold)).toBe('signed-in');
  expect(await issuerSince(issuerFrom)).toEqual(['refresh_token:ok']);
  const after = (await snapshot(cold)).tokens!;
  expect(after.reauth).toBeUndefined();
  expect(after.refreshToken).toBeDefined();
  expect(after.refreshToken).not.toBe(before.refreshToken);
});

test('(d) after a coordinator restart the next call recovers through one silent use_dpop_nonce retry', async ({ page }) => {
  await openSignedOut(page);
  await signInThroughBanner(page);
  expect(await compare(page)).toMatchObject({ ok: true });
  await stack.coordinator.restart();
  const from = await stack.edge.cursor();
  expect(await compare(page)).toEqual({ ok: true, redacted: [] });
  expect((await apiEntries(from)).map((e) => [e.path, e.status])).toEqual([
    ['/api/coordinator.v1.CompareService/Compare', 401],
    ['/api/coordinator.v1.CompareService/Compare', 200],
  ]);
  expect(await status(page)).toBe('signed-in');
});

test('(e) two tabs with an expired access token make exactly one refresh; the rotated-out token is refused', async ({
  context,
  page,
}) => {
  await stack.issuer.configure({ accessTokenTtlSeconds: 8 });
  await openSignedOut(page);
  await signInThroughBanner(page);
  const second = await context.newPage();
  await second.goto('/');
  await hooks(second);
  await expect.poll(() => status(second)).toBe('signed-in');
  const old = (await snapshot(page)).tokens!;
  await waitForExpiry(page);

  const issuerFrom = await stack.issuer.cursor();
  const [a, b] = await Promise.all([compare(page), compare(second)]);
  expect(a).toEqual({ ok: true, redacted: [] });
  expect(b).toEqual({ ok: true, redacted: [] });
  // Every refresh request the issuer saw, not only the good ones.
  expect(await issuerSince(issuerFrom)).toEqual(['refresh_token:ok']);
  expect((await snapshot(page)).tokens!.refreshToken).not.toBe(old.refreshToken);

  const reuse = await fetch(state.issuer.tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: old.refreshToken!, client_id: state.issuer.clientId }),
  });
  expect(reuse.status).toBe(400);
  expect(await reuse.json()).toMatchObject({ error: 'invalid_grant' });
});

test('(f) offline with an expired access token: stays on the collection with a banner, local data intact', async ({
  context,
  page,
}) => {
  await stack.issuer.configure({ accessTokenTtlSeconds: 8 });
  await openSignedOut(page);
  await signInThroughBanner(page);
  await seedOutbox(page);
  const before = await snapshot(page);
  await waitForExpiry(page);
  const committed: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) committed.push(frame.url());
  });

  await context.setOffline(true);
  expect(await compare(page)).toMatchObject({ ok: false, code: 'Unavailable' });
  expect(await status(page)).toBe('offline');
  await expect(page.getByText(/you're offline/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(0);
  await expect(page.getByRole('navigation').getByText(/collection/i)).toBeVisible();
  expect(page.url()).toBe(HOME);
  expect(committed).toEqual([]);
  expect(await snapshot(page)).toEqual(before);

  await context.setOffline(false);
  expect(await compare(page)).toEqual({ ok: true, redacted: [] });
  expect(await status(page)).toBe('signed-in');
  expect(committed).toEqual([]);
});

test('(g) after invalid_grant, re-login keeps both the outbox and the device key', async ({ page }) => {
  await stack.issuer.configure({ accessTokenTtlSeconds: 8 });
  await openSignedOut(page);
  await signInThroughBanner(page);
  const outboxId = await seedOutbox(page);
  expect(outboxId).toBeGreaterThan(0);
  const before = await snapshot(page);
  await stack.issuer.revokeUser(USER_A.sub);
  await waitForExpiry(page);

  const issuerFrom = await stack.issuer.cursor();
  expect(await compare(page)).toMatchObject({ ok: false, code: 'Unauthenticated' });
  expect(await status(page)).toBe('reauth-required');
  expect(await issuerSince(issuerFrom)).toEqual(['refresh_token:invalid_grant']);
  await expect(page.getByRole('status').filter({ hasText: /kept on this device/i })).toBeVisible();
  expect(page.url()).toBe(HOME);

  await stack.issuer.configure({ accessTokenTtlSeconds: 600 });
  const from = await stack.edge.cursor();
  await signInThroughBanner(page);
  const after = await snapshot(page);
  expect(after.key).toEqual(before.key);
  expect(after.outbox).toBe(before.outbox);
  expect(after.tokens!.reauth).toBeUndefined();
  expect(await compare(page)).toEqual({ ok: true, redacted: [] });
  // The same key, already enrolled: no second enrolment.
  expect((await apiEntries(from)).filter((e) => e.path === '/api/auth/devices')).toEqual([]);
});

test('sign-out leaves through the exact registered post-logout URI and keeps the device key and outbox', async ({ page }) => {
  await openSignedOut(page);
  await signInThroughBanner(page);
  await seedOutbox(page);
  const before = await snapshot(page);
  const committed: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) committed.push(frame.url());
  });
  await page.evaluate(() => void window.__fcAuth!.signOut());
  // The mock redirects only to an exactly registered URI; anything else stays on its 'signed out' page.
  await expect.poll(() => committed.at(-1)).toBe(HOME);
  await hooks(page);
  await expect.poll(() => status(page)).toBe('signed-out');
  await expect(page.getByRole('status').filter({ hasText: /sign in to sync/i })).toBeVisible();
  const after = await snapshot(page);
  expect(after).toEqual({ current: null, tokens: null, key: before.key, outbox: before.outbox });
});

test('another tab deleting the local store signs this tab out on its next call, in place', async ({ context, page }) => {
  await openSignedOut(page);
  await signInThroughBanner(page);
  expect(await compare(page)).toEqual({ ok: true, redacted: [] });
  // A same-origin page that does not boot the app, as a 'remove data from this device' action would.
  const other = await context.newPage();
  await other.goto('/favicon.svg');
  const deleted = await other.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const req = indexedDB.deleteDatabase('fc-mobile');
        req.onsuccess = () => resolve('deleted');
        req.onerror = () => resolve(`error ${String(req.error?.name)}`);
        req.onblocked = () => resolve('blocked');
      }),
  );
  expect(deleted).toBe('deleted');
  expect(await compare(page)).toMatchObject({ ok: false, code: 'Unauthenticated' });
  expect(await status(page)).toBe('signed-out');
  await expect(page.getByRole('status').filter({ hasText: /sign in to sync your collection/i })).toBeVisible();
  expect(page.url()).toBe(HOME);
});

test('a sign-in cancelled at the IdP offers a way back to the collection', async ({ context, page }) => {
  await openSignedOut(page);
  await context.route(`${state.issuer.authorizationEndpoint}**`, async (route) => {
    const q = new URL(route.request().url()).searchParams;
    const back = new URL(q.get('redirect_uri')!);
    back.search = new URLSearchParams({ error: 'access_denied', error_description: 'User cancelled', state: q.get('state')! }).toString();
    await route.fulfill({ status: 302, headers: { location: back.toString() } });
  });
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Sign-in did not finish.')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('access_denied: User cancelled')).toBeVisible();
  await page.getByRole('button', { name: 'Back to your collection' }).click();
  await expect.poll(() => page.url()).toBe(HOME);
  await expect(page.getByRole('navigation').getByText(/collection/i)).toBeVisible();
  expect(await status(page)).toBe('signed-out');
});

test('a sign-in whose code exchange cannot reach the IdP offers a way back', async ({ context, page }) => {
  await openSignedOut(page);
  await context.route(`${state.issuer.tokenEndpoint}**`, (route) => route.abort('internetdisconnected'));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Sign-in did not finish.')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/could not be reached/)).toBeVisible();
  await page.getByRole('button', { name: 'Back to your collection' }).click();
  await expect.poll(() => page.url()).toBe(HOME);
  await expect(page.getByRole('navigation').getByText(/collection/i)).toBeVisible();
});

test('a crafted /callback link repeats nothing it says and offers a way back', async ({ page }) => {
  await openSignedOut(page);
  await page.goto('/callback?error=account_locked&error_description=Call+support+on+555-0100+to+unlock');
  await expect(page.getByText('Sign-in did not finish.')).toBeVisible();
  await expect(page.getByText(/link has expired or was already used/)).toBeVisible();
  await expect(page.getByText(/555-0100|account_locked/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to your collection' }).click();
  await expect.poll(() => page.url()).toBe(HOME);
});

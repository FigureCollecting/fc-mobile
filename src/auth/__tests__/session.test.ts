import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { AuthRequiredError, LoginError, NetworkError } from '../errors';
import { sha256Base64url } from '../pkce';
import { TokenError } from '../oidc';
import type { LocalDb } from '../../storage/localDb';
import { APP_ORIGIN, IDP_ORIGIN, SUB_A, SUB_B, T0 } from './fakes';
import { World, compareInit, compareUrl } from './world';

const TEN_MIN = 600_000;
const TWENTY_MIN = 1_200_000;

async function authRows(db: LocalDb): Promise<Record<string, unknown>> {
  const keys = await db.getAllKeys('auth');
  const values = await db.getAll('auth');
  return Object.fromEntries(keys.map((k, i) => [String(k), values[i]]));
}

async function seedOutbox(db: LocalDb, sub: string): Promise<number> {
  return db.add('outbox', {
    sub,
    facet_key: 'holding/head-1/status',
    op: 'upsert',
    payload: '{"status":"owned"}',
    edit_version: 'v1',
    base_version: null,
    state: 'PENDING',
    attempts: 0,
    created_at: 1,
  });
}

describe('sign-in', () => {
  it('keeps the PKCE verifier, state and nonce in IndexedDB and navigates to the IdP', async () => {
    const world = await World.create();
    const tab = world.tab();
    await tab.signIn('/figure/7');
    const url = new URL(world.navigations[0]!);
    const state = url.searchParams.get('state')!;
    const rows = await authRows(await world.inspect());
    const pending = rows[`pending:${state}`] as { verifier: string; nonce: string; returnTo: string; redirectUri: string };
    expect(pending).toMatchObject({ returnTo: '/figure/7', redirectUri: `${APP_ORIGIN}/callback` });
    expect(url.searchParams.get('code_challenge')).toBe(await sha256Base64url(pending.verifier));
    expect(url.searchParams.get('nonce')).toBe(pending.nonce);
    expect(url.searchParams.get('redirect_uri')).toBe(`${APP_ORIGIN}/callback`);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('completes at /callback: tokens per sub, a non-extractable device key, and enrolment', async () => {
    const world = await World.create();
    const tab = world.tab();
    expect(await world.signIn(tab, SUB_A, '/figure/7')).toEqual({ sub: SUB_A, returnTo: '/figure/7' });
    expect(tab.status.value).toBe('signed-in');
    expect(tab.sub()).toBe(SUB_A);
    const db = await world.inspect();
    const rows = await authRows(db);
    expect(rows['current']).toEqual({ sub: SUB_A });
    expect(rows[`tokens:${SUB_A}`]).toMatchObject({ sub: SUB_A, refreshToken: expect.stringMatching(/^rt-/) });
    expect(Object.keys(rows).some((k) => k.startsWith('pending:'))).toBe(false);
    const key = await db.get('device_key', SUB_A);
    expect(key?.['privateKey']).toBeInstanceOf(CryptoKey);
    expect((key?.['privateKey'] as CryptoKey).extractable).toBe(false);
    expect(key?.['deviceId']).toBe(world.coord.devices.get(key?.['jkt'] as string));
    expect(world.statuses()).toEqual([401, 201]);
    // The shared test setup's legacy store may leave 'auth-storage'; no token of ours is anywhere in Web Storage.
    const tokens = rows[`tokens:${SUB_A}`] as { accessToken: string; refreshToken: string; idToken: string };
    const webStorage = JSON.stringify([{ ...localStorage }, { ...sessionStorage }]);
    for (const secret of [tokens.accessToken, tokens.refreshToken, tokens.idToken]) expect(webStorage).not.toContain(secret);
  });

  it('refuses a replayed, unknown or expired state, and an IdP error, consuming the attempt', async () => {
    const world = await World.create();
    const tab = world.tab();
    await tab.signIn();
    const callback = world.idp.authorize(world.navigations[0]!);
    await tab.completeSignIn(callback);
    await expect(tab.completeSignIn(callback)).rejects.toMatchObject({ code: 'unknown_state' });
    await expect(tab.completeSignIn(`${APP_ORIGIN}/callback?code=x`)).rejects.toBeInstanceOf(LoginError);

    await tab.signIn();
    const late = world.idp.authorize(world.navigations[1]!);
    world.t += TEN_MIN + 1;
    await expect(tab.completeSignIn(late)).rejects.toMatchObject({ code: 'expired_state', returnTo: '/' });

    await tab.signIn();
    const state = new URL(world.navigations[2]!).searchParams.get('state')!;
    await expect(tab.completeSignIn(`${APP_ORIGIN}/callback?error=access_denied&state=${state}`)).rejects.toMatchObject({
      code: 'access_denied',
    });
    const rows = await authRows(await world.inspect());
    expect(Object.keys(rows).filter((k) => k.startsWith('pending:'))).toEqual([]);
  });

  it('carries the IdP error description and the way back only for a login this device started', async () => {
    const world = await World.create();
    const tab = world.tab();
    await tab.signIn('/figure/7');
    const state = new URL(world.navigations[0]!).searchParams.get('state')!;
    const cancelled = await tab
      .completeSignIn(`${APP_ORIGIN}/callback?error=access_denied&error_description=User+cancelled&state=${state}`)
      .catch((e: unknown) => e);
    expect(cancelled).toBeInstanceOf(LoginError);
    expect(cancelled).toMatchObject({ code: 'access_denied', message: 'access_denied: User cancelled', returnTo: '/figure/7' });

    // A crafted link with no pending login: nothing from it is repeated back.
    const crafted = await tab
      .completeSignIn(`${APP_ORIGIN}/callback?error=account_locked&error_description=Call+support+on+555-0100`)
      .catch((e: unknown) => e);
    expect(crafted).toMatchObject({ code: 'unknown_state', message: 'unknown_state', returnTo: undefined });
    const forged = await tab
      .completeSignIn(`${APP_ORIGIN}/callback?error=account_locked&error_description=Call+555-0100&state=guessed`)
      .catch((e: unknown) => e);
    expect(forged).toMatchObject({ code: 'unknown_state', message: 'unknown_state' });

    await tab.signIn('/figure/9');
    const bare = new URL(world.navigations[1]!).searchParams.get('state')!;
    await expect(tab.completeSignIn(`${APP_ORIGIN}/callback?state=${bare}`)).rejects.toMatchObject({
      code: 'invalid_request',
      returnTo: '/figure/9',
    });
  });

  it('keeps the way back when the code exchange fails', async () => {
    const world = await World.create();
    const tab = world.tab();
    await tab.signIn('/figure/7');
    const callback = world.idp.authorize(world.navigations[0]!);
    world.net.offline = true;
    const offline = await tab.completeSignIn(callback).catch((e: unknown) => e);
    expect(offline).toBeInstanceOf(LoginError);
    expect(offline).toMatchObject({ code: 'network', returnTo: '/figure/7' });
    expect((offline as Error).cause).toBeInstanceOf(NetworkError);
    world.net.offline = false;

    await tab.signIn('/figure/8');
    const refused = world.idp.authorize(world.navigations[1]!).replace(/code=[^&]+/, 'code=wrong');
    const grant = await tab.completeSignIn(refused).catch((e: unknown) => e);
    expect(grant).toMatchObject({ code: 'invalid_grant', returnTo: '/figure/8' });
    expect((grant as Error).cause).toBeInstanceOf(TokenError);
  });

  it('refuses a code exchange that returns no ID token', async () => {
    const world = await World.create();
    const idp = world.idp.handler;
    world.net.route(IDP_ORIGIN, async (req) => {
      const res = await idp(req);
      const { id_token: _dropped, ...rest } = (await res.json()) as Record<string, unknown>;
      return Response.json(rest, { status: res.status });
    });
    const tab = world.tab();
    await tab.signIn();
    await expect(tab.completeSignIn(world.idp.authorize(world.navigations[0]!))).rejects.toMatchObject({
      code: 'invalid_id_token',
    });
  });

  it('refuses tokens whose ID token was minted for another login', async () => {
    const world = await World.create();
    const tab = world.tab();
    await tab.signIn();
    const url = new URL(world.navigations[0]!);
    url.searchParams.set('nonce', 'someone-else');
    await expect(tab.completeSignIn(world.idp.authorize(url.toString()))).rejects.toMatchObject({ code: 'invalid_id_token' });
    expect(tab.status.value).not.toBe('signed-in');
  });

  it('only returns to a same-origin path', async () => {
    const world = await World.create();
    for (const target of ['//evil.test/x', 'https://evil.test/', 'javascript:alert(1)']) {
      const tab = world.tab();
      expect((await world.signIn(tab, SUB_A, target)).returnTo).toBe('/');
    }
  });

  it('still signs in when enrolment cannot reach the coordinator, and enrols before the next call', async () => {
    const world = await World.create();
    const coordinator = world.coord.handler;
    world.net.route(APP_ORIGIN, async () => {
      throw new TypeError('Failed to fetch');
    });
    const tab = world.tab();
    await world.signIn(tab);
    expect(tab.status.value).toBe('signed-in');
    expect((await (await world.inspect()).get('device_key', SUB_A))?.['deviceId']).toBeUndefined();
    world.net.route(APP_ORIGIN, coordinator);
    const res = await tab.fetch(compareUrl, compareInit());
    expect(res.status).toBe(200);
    expect(world.coord.log.map((e) => `${e.path} ${e.status}`)).toEqual([
      '/api/auth/devices 401',
      '/api/auth/devices 201',
      '/api/coordinator.v1.CompareService/Compare 200',
    ]);
  });

  it('gives each user on the device their own key', async () => {
    const world = await World.create();
    await world.signIn(world.tab(), SUB_A);
    await world.signIn(world.tab(), SUB_B);
    const db = await world.inspect();
    expect((await db.get('device_key', SUB_A))?.['jkt']).not.toBe((await db.get('device_key', SUB_B))?.['jkt']);
    expect(world.coord.devices.size).toBe(2);
  });
});

describe('start', () => {
  it('reports signed-out, then signed-in after a reload, from what IndexedDB holds', async () => {
    const world = await World.create();
    expect(await world.tab().start()).toBe('signed-out');
    await world.signIn(world.tab());
    const reloaded = world.tab();
    expect(await reloaded.start()).toBe('signed-in');
    expect(reloaded.sub()).toBe(SUB_A);
    const res = await reloaded.fetch(compareUrl, compareInit());
    expect(res.status).toBe(200);
  });

  it('asks for an interactive sign-in when an expired session has no refresh token', async () => {
    const world = await World.create();
    world.idp.offlineAccess = false;
    await world.signIn(world.tab());
    world.t += TEN_MIN;
    expect(await world.tab().start()).toBe('reauth-required');
  });

  it('retries a start that could not open the store, and a call waiting on start recovers with it', async () => {
    const world = await World.create();
    await world.signIn(world.tab());
    let blocked = true;
    const tab = world.tab({ db: (open) => (blocked ? Promise.reject(new DOMException('newer store', 'VersionError')) : open()) });
    await expect(tab.start()).rejects.toMatchObject({ name: 'VersionError' });
    await expect(tab.fetch(compareUrl, compareInit())).rejects.toMatchObject({ name: 'VersionError' });
    blocked = false;
    const res = await tab.fetch(compareUrl, compareInit()).catch((err: unknown) => err);
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(200);
    expect(await tab.start()).toBe('signed-in');
    expect(tab.status.value).toBe('signed-in');
  });

  it('gives concurrent callers one start, whether it fails or succeeds', async () => {
    const world = await World.create();
    await world.signIn(world.tab());
    let asks = 0;
    const tab = world.tab({
      db: (open) => (++asks === 1 ? Promise.reject(new DOMException('newer store', 'VersionError')) : open()),
    });
    const failed = await Promise.allSettled([tab.start(), tab.start()]);
    expect(failed.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(asks).toBe(1);
    await expect(Promise.all([tab.start(), tab.start()])).resolves.toEqual(['signed-in', 'signed-in']);
    expect(asks).toBe(2);
    expect(await tab.start()).toBe('signed-in');
    expect(asks).toBe(2);
  });
});

describe('refresh', () => {
  it('two tabs with an expired access token make exactly one refresh, and the old token is dead', async () => {
    const world = await World.create();
    const first = world.tab();
    await world.signIn(first);
    const second = world.tab();
    await second.start();
    const before = (await authRows(await world.inspect()))[`tokens:${SUB_A}`] as { refreshToken: string };
    world.t += TEN_MIN;
    const [a, b] = await Promise.all([first.fetch(compareUrl, compareInit()), second.fetch(compareUrl, compareInit())]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(world.idp.refreshCount()).toBe(1);
    expect(world.locks.requested.filter((n) => n === `fc-auth-refresh:${SUB_A}`).length).toBe(2);
    const reuse = await world.net.fetch(world.idp.config.tokenEndpoint, {
      method: 'POST',
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: before.refreshToken, client_id: 'fc-coordinator' }),
    });
    expect(await reuse.json()).toEqual({ error: 'invalid_grant' });
  });

  it('single-flights concurrent calls in one tab without Web Locks', async () => {
    const world = await World.create();
    const tab = world.tab({ locks: null });
    await world.signIn(tab);
    world.t += TEN_MIN;
    const replies = await Promise.all([1, 2, 3].map(() => tab.fetch(compareUrl, compareInit())));
    expect(replies.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(world.idp.refreshCount()).toBe(1);
  });

  it('after invalid_grant asks for sign-in, and re-login keeps the outbox and the device key', async () => {
    const world = await World.create();
    const tab = world.tab();
    await world.signIn(tab);
    const db = await world.inspect();
    const keyBefore = await db.get('device_key', SUB_A);
    const outboxId = await seedOutbox(db, SUB_A);
    world.idp.revokeAll(SUB_A);
    world.t += TEN_MIN;
    await expect(tab.fetch(compareUrl, compareInit())).rejects.toBeInstanceOf(AuthRequiredError);
    expect(tab.status.value).toBe('reauth-required');
    expect(world.navigations).toHaveLength(1);
    // A second call does not hit the token endpoint again.
    const tokenCalls = world.idp.tokenCalls.length;
    await expect(tab.fetch(compareUrl, compareInit())).rejects.toBeInstanceOf(AuthRequiredError);
    expect(world.idp.tokenCalls.length).toBe(tokenCalls);

    await world.signIn(tab);
    expect(tab.status.value).toBe('signed-in');
    const keyAfter = await db.get('device_key', SUB_A);
    expect(keyAfter?.['jkt']).toBe(keyBefore?.['jkt']);
    expect(keyAfter?.['deviceId']).toBe(keyBefore?.['deviceId']);
    expect(await db.get('outbox', outboxId)).toMatchObject({ sub: SUB_A, state: 'PENDING' });
    expect(world.coord.devices.size).toBe(1);
    expect((await tab.fetch(compareUrl, compareInit())).status).toBe(200);
  });

  it('without offline_access falls back to an interactive sign-in, never the token endpoint', async () => {
    const world = await World.create();
    world.idp.offlineAccess = false;
    const tab = world.tab();
    await world.signIn(tab);
    world.t += TEN_MIN;
    const tokenCalls = world.idp.tokenCalls.length;
    await expect(tab.fetch(compareUrl, compareInit())).rejects.toBeInstanceOf(AuthRequiredError);
    expect(world.idp.tokenCalls.length).toBe(tokenCalls);
    expect(tab.status.value).toBe('reauth-required');
    await world.signIn(tab);
    expect((await tab.fetch(compareUrl, compareInit())).status).toBe(200);
  });

  it('offline with an expired token: offline status, no navigation, nothing removed', async () => {
    const world = await World.create();
    const tab = world.tab();
    await world.signIn(tab);
    const db = await world.inspect();
    const outboxId = await seedOutbox(db, SUB_A);
    const tokens = (await authRows(db))[`tokens:${SUB_A}`];
    world.t += TEN_MIN;
    world.net.offline = true;
    await expect(tab.fetch(compareUrl, compareInit())).rejects.toBeInstanceOf(NetworkError);
    expect(tab.status.value).toBe('offline');
    expect(world.navigations).toHaveLength(1);
    expect((await authRows(db))[`tokens:${SUB_A}`]).toEqual(tokens);
    expect(await db.get('outbox', outboxId)).toBeDefined();
    expect(await db.get('device_key', SUB_A)).toBeDefined();
    world.net.offline = false;
    expect((await tab.fetch(compareUrl, compareInit())).status).toBe(200);
    expect(tab.status.value).toBe('signed-in');
  });

  it('keeps the refresh token through an IdP outage', async () => {
    const world = await World.create();
    const tab = world.tab();
    await world.signIn(tab);
    world.t += TEN_MIN;
    world.idp.failNextWith = 503;
    await expect(tab.fetch(compareUrl, compareInit())).rejects.toBeInstanceOf(TokenError);
    expect(tab.status.value).toBe('signed-in');
    expect((await tab.fetch(compareUrl, compareInit())).status).toBe(200);
  });

  it('refuses a refresh that comes back for another user', async () => {
    const world = await World.create();
    const tab = world.tab();
    await world.signIn(tab);
    const db = await world.inspect();
    const b = world.tab();
    await world.signIn(b, SUB_B);
    const bTokens = (await authRows(db))[`tokens:${SUB_B}`] as { refreshToken: string };
    // A's stored refresh token swapped for B's: the answer names B, so it is not kept for A.
    const aTokens = (await authRows(db))[`tokens:${SUB_A}`] as Record<string, unknown>;
    await db.put('auth', { ...aTokens, refreshToken: bTokens.refreshToken }, `tokens:${SUB_A}`);
    await db.put('auth', { sub: SUB_A }, 'current');
    world.t += TEN_MIN;
    await expect(tab.fetch(compareUrl, compareInit())).rejects.toBeInstanceOf(AuthRequiredError);
    expect(tab.status.value).toBe('reauth-required');
  });
});

describe('edges', () => {
  it('keeps the refresh token, ID token and scope when a refresh does not rotate them', async () => {
    const world = await World.create();
    const tab = world.tab();
    await world.signIn(tab);
    const db = await world.inspect();
    const before = (await authRows(db))[`tokens:${SUB_A}`] as Record<string, unknown>;
    world.idp.bareRefresh = true;
    world.t += TEN_MIN;
    expect((await tab.fetch(compareUrl, compareInit())).status).toBe(200);
    const after = (await authRows(db))[`tokens:${SUB_A}`] as Record<string, unknown>;
    expect(after).toMatchObject({ refreshToken: before['refreshToken'], idToken: before['idToken'], scope: before['scope'] });
    expect(after['accessToken']).not.toBe(before['accessToken']);
    // No expires_in: assume five minutes.
    expect(after['expiresAt']).toBe(world.t + 300_000);
  });

  it('passes a login hint and reports the IdP error description', async () => {
    const world = await World.create();
    const tab = world.tab();
    await tab.signIn('/', 'collector-b@stack.test');
    const url = new URL(world.navigations[0]!);
    expect(url.searchParams.get('login_hint')).toBe('collector-b@stack.test');
    const state = url.searchParams.get('state')!;
    const err = await tab
      .completeSignIn(`${APP_ORIGIN}/callback?error=access_denied&error_description=MFA+failed&state=${state}`)
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'access_denied', message: 'access_denied: MFA failed' });
  });

  it('records when the coordinator enrolled the device', async () => {
    const world = await World.create();
    await world.signIn(world.tab());
    expect((await (await world.inspect()).get('device_key', SUB_A))?.['enrolledAt']).toBe(new Date(world.t).toISOString());
  });

  it('treats a refresh whose ID token does not validate as a dead session', async () => {
    const world = await World.create();
    const tab = world.tab();
    await world.signIn(tab);
    world.idp.idTokenOverride = 'not-a-jwt';
    world.t += TEN_MIN;
    await expect(tab.fetch(compareUrl, compareInit())).rejects.toBeInstanceOf(AuthRequiredError);
    expect(tab.status.value).toBe('reauth-required');
  });

  it('is signed out when another tab removed the tokens under it', async () => {
    const world = await World.create();
    const tab = world.tab();
    await world.signIn(tab);
    await (await world.inspect()).delete('auth', `tokens:${SUB_A}`);
    await expect(tab.fetch(compareUrl, compareInit())).rejects.toMatchObject({ reason: 'signed_out' });
    expect(tab.status.value).toBe('signed-out');
  });

  it('keeps the first key when two tabs create one for the same user at once', async () => {
    const world = await World.create();
    const { AuthStore } = await import('../store');
    const { generateDeviceKey } = await import('../deviceKey');
    const store = new AuthStore(await world.inspect());
    const [a, b] = await Promise.all([generateDeviceKey(SUB_A, 1), generateDeviceKey(SUB_A, 2)]);
    expect((await store.addDeviceKey(a)).jkt).toBe(a.jkt);
    expect((await store.addDeviceKey(b)).jkt).toBe(a.jkt);
    expect((await store.getDeviceKey(SUB_A))?.jkt).toBe(a.jkt);
  });
});

describe('a device clock far off', () => {
  it('signs in with the clock 20 min fast, before any coordinator reply has set it', async () => {
    const world = await World.create();
    const tab = world.tab({ skewMs: TWENTY_MIN });
    expect(await world.signIn(tab)).toMatchObject({ sub: SUB_A });
    expect(tab.status.value).toBe('signed-in');
    expect((await tab.fetch(compareUrl, compareInit())).status).toBe(200);
  });

  it('keeps the rotated refresh token on a cold start with the clock 20 min fast', async () => {
    const world = await World.create();
    await world.signIn(world.tab());
    const db = await world.inspect();
    const before = (await authRows(db))[`tokens:${SUB_A}`] as { refreshToken: string };
    const cold = world.tab({ skewMs: TWENTY_MIN });
    expect((await cold.fetch(compareUrl, compareInit())).status).toBe(200);
    expect(world.idp.refreshCount()).toBe(1);
    const after = (await authRows(db))[`tokens:${SUB_A}`] as { refreshToken?: string; reauth?: boolean };
    expect(after.refreshToken).toMatch(/^rt-/);
    expect(after.refreshToken).not.toBe(before.refreshToken);
    expect(after.reauth).toBeUndefined();
    expect(cold.status.value).toBe('signed-in');
  });

  it('never judges a refreshed ID token by its expiry, even once the clock is known', async () => {
    const world = await World.create();
    const tab = world.tab();
    await world.signIn(tab);
    expect(tab.clock.known).toBe(true);
    const cfg = world.idp.config;
    world.idp.idTokenOverride = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(cfg.issuer)
      .setAudience(cfg.clientId)
      .setSubject(SUB_A)
      .setExpirationTime(Math.floor(T0 / 1000) - 3600)
      .sign(new Uint8Array(32));
    world.t += TEN_MIN;
    expect((await tab.fetch(compareUrl, compareInit())).status).toBe(200);
    expect(tab.status.value).toBe('signed-in');
  });

  it('still refuses a sign-in whose ID token expired by the coordinator clock', async () => {
    const world = await World.create();
    const tab = world.tab();
    await world.signIn(tab);
    world.idp.now = () => world.t - 30 * 60_000;
    await tab.signIn();
    const callback = world.idp.authorize(world.navigations.at(-1)!);
    await expect(tab.completeSignIn(callback)).rejects.toMatchObject({ code: 'invalid_id_token' });
  });
});

describe('the local store closed under the session', () => {
  it('reopens after another page deletes the store, and is then signed out', async () => {
    const world = await World.create();
    const tab = world.tab();
    await world.signIn(tab);
    expect((await tab.fetch(compareUrl, compareInit())).status).toBe(200);
    await world.deleteStore();
    await expect(tab.fetch(compareUrl, compareInit())).rejects.toMatchObject({ reason: 'signed_out' });
    expect(tab.status.value).toBe('signed-out');
    expect(await world.tab().start()).toBe('signed-out');
  });
});

describe('timeouts', () => {
  it('a token endpoint that never answers is offline, and releases the refresh lock', async () => {
    const world = await World.create();
    const tab = world.tab({ timeoutMs: 50 });
    await world.signIn(tab);
    world.t += TEN_MIN;
    world.net.hanging.add(IDP_ORIGIN);
    await expect(tab.fetch(compareUrl, compareInit())).rejects.toBeInstanceOf(NetworkError);
    expect(tab.status.value).toBe('offline');
    world.net.hanging.clear();
    expect((await tab.fetch(compareUrl, compareInit())).status).toBe(200);
  });

  it('a coordinator that never answers enrolment does not hold /callback', async () => {
    const world = await World.create();
    const tab = world.tab({ timeoutMs: 50 });
    world.net.hanging.add(APP_ORIGIN);
    expect(await world.signIn(tab)).toMatchObject({ sub: SUB_A });
    expect((await (await world.inspect()).get('device_key', SUB_A))?.['deviceId']).toBeUndefined();
    world.net.hanging.clear();
    expect((await tab.fetch(compareUrl, compareInit())).status).toBe(200);
  });

  it('gives up on a hung code exchange as a network failure', async () => {
    const world = await World.create();
    const tab = world.tab({ timeoutMs: 50 });
    await tab.signIn();
    const callback = world.idp.authorize(world.navigations[0]!);
    world.net.hanging.add(IDP_ORIGIN);
    const err = await tab.completeSignIn(callback).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'network' });
    expect((err as Error).cause).toBeInstanceOf(NetworkError);
  });
});

describe('sign-out', () => {
  it('leaves through the exact registered post-logout URI and keeps the device key and outbox', async () => {
    const world = await World.create();
    const tab = world.tab();
    await world.signIn(tab);
    const db = await world.inspect();
    const outboxId = await seedOutbox(db, SUB_A);
    const idToken = ((await authRows(db))[`tokens:${SUB_A}`] as { idToken: string }).idToken;
    await tab.signOut();
    const url = new URL(world.navigations.at(-1)!);
    expect(`${url.origin}${url.pathname}`).toBe(world.idp.config.endSessionEndpoint);
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe(`${APP_ORIGIN}/`);
    expect(url.searchParams.get('id_token_hint')).toBe(idToken);
    expect(tab.status.value).toBe('signed-out');
    const rows = await authRows(db);
    expect(rows[`tokens:${SUB_A}`]).toBeUndefined();
    expect(rows['current']).toBeUndefined();
    expect(await db.get('device_key', SUB_A)).toBeDefined();
    expect(await db.get('outbox', outboxId)).toBeDefined();
    await expect(tab.fetch(compareUrl, compareInit())).rejects.toBeInstanceOf(AuthRequiredError);
    expect(await world.tab().start()).toBe('signed-out');
  });

  it('signs out cleanly when no one is signed in', async () => {
    const world = await World.create();
    const tab = world.tab();
    await tab.signOut();
    expect(new URL(world.navigations[0]!).searchParams.has('id_token_hint')).toBe(false);
    expect(tab.status.value).toBe('signed-out');
  });
});

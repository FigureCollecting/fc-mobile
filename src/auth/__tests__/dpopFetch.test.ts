import { describe, expect, it } from 'vitest';
import { decodeJwt } from 'jose';
import { AuthRequiredError, EnrolmentError, NetworkError } from '../errors';
import { APP_ORIGIN, IDP_ORIGIN, SUB_A } from './fakes';
import { World, compareInit, compareUrl } from './world';

describe('DPoP transport fetch', () => {
  it('learns the nonce from its first 401 and reuses it afterwards', async () => {
    const world = await World.create();
    const tab = world.tab();
    await world.signIn(tab);
    expect(world.statuses()).toEqual([401, 201]);
    expect(world.coord.log[0]?.error).toBe('use_dpop_nonce');
    const from = world.coord.log.length;
    expect((await tab.fetch(compareUrl, compareInit())).status).toBe(200);
    expect((await tab.fetch('/api/auth/session')).status).toBe(200);
    expect(world.statuses(from)).toEqual([200, 200]);
  });

  it('recovers from a coordinator restart through one silent use_dpop_nonce retry', async () => {
    const world = await World.create();
    const tab = world.tab();
    await world.signIn(tab);
    world.coord.restart();
    const from = world.coord.log.length;
    const res = await tab.fetch(compareUrl, compareInit());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ coverage: { redacted: [] } });
    expect(world.statuses(from)).toEqual([401, 200]);
  });

  it('corrects iat for a device clock 90 s fast, from the Date header of the rejection', async () => {
    const world = await World.create();
    const tab = world.tab({ skewMs: 90_000 });
    await world.signIn(tab);
    expect(world.coord.log.map((e) => e.error ?? e.status)).toEqual(['invalid_dpop_proof', 201]);
    const from = world.coord.log.length;
    expect((await tab.fetch(compareUrl, compareInit())).status).toBe(200);
    expect(world.statuses(from)).toEqual([200]);
    expect(Math.abs(tab.clock.offsetMs() + 90_000)).toBeLessThanOrEqual(1_000);
  });

  it('also corrects a device clock that is slow', async () => {
    const world = await World.create();
    const tab = world.tab({ skewMs: -120_000 });
    await world.signIn(tab);
    expect((await tab.fetch(compareUrl, compareInit())).status).toBe(200);
  });

  it('refreshes once on invalid_token and replays the call with a fresh proof', async () => {
    const world = await World.create();
    const tab = world.tab();
    await world.signIn(tab);
    // The coordinator's clock is past the token's expiry while the device's is not.
    const serverNow = world.coord.serverNow;
    world.coord.serverNow = () => serverNow() + 600_000;
    world.idp.now = world.coord.serverNow;
    const from = world.coord.log.length;
    const res = await tab.fetch(compareUrl, compareInit());
    expect(res.status).toBe(200);
    expect(world.idp.refreshCount()).toBe(1);
    expect(world.coord.log.slice(from).map((e) => e.error ?? e.status)).toEqual(['invalid_token', 200]);
  });

  it('enters the sign-in-to-sync state when the token is still refused after one refresh', async () => {
    const world = await World.create();
    const tab = world.tab();
    await world.signIn(tab);
    world.idp.isValidAccess = () => false;
    const from = world.coord.log.length;
    const res = await tab.fetch(compareUrl, compareInit());
    expect(res.status).toBe(401);
    expect(world.idp.refreshCount()).toBe(1);
    expect(world.statuses(from)).toEqual([401, 401]);
    expect(tab.status.value).toBe('reauth-required');
    expect(world.navigations).toHaveLength(1);
  });

  it('retries a nonce at most once per call', async () => {
    const world = await World.create();
    const tab = world.tab();
    await world.signIn(tab);
    const handler = world.coord.handler;
    world.net.route(APP_ORIGIN, async (req) => {
      world.coord.restart();
      return handler(req);
    });
    const from = world.coord.log.length;
    expect((await tab.fetch(compareUrl, compareInit())).status).toBe(401);
    expect(world.statuses(from)).toEqual([401, 401]);
  });

  it('does not retry a proof the coordinator refuses for any other reason', async () => {
    const world = await World.create();
    const tab = world.tab();
    await world.signIn(tab);
    world.coord.devices.clear();
    const from = world.coord.log.length;
    expect((await tab.fetch(compareUrl, compareInit())).status).toBe(401);
    expect(world.coord.log.slice(from).map((e) => e.error)).toEqual(['invalid_dpop_proof']);
    expect(tab.status.value).toBe('signed-in');
  });

  it('binds htu to the origin and path, never the query (RFC 9449 4.2)', async () => {
    const world = await World.create();
    const tab = world.tab();
    await world.signIn(tab);
    const from = world.coord.log.length;
    expect((await tab.fetch(`${APP_ORIGIN}/api/auth/session?a=b#frag`)).status).toBe(200);
    expect(world.statuses(from)).toEqual([200]);
  });

  it('passes other replies through untouched', async () => {
    const world = await World.create();
    const tab = world.tab();
    await world.signIn(tab);
    const res = await tab.fetch(`${APP_ORIGIN}/api/nothing-here`, { method: 'GET' });
    expect(res.status).toBe(404);
  });

  it('reports a dropped connection as a NetworkError and a cancelled call as an AbortError', async () => {
    const world = await World.create();
    const tab = world.tab();
    await world.signIn(tab);
    world.net.offline = true;
    await expect(tab.fetch(compareUrl, compareInit())).rejects.toBeInstanceOf(NetworkError);
    expect(tab.status.value).toBe('signed-in');
    world.net.offline = false;
    const controller = new AbortController();
    controller.abort();
    await expect(tab.fetch(compareUrl, { ...compareInit(), signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('sends nothing while signed out', async () => {
    const world = await World.create();
    const tab = world.tab();
    await expect(tab.fetch(compareUrl, compareInit())).rejects.toBeInstanceOf(AuthRequiredError);
    expect(world.net.calls).toEqual([]);
  });

  it('surfaces a refused enrolment', async () => {
    const world = await World.create();
    const handler = world.coord.handler;
    world.net.route(APP_ORIGIN, async (req) =>
      new URL(req.url).pathname === '/api/auth/devices' ? Response.json({ error: 'account_closed' }, { status: 403 }) : handler(req),
    );
    const tab = world.tab();
    await world.signIn(tab);
    await expect(tab.fetch(compareUrl, compareInit())).rejects.toBeInstanceOf(EnrolmentError);
    expect(tab.sub()).toBe(SUB_A);
  });
});

describe('trace context: a random traceparent on our own API, and nowhere else', () => {
  const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/;
  const where = (r: Request): string => `${new URL(r.url).origin}${new URL(r.url).pathname}`;
  const trace = (r: Request | undefined): string | undefined => r?.headers.get('traceparent')?.split('-')[1];

  it('puts one on the enrolment and on a plain /api call; a nonce retry re-sends the same one', async () => {
    const world = await World.create();
    const tab = world.tab();
    await world.signIn(tab);
    await tab.fetch('/api/auth/session');
    const api = world.net.sent.filter((r) => new URL(r.url).origin === APP_ORIGIN);
    expect(api.map(where)).toEqual([`${APP_ORIGIN}/api/auth/devices`, `${APP_ORIGIN}/api/auth/devices`, `${APP_ORIGIN}/api/auth/session`]);
    for (const r of api) expect(r.headers.get('traceparent')).toMatch(TRACEPARENT);
    // the enrolment's use_dpop_nonce retry is the same request again
    expect(api[1]!.headers.get('traceparent')).toBe(api[0]!.headers.get('traceparent'));
    expect(trace(api[2])).not.toBe(trace(api[0]));
    for (const r of api) expect(r.headers.has('tracestate') || r.headers.has('baggage')).toBe(false);
  });

  it('sends none to the IdP, to any other origin, or to a same-origin path outside /api/', async () => {
    const world = await World.create();
    const tab = world.tab();
    await world.signIn(tab);
    const from = world.net.sent.length;
    for (const url of [
      'https://images.figurecollecting.com/d/abc.webp',
      'https://auth.mindsignals1.com/application/o/token/',
      '//images.figurecollecting.com/d/abc.webp',
    ]) {
      await expect(tab.fetch(url)).rejects.toBeInstanceOf(NetworkError);
    }
    await tab.fetch(`${APP_ORIGIN}/assets/app.js`);
    await tab.fetch('/apix/auth/session');
    await tab.fetch('/api');
    const off = world.net.sent.slice(from);
    expect(off.map(where)).toEqual([
      'https://images.figurecollecting.com/d/abc.webp',
      'https://auth.mindsignals1.com/application/o/token/',
      'https://images.figurecollecting.com/d/abc.webp',
      `${APP_ORIGIN}/assets/app.js`,
      `${APP_ORIGIN}/apix/auth/session`,
      `${APP_ORIGIN}/api`,
    ]);
    for (const r of off) expect(r.headers.has('traceparent')).toBe(false);
    const idp = world.net.sent.filter((r) => new URL(r.url).origin === IDP_ORIGIN);
    expect(idp.length).toBeGreaterThan(0);
    for (const r of idp) expect(r.headers.has('traceparent')).toBe(false);
  });

  it('keeps a traceparent the caller set, and the DPoP proof claims stay method, URL, time, token hash, nonce, id', async () => {
    const world = await World.create();
    const tab = world.tab();
    await world.signIn(tab);
    const given = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
    const from = world.net.sent.length;
    expect((await tab.fetch('/api/auth/session', { headers: { traceparent: given } })).status).toBe(200);
    const [req] = world.net.sent.slice(from);
    expect(req!.headers.get('traceparent')).toBe(given);
    const proof = decodeJwt(req!.headers.get('dpop')!);
    expect(Object.keys(proof).sort()).toEqual(['ath', 'htm', 'htu', 'iat', 'jti', 'nonce']);
    expect(proof).toMatchObject({ htm: 'GET', htu: `${APP_ORIGIN}/api/auth/session` });
  });

  it('never follows a redirect, so neither the DPoP proof nor the trace leaves our origin', async () => {
    const world = await World.create();
    const handler = world.coord.handler;
    world.net.route(APP_ORIGIN, async (req) =>
      new URL(req.url).pathname === '/api/auth/session'
        ? new Response(null, { status: 302, headers: { location: 'https://images.figurecollecting.com/d/abc.webp' } })
        : handler(req),
    );
    const tab = world.tab();
    await world.signIn(tab);
    await expect(tab.fetch('/api/auth/session')).rejects.toBeInstanceOf(NetworkError);
    expect(world.net.sent.filter((r) => new URL(r.url).origin !== APP_ORIGIN && new URL(r.url).origin !== IDP_ORIGIN)).toEqual([]);
    const api = world.net.sent.filter((r) => new URL(r.url).origin === APP_ORIGIN);
    expect(api.map((r) => r.redirect)).toEqual(['error', 'error', 'error']);
  });
});

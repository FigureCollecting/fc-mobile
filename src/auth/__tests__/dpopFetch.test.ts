import { describe, expect, it } from 'vitest';
import { AuthRequiredError, EnrolmentError, NetworkError } from '../errors';
import { APP_ORIGIN, SUB_A } from './fakes';
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

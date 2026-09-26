import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createE2eHooks, installE2eHooks } from '../e2eHooks';
import { createBrowserSession, getAuthSession } from '../index';
import { configuredOidc } from '../config';
import { defaultLocks, InTabLocks } from '../locks';
import { NetworkError } from '../errors';
import { World } from './world';
import { APP_ORIGIN, SUB_A } from './fakes';

describe('e2e hooks', () => {
  it('drive a Compare, the session route, sign-in and sign-out through the real session', async () => {
    const world = await World.create();
    const tab = world.tab();
    const hooks = createE2eHooks(tab);
    expect(await hooks.compare('04580416940269')).toMatchObject({ ok: false, code: 'Unauthenticated' });
    await world.signIn(tab);
    expect(hooks.status()).toBe('signed-in');
    expect(hooks.sub()).toBe(SUB_A);
    expect(await hooks.compare('04580416940269')).toEqual({ ok: true, redacted: [] });
    expect(await hooks.session()).toMatchObject({ status: 200, body: { deviceId: expect.any(String) } });
    await hooks.signIn('/x');
    expect(new URL(world.navigations.at(-1)!).searchParams.get('client_id')).toBe('fc-coordinator');
    await hooks.signOut();
    expect(hooks.status()).toBe('signed-out');
  });

  it('report an answer without coverage as nothing redacted', async () => {
    const world = await World.create();
    const tab = world.tab();
    await world.signIn(tab);
    const handler = world.coord.handler;
    world.net.route(APP_ORIGIN, async (req) => {
      const res = await handler(req);
      return res.status === 200 ? Response.json({ resultJson: '{}' }, { headers: res.headers }) : res;
    });
    expect(await createE2eHooks(tab).compare('1')).toEqual({ ok: true, redacted: [] });
  });

  it('install on a target object', () => {
    const target: { __fcAuth?: unknown } = {};
    installE2eHooks({} as never, target);
    expect(target.__fcAuth).toBeDefined();
  });
});

describe('browser wiring', () => {
  it('getAuthSession is one session per page, on the configured IdP, that opens nothing until used', () => {
    const session = getAuthSession();
    expect(getAuthSession()).toBe(session);
    expect(session.status.value).toBe('loading');
    expect(session.config).toEqual(configuredOidc());
  });

  it('createBrowserSession uses the window it is given for storage, fetch and navigation', async () => {
    const assign = vi.fn();
    const fetchFn = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const session = createBrowserSession({ location: { origin: APP_ORIGIN, assign }, fetch: fetchFn, indexedDB: new IDBFactory() });
    expect(await session.start()).toBe('signed-out');
    await session.signIn('/');
    const authorize = new URL(assign.mock.calls[0]![0] as string);
    expect(authorize.searchParams.get('redirect_uri')).toBe(`${APP_ORIGIN}/callback`);
    const state = authorize.searchParams.get('state')!;
    await expect(session.completeSignIn(`${APP_ORIGIN}/callback?code=c&state=${state}`)).rejects.toBeInstanceOf(NetworkError);
    expect(fetchFn).toHaveBeenCalledWith(configuredOidc().tokenEndpoint, expect.objectContaining({ method: 'POST' }));
  });
});

describe('locks', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'locks');
  });

  it('use Web Locks when the browser has them', async () => {
    const request = vi.fn((_name: string, cb: () => Promise<number>) => cb());
    Object.defineProperty(navigator, 'locks', { value: { request }, configurable: true });
    expect(await defaultLocks().request('n', async () => 7)).toBe(7);
    expect(request).toHaveBeenCalledWith('n', expect.any(Function));
  });

  it('fall back to an in-tab queue that keeps running after a failure', async () => {
    const locks = defaultLocks();
    expect(locks).toBeInstanceOf(InTabLocks);
    const order: string[] = [];
    const first = locks.request('n', async () => {
      order.push('a');
      throw new Error('a failed');
    });
    const second = locks.request('n', async () => {
      order.push('b');
      return 'b';
    });
    await expect(first).rejects.toThrow('a failed');
    expect(await second).toBe('b');
    expect(order).toEqual(['a', 'b']);
  });
});

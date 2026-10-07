// A newer build owns the local store: this page's code cannot open it, so the
// session asks for a reload instead of reporting 'signed-in' while every call
// fails, and a page that boots into that state never stays 'loading'.
import { describe, expect, it } from 'vitest';
import type { LocalDb } from '../../storage/localDb';
import { ReloadRequiredError } from '../errors';
import type { AuthSession, AuthStatus } from '../session';
import { SUB_A } from './fakes';
import { World, compareInit, compareUrl } from './world';

const settle = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

/** A newer build opens the store at v3 and closes it again. */
async function newerBuildUpgrades(world: World): Promise<void> {
  (await settle(world.factory.open('fc-mobile', 3))).close();
}

/**
 * A tab whose store a newer build upgrades the moment one chosen read or write on it has
 * settled: the session is still between that step and its next one when the upgrade lands.
 */
function upgradedMidway(world: World): { tab: AuthSession; after: (method: 'get' | 'put', key: string) => void; seen: AuthStatus[] } {
  let armed: { method: string; key: string } | undefined;
  const tab = world.tab({
    db: async (open) => {
      const db = await open();
      return new Proxy(db, {
        get(target, prop) {
          const value: unknown = Reflect.get(target, prop, target);
          if (typeof value !== 'function') return value;
          if (prop !== 'get' && prop !== 'put') return value.bind(target);
          return async (...args: unknown[]) => {
            const out: unknown = await value.apply(target, args);
            const key = prop === 'get' ? args[1] : args[2];
            if (armed?.method === prop && armed.key === key) {
              armed = undefined;
              await newerBuildUpgrades(world);
            }
            return out;
          };
        },
      }) as LocalDb;
    },
  });
  const seen: AuthStatus[] = [];
  tab.status.subscribe((s) => seen.push(s));
  return { tab, after: (method, key) => (armed = { method, key }), seen };
}

/** Once the tab heard of the newer build, nothing it was still doing may call it signed in. */
const signedInAfterReload = (seen: AuthStatus[]): AuthStatus[] =>
  seen.slice(seen.indexOf('reload-required')).filter((s) => s === 'signed-in');

describe('a newer build takes the local store', () => {
  it('moves a signed-in tab to reload-required at once, before any call fails', async () => {
    const world = await World.create();
    const tab = world.tab();
    await world.signIn(tab);
    expect((await tab.fetch(compareUrl, compareInit())).status).toBe(200);
    await newerBuildUpgrades(world);
    expect(tab.status.value).toBe('reload-required');
  });

  it('fails every call as reload-required, carrying the VersionError, and never reaches the network', async () => {
    const world = await World.create();
    const tab = world.tab();
    await world.signIn(tab);
    await newerBuildUpgrades(world);
    const from = world.net.calls.length;
    const err = await tab.fetch(compareUrl, compareInit()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReloadRequiredError);
    expect((err as Error).cause).toMatchObject({ name: 'VersionError' });
    await expect(tab.signIn('/')).rejects.toBeInstanceOf(ReloadRequiredError);
    expect(tab.status.value).toBe('reload-required');
    expect(world.net.calls.slice(from)).toEqual([]);
  });

  it('a page loaded while the newer store exists is reload-required, not loading', async () => {
    const world = await World.create();
    await world.signIn(world.tab());
    await newerBuildUpgrades(world);
    const tab = world.tab();
    await expect(tab.start()).rejects.toBeInstanceOf(ReloadRequiredError);
    expect(tab.status.value).toBe('reload-required');
  });

  it('goes back to what the store holds once the obstacle clears', async () => {
    const world = await World.create();
    const tab = world.tab();
    await world.signIn(tab);
    await newerBuildUpgrades(world);
    expect(tab.status.value).toBe('reload-required');
    await world.deleteStore();
    await expect(tab.fetch(compareUrl, compareInit())).rejects.toMatchObject({ reason: 'signed_out' });
    expect(tab.status.value).toBe('signed-out');
  });

  it('is signed in again when the newer build abandons its upgrade and the store is still ours', async () => {
    const world = await World.create();
    const tab = world.tab();
    await world.signIn(tab);
    const up = world.factory.open('fc-mobile', 3);
    up.onupgradeneeded = () => up.transaction!.abort();
    await settle(up).catch(() => undefined);
    expect(tab.status.value).toBe('reload-required');
    expect((await tab.fetch(compareUrl, compareInit())).status).toBe(200);
    expect(tab.status.value).toBe('signed-in');
  });

  it('a store deleted by another page is not a newer build', async () => {
    const world = await World.create();
    const tab = world.tab();
    await world.signIn(tab);
    await world.deleteStore();
    expect(tab.status.value).toBe('signed-in');
  });
});

describe('a newer build upgrades the store while this tab is between steps', () => {
  it.each([
    ['signed in, after the current-user read', true, 'current'],
    ['signed in, after the token read', true, `tokens:${SUB_A}`],
    ['signed out, after the current-user read', false, 'current'],
  ])('boot ends reload-required: %s', async (_, signedIn, key) => {
    const world = await World.create();
    if (signedIn) await world.signIn(world.tab());
    const { tab, after, seen } = upgradedMidway(world);
    after('get', key);
    expect(await tab.boot()).toBe('reload-required');
    expect(tab.status.value).toBe('reload-required');
    expect(seen).toEqual(['loading', 'reload-required']);
  });

  it('a sign-in whose last write lands just before the upgrade keeps its tokens but is not reported signed in', async () => {
    const world = await World.create();
    const { tab, after, seen } = upgradedMidway(world);
    after('put', 'current');
    expect(await world.signIn(tab)).toEqual({ sub: SUB_A, returnTo: '/' });
    expect(tab.status.value).toBe('reload-required');
    expect(seen).toContain('reload-required');
    expect(signedInAfterReload(seen)).toEqual([]);
  });

  it('a refresh whose rotated tokens land just before the upgrade is not reported signed in', async () => {
    const world = await World.create();
    const { tab, after, seen } = upgradedMidway(world);
    await world.signIn(tab);
    world.t += 600_000;
    after('put', `tokens:${SUB_A}`);
    await expect(tab.fetch(compareUrl, compareInit())).rejects.toBeInstanceOf(ReloadRequiredError);
    expect(tab.status.value).toBe('reload-required');
    expect(seen).toContain('reload-required');
    expect(signedInAfterReload(seen)).toEqual([]);
  });
});

describe('an open that fails for another reason', () => {
  it('keeps its own error and no reload banner on a call: the next call retries it', async () => {
    const world = await World.create();
    await world.signIn(world.tab());
    let broken = false;
    const tab = world.tab({ db: (open) => (broken ? Promise.reject(new DOMException('racing delete', 'AbortError')) : open()) });
    expect(await tab.start()).toBe('signed-in');
    broken = true;
    await expect(tab.fetch(compareUrl, compareInit())).rejects.toMatchObject({ name: 'AbortError' });
    expect(tab.status.value).toBe('signed-in');
    broken = false;
    expect((await tab.fetch(compareUrl, compareInit())).status).toBe(200);
  });
});

describe('boot', () => {
  it('reports what start reports', async () => {
    const world = await World.create();
    expect(await world.tab().boot()).toBe('signed-out');
    await world.signIn(world.tab());
    const tab = world.tab();
    expect(await tab.boot()).toBe('signed-in');
    expect(tab.status.value).toBe('signed-in');
  });

  it('never rejects: a newer store at boot is reload-required', async () => {
    const world = await World.create();
    await newerBuildUpgrades(world);
    const tab = world.tab();
    expect(await tab.boot()).toBe('reload-required');
    expect(tab.status.value).toBe('reload-required');
  });

  it('never rejects: a store that cannot open for any reason is reload-required, and the next call retries it', async () => {
    const world = await World.create();
    await world.signIn(world.tab());
    let broken = true;
    const tab = world.tab({ db: (open) => (broken ? Promise.reject(new DOMException('backing store', 'UnknownError')) : open()) });
    expect(await tab.boot()).toBe('reload-required');
    expect(tab.status.value).toBe('reload-required');
    broken = false;
    expect((await tab.fetch(compareUrl, compareInit())).status).toBe(200);
    expect(tab.status.value).toBe('signed-in');
  });
});

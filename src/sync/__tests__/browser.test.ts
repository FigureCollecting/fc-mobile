import { describe, expect, it, vi } from 'vitest';
import { signal } from '@preact/signals';
import { ufFacetKey } from '@figurecollecting/fc-api-contract';
import type { AuthStatus } from '../../auth/statusGate';
import type { LocalDb } from '../../storage/localDb';
import { HELD_STATUSES, NotEnrolledError, createBrowserSync, startBrowserSync, storeProvider, type SyncSession } from '../browser';
import { FakeCoordinator } from './fakeCoordinator';
import { DEVICE, OTHER_DEVICE, T0, freshDb } from './harness';
import { headOf, seedCopies } from './engineSupport';

function session(db: LocalDb, status: AuthStatus = 'signed-in') {
  const state = signal<AuthStatus>(status);
  let sub: string | undefined = 'user-a';
  let deviceId: string | undefined = DEVICE;
  let current = db;
  return {
    status: state,
    fetch: vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }),
    sub: () => sub,
    deviceKey: vi.fn(async () => (deviceId === undefined ? {} : { deviceId })),
    localDb: vi.fn(async () => current),
    set: {
      sub: (s: string | undefined) => (sub = s),
      device: (d: string | undefined) => (deviceId = d),
      db: (d: LocalDb) => (current = d),
    },
  } satisfies SyncSession & Record<string, unknown>;
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('storeProvider', () => {
  it('keeps one store while the connection, user and device stay, and opens a fresh one when any changes', async () => {
    const { db } = await freshDb();
    const s = session(db);
    const provide = storeProvider(s);
    const first = await provide();
    expect(await provide()).toBe(first);
    s.set.device(OTHER_DEVICE);
    const second = await provide();
    expect(second).not.toBe(first);
    expect(second.deviceId).toBe(OTHER_DEVICE);
    s.set.sub('user-b');
    const third = await provide();
    expect(third.sub).toBe('user-b');
    const { db: cleared } = await freshDb(); // site data cleared: a new, empty connection
    s.set.db(cleared);
    const fourth = await provide();
    expect(fourth).not.toBe(third);
    expect((await fourth.getMeta()).cursor).toBe('');
  });

  it('refuses until the device is enrolled and a user is signed in', async () => {
    const { db } = await freshDb();
    const s = session(db);
    s.set.device(undefined);
    await expect(storeProvider(s)()).rejects.toBeInstanceOf(NotEnrolledError);
    s.set.device(DEVICE);
    s.set.sub(undefined);
    await expect(storeProvider(s)()).rejects.toThrow('not enrolled');
  });

  it('forgets a store that failed to open, so the next call tries again', async () => {
    const { db } = await freshDb();
    const s = session(db);
    const provide = storeProvider(s);
    db.close();
    await expect(provide()).rejects.toThrow();
    const { db: reopened } = await freshDb();
    s.set.db(reopened);
    await expect(provide()).resolves.toBeDefined();
  });
});

describe('createBrowserSync', () => {
  it('holds while the session is loading or needs a sign-in, queues edits, and resumes on signed-in', async () => {
    const { db } = await freshDb();
    const s = session(db, 'loading');
    const server = new FakeCoordinator(T0);
    seedCopies(server, 3);
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
    const { engine, dispose } = createBrowserSync({ session: s, sync: server.sync, catalog: server.catalog, window: win, document: doc });
    await vi.waitFor(() => expect(engine.state.value.phase).toBe('paused'));
    expect(server.calls).toEqual([]);
    s.status.value = 'reauth-required';
    await engine.write((store) => store.writeFacet(ufFacetKey(headOf(0), 'note'), { note: 'kept' }));
    await settle();
    expect(server.calls).toEqual([]);
    expect(engine.state.value.pending).toBe(1);
    s.status.value = 'signed-in';
    await vi.waitFor(() => expect(engine.state.value).toMatchObject({ phase: 'idle', pending: 0, reachability: 'reachable' }));
    expect(server.facets.get(ufFacetKey(headOf(0), 'note'))).toBeDefined();
    expect((await engine.read((store) => store.getView())).copies).toHaveLength(3);
    win.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(server.count('status')).toBe(2));
    dispose();
    s.status.value = 'offline';
    win.dispatchEvent(new Event('online'));
    await settle();
    expect(server.count('status')).toBe(2);
  });

  it('calls the coordinator through the session DPoP fetch under /api when no clients are given', async () => {
    const { db } = await freshDb();
    const s = session(db);
    const { engine, dispose } = createBrowserSync({ session: s });
    await vi.waitFor(() => expect(engine.state.value.reachability).toBe('unreachable'));
    expect(String(s.fetch.mock.calls[0]![0])).toBe('/api/coordinator.v1.SyncService/Status');
    dispose();
  });

  it('holds in exactly the statuses only a sign-in or reload clears', () => {
    expect([...HELD_STATUSES].sort()).toEqual(['loading', 'reauth-required', 'reload-required', 'signed-out']);
  });
});

describe('startBrowserSync', () => {
  it('is one sync per session on the page window and document', async () => {
    const { db } = await freshDb();
    const s = session(db, 'signed-out');
    const sync = startBrowserSync(s);
    expect(startBrowserSync(s)).toBe(sync);
    const add = vi.spyOn(window, 'addEventListener');
    const other = startBrowserSync(session(db, 'signed-out'));
    expect(other).not.toBe(sync);
    expect(add.mock.calls.map((c) => c[0])).toEqual(['online', 'pageshow']);
    sync.dispose();
    other.dispose();
    add.mockRestore();
  });
});

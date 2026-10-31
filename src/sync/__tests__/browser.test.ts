import { afterEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@preact/signals';
import { clone, toBinary } from '@bufbuild/protobuf';
import { PushRequestSchema, isTraceId, ufFacetKey, type PushRequest } from '@figurecollecting/fc-api-contract';
import { diagIdsDefault, setDiagIds } from '../../auth/diagIds';
import { NetworkError } from '../../auth/errors';
import type { AuthStatus } from '../../auth/statusGate';
import type { LocalDb } from '../../storage/localDb';
import { UserStore } from '../../storage/userStore';
import { HELD_STATUSES, IDLE_POLL_MS, NotEnrolledError, createBrowserSync, startBrowserSync, storeProvider, type SyncSession } from '../browser';
import { FakeCoordinator } from './fakeCoordinator';
import { DEVICE, OTHER_DEVICE, T0, freshDb, openStore } from './harness';
import { headOf, seedCopies } from './engineSupport';

function session(db: LocalDb, status: AuthStatus = 'signed-in') {
  const state = signal<AuthStatus>(status);
  let sub: string | undefined = 'user-a';
  let deviceId: string | undefined = DEVICE;
  let current = db;
  return {
    status: state,
    // The DPoP fetch reports a request that never got an answer as a NetworkError.
    fetch: vi.fn(async (_input: string, _init?: RequestInit) => {
      throw new NetworkError(new TypeError('Failed to fetch'));
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

  it('keeps a newer store when an older open fails after it', async () => {
    const { db } = await freshDb();
    const { db: other } = await freshDb();
    const s = session(db);
    s.localDb.mockResolvedValueOnce(db).mockResolvedValue(other);
    let fail!: (err: Error) => void;
    const real = UserStore.open.bind(UserStore);
    const open = vi
      .spyOn(UserStore, 'open')
      .mockImplementationOnce(() => new Promise((_resolve, reject) => (fail = reject)))
      .mockImplementation(real);
    const provide = storeProvider(s);
    const older = provide();
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    const newer = await provide();
    fail(new Error('the old connection closed'));
    await expect(older).rejects.toThrow('closed');
    expect(await provide()).toBe(newer);
    expect(open).toHaveBeenCalledTimes(2);
    open.mockRestore();
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

  it('runs no pass when the session moves into a status that holds sync', async () => {
    const { db } = await freshDb();
    const s = session(db);
    const server = new FakeCoordinator(T0);
    const { engine, dispose } = createBrowserSync({ session: s, sync: server.sync, catalog: server.catalog });
    await vi.waitFor(() => expect(engine.state.value.phase).toBe('idle'));
    const trigger = vi.spyOn(engine, 'trigger');
    for (const held of ['reauth-required', 'reload-required', 'signed-out', 'loading'] as const) s.status.value = held;
    expect(trigger).not.toHaveBeenCalled();
    s.status.value = 'offline';
    expect(trigger).toHaveBeenCalledWith('auth');
    dispose();
  });

  it('calls the coordinator through the session DPoP fetch under /api when no clients are given', async () => {
    const { db } = await freshDb();
    const s = session(db);
    const { engine, dispose } = createBrowserSync({ session: s });
    // no server answers: the app's engine reads its first failure as a cold launch still connecting (OFFLINE-BANNER-1)
    await vi.waitFor(() => expect(engine.state.value.reachability).toBe('connecting'));
    expect(String(s.fetch.mock.calls[0]![0])).toBe('/api/coordinator.v1.SyncService/Status');
    dispose();
  });

  it('pulls on an idle interval (F15): after a pass in sync, the next is due in IDLE_POLL_MS', async () => {
    expect(IDLE_POLL_MS).toBe(60_000);
    const { db } = await freshDb();
    const s = session(db);
    const server = new FakeCoordinator(T0);
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
    const set = vi.spyOn(globalThis, 'setTimeout');
    const { engine, dispose } = createBrowserSync({ session: s, sync: server.sync, catalog: server.catalog, document: doc });
    await vi.waitFor(() => expect(engine.state.value).toMatchObject({ phase: 'idle', reachability: 'reachable' }));
    expect(set.mock.calls.map((c) => c[1])).toContain(IDLE_POLL_MS);
    set.mockRestore();
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
    expect(add.mock.calls.map((c) => c[0])).toEqual(['online', 'offline', 'pageshow']);
    sync.dispose();
    other.dispose();
    add.mockRestore();
  });
});

// LGMOB M2: the Diagnostic ids switch going off reaches the whole device, signed in or not.
describe('the off clear, signed out', () => {
  afterEach(() => setDiagIds(diagIdsDefault()));

  // Edits two accounts left on this device: user-a's sent batch (the server recorded it, the answer was lost) and queued edit, user-b's queued edit.
  async function leftBehind() {
    const { db } = await freshDb();
    const server = new FakeCoordinator(T0);
    const a = await openStore(db);
    const b = await openStore(db, { sub: 'user-b' });
    await a.writeFacet(ufFacetKey(headOf(0), 'note'), { note: 'sent' });
    await a.onStatus(await server.sync.status({}), 0);
    const sent = await a.nextBatch();
    if (sent.kind !== 'send') throw new Error(sent.kind);
    await server.sync.push(sent.batch.request);
    await a.writeFacet(ufFacetKey(headOf(1), 'note'), { note: 'queued' });
    await b.writeFacet(ufFacetKey(headOf(2), 'note'), { note: 'theirs' });
    const old = (await db.getAll('outbox')).map((e) => e.origin_trace!);
    expect(old.every(isTraceId)).toBe(true);
    const s = session(db, 'signed-out');
    s.set.sub(undefined);
    const sync = createBrowserSync({ session: s, sync: server.sync, catalog: server.catalog });
    await expect(sync.engine.write((store) => store.writeFacet(ufFacetKey(headOf(0), 'score'), { score: 1 }))).rejects.toBeInstanceOf(NotEnrolledError);
    return { db, server, s, sync, old, sentRequest: sent.batch.request };
  }

  async function signIn(s: ReturnType<typeof session>, sync: { engine: { state: { value: unknown } } }) {
    s.set.sub('user-a');
    s.status.value = 'signed-in';
    await vi.waitFor(() => expect(sync.engine.state.value).toMatchObject({ phase: 'idle', pending: 0, reachability: 'reachable' }));
  }

  const stripped = (req: PushRequest): PushRequest => {
    const copy = clone(PushRequestSchema, req);
    for (const e of copy.events) delete e.originTrace;
    return copy;
  };

  it("clears every account's edits with no account store, the sent batch included", async () => {
    const { db, sync } = await leftBehind();
    setDiagIds(false);
    await sync.engine.clearOriginTraces();
    expect((await db.getAll('outbox')).map((e) => [e.sub, e.state, 'origin_trace' in e])).toEqual([
      ['user-a', 'IN_FLIGHT', false],
      ['user-a', 'PENDING', false],
      ['user-b', 'PENDING', false],
    ]);
    sync.dispose();
  });

  it('off while signed out, then on again before signing in: no old id goes out; the sent batch retries with the same events and is a DUPLICATE', async () => {
    const { server, s, sync, old, sentRequest } = await leftBehind();
    const from = server.calls.length;
    setDiagIds(false);
    await sync.engine.clearOriginTraces();
    setDiagIds(true);
    await signIn(s, sync);
    const pushes = server.calls.slice(from).filter((c) => c.rpc === 'push').map((c) => c.request as PushRequest);
    expect(toBinary(PushRequestSchema, pushes[0]!)).toEqual(toBinary(PushRequestSchema, stripped(sentRequest)));
    expect(pushes.flatMap((p) => p.events.map((e) => e.originTrace))).toEqual([undefined, undefined]);
    expect(pushes.flatMap((p) => p.events.map((e) => e.facetKey))).toEqual([ufFacetKey(headOf(0), 'note'), ufFacetKey(headOf(1), 'note')]);
    expect(old.every(isTraceId)).toBe(true);
    expect((await sync.engine.read((store) => store.listOutbox())).map((e) => e.outcome)).toEqual(['DUPLICATE', 'APPLIED']);
    sync.dispose();
  });

  it("P3 at start: an off whose clear never ran (the app closed first) is enforced by the next start, signed out, on every account's rows", async () => {
    const { db, server, s, sync } = await leftBehind();
    sync.dispose();
    const from = server.calls.length;
    setDiagIds(false);
    // The next launch, still signed out: nothing called the clear, and no pass can drain.
    const next = createBrowserSync({ session: s, sync: server.sync, catalog: server.catalog });
    await vi.waitFor(async () => expect((await db.getAll('outbox')).map((e) => 'origin_trace' in e)).toEqual([false, false, false]));
    setDiagIds(true);
    await signIn(s, next);
    const pushes = server.calls.slice(from).filter((c) => c.rpc === 'push').map((c) => c.request as PushRequest);
    expect(pushes.flatMap((p) => p.events.map((e) => e.originTrace))).toEqual([undefined, undefined]);
    next.dispose();
  });
});

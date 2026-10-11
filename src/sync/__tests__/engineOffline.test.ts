// WK-13b (WK-16 F9/F10/F12/F15): the engine's offline-first guarantees. A write commits to the
// local store before any network and whatever the network does; the outbox lives in IndexedDB, so
// a restart (a new store and engine on the same database) replays it; what waits is counted at
// once on boot; the offline event probes at once; an idle visible session pulls on an interval.
import { describe, expect, it, vi } from 'vitest';
import { Code, ConnectError } from '@connectrpc/connect';
import { ufFacetKey } from '@figurecollecting/fc-api-contract';
import { openLocalDb } from '../../storage/localDb';
import { SyncEngine } from '../engine';
import { openStore } from './harness';
import { ManualTimeouts, ManualTimers, headOf, rig } from './engineSupport';

const STUCK = Symbol('stuck');
const settles = <T>(p: Promise<T>, ms = 500): Promise<T | typeof STUCK> => Promise.race([p, new Promise<typeof STUCK>((res) => setTimeout(() => res(STUCK), ms))]);
const note = (head: string, text: string) => (s: Parameters<Parameters<SyncEngine['write']>[0]>[0]) => s.writeFacet(ufFacetKey(head, 'note'), { note: text });

function env(visibility: DocumentVisibilityState = 'visible') {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: visibility });
  return { win, doc };
}

describe('the local commit comes before any network', () => {
  it('resolves a write while a pass hangs on the coordinator: PENDING in the store, nothing pushed', async () => {
    const r = await rig();
    r.server.fault('status', { kind: 'hang' });
    const pass = r.engine.trigger('start');
    await vi.waitFor(() => expect(r.server.count('status')).toBe(1));
    expect(await settles(r.engine.write(note(headOf(0), 'on the plane')))).not.toBe(STUCK);
    expect((await r.store.listOutbox()).map((e) => [e.facet_key, e.state])).toEqual([[ufFacetKey(headOf(0), 'note'), 'PENDING']]);
    expect((await r.store.getFacet(ufFacetKey(headOf(0), 'note')))!.pending_id).not.toBeNull();
    expect(r.server.count('push')).toBe(0);
    expect(r.engine.state.value.pending).toBe(1);
    r.timeouts.expireAll();
    await pass;
    expect(r.engine.state.value).toMatchObject({ reachability: 'unreachable', pending: 1 });
  });
});

describe('a restart replays the outbox from IndexedDB', () => {
  async function restarted(r: Awaited<ReturnType<typeof rig>>, deps: Partial<ConstructorParameters<typeof SyncEngine>[0]> = {}) {
    // The killed app's engine and store are gone; a new page opens the same database.
    r.engine.stop();
    const db = await openLocalDb({ factory: r.factory });
    const store = await openStore(db, { clock: r.clock });
    const timers = new ManualTimers();
    const timeouts = new ManualTimeouts();
    const engine = new SyncEngine({ store: async () => store, sync: r.server.sync, catalog: r.server.catalog, clock: r.clock, timers, timeoutSignal: timeouts.signal, random: () => 0.5, ...deps });
    return { engine, store, timers, timeouts };
  }

  it('pushes on start the edits the killed app left, before its write timer ever fired', async () => {
    const r = await rig();
    for (let i = 0; i < 3; i++) await r.engine.write(note(headOf(i), `note ${i}`));
    expect(r.timers.delays()).toEqual([1_000]); // killed before the 1 s write trigger
    expect(r.server.calls).toEqual([]);
    const next = await restarted(r);
    next.engine.start();
    await vi.waitFor(() => expect(next.engine.state.value).toMatchObject({ phase: 'idle', pending: 0, reachability: 'reachable' }));
    for (let i = 0; i < 3; i++) expect(JSON.parse(r.server.facets.get(ufFacetKey(headOf(i), 'note'))!.payload)).toMatchObject({ note: `note ${i}` });
    expect(new Set((await next.store.listOutbox()).map((e) => e.state))).toEqual(new Set(['APPLIED']));
  });

  it('counts what waits as soon as a pass starts on boot, not after the probe settles', async () => {
    const r = await rig();
    for (let i = 0; i < 3; i++) await r.engine.write(note(headOf(i), `note ${i}`));
    r.server.fault('status', { kind: 'hang' });
    const next = await restarted(r);
    expect(next.engine.state.value.pending).toBe(0);
    const pass = next.engine.trigger('start');
    await vi.waitFor(() => expect(r.server.count('status')).toBe(1));
    expect(next.engine.state.value.pending).toBe(3);
    next.timeouts.expireAll();
    await pass;
    expect(next.engine.state.value).toMatchObject({ reachability: 'unreachable', pending: 3 });
  });
});

describe('triggers for an offline-first session', () => {
  it("probes on the window's offline event, so the status reads unreachable without waiting for an edit", async () => {
    const { win, doc } = env();
    const r = await rig({ deps: { window: win, document: doc } });
    r.engine.start();
    await vi.waitFor(() => expect(r.engine.state.value).toMatchObject({ phase: 'idle', reachability: 'reachable' }));
    r.server.fault('status', { kind: 'throw', error: new TypeError('Failed to fetch') });
    win.dispatchEvent(new Event('offline'));
    await vi.waitFor(() => expect(r.engine.state.value.reachability).toBe('unreachable'));
    expect(r.server.count('status')).toBe(2);
    r.engine.stop();
    win.dispatchEvent(new Event('offline'));
    expect(r.server.count('status')).toBe(2);
  });

  it('pulls Delta every pollMs while visible and in sync, and not while hidden', async () => {
    const { win, doc } = env();
    const r = await rig({ deps: { window: win, document: doc, pollMs: 60_000 } });
    r.engine.start();
    await vi.waitFor(() => expect(r.timers.delays()).toEqual([60_000]));
    expect(r.server.count('delta')).toBe(1);
    r.timers.fireAll();
    await vi.waitFor(() => expect(r.server.count('delta')).toBe(2));
    await vi.waitFor(() => expect(r.timers.delays()).toEqual([60_000]));
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(r.timers.pending.size).toBe(0);
    r.engine.stop();
  });

  it('backs off instead of polling after a failed pass', async () => {
    const r = await rig({ deps: { document: env().doc, pollMs: 60_000 } });
    r.server.fault('status', { kind: 'throw', error: new ConnectError('down', Code.Unavailable) });
    await r.engine.trigger('start');
    expect(r.timers.delays()).toEqual([1_000]); // the backoff: 2 s * 0.5
  });

  it('schedules no poll while hidden, without pollMs, or once stopped', async () => {
    const hidden = await rig({ deps: { document: env('hidden').doc, pollMs: 60_000 } });
    await hidden.engine.trigger('start');
    expect(hidden.timers.pending.size).toBe(0);
    const none = await rig({ deps: { document: env().doc } });
    await none.engine.trigger('start');
    expect(none.timers.pending.size).toBe(0);
    const stopped = await rig({ deps: { document: env().doc, pollMs: 60_000 } });
    const pass = stopped.engine.trigger('start');
    stopped.engine.stop();
    await pass;
    expect(stopped.timers.pending.size).toBe(0);
  });
});

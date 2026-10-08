import { describe, expect, it, vi } from 'vitest';
import { Code, ConnectError } from '@connectrpc/connect';
import { create } from '@bufbuild/protobuf';
import {
  GetProductsResponseSchema,
  ProductCardSchema,
  PushOutcome,
  SyncOp,
  occFacetKey,
  ufFacetKey,
  type PushRequest,
} from '@figurecollecting/fc-api-contract';
import { AuthRequiredError, ReloadRequiredError } from '../../auth/errors';
import {
  BACKOFF_MAX_MS,
  BACKOFF_MIN_MS,
  DELTA_PAGE,
  PROBE_TIMEOUT_MS,
  PRODUCT_BATCH,
  PRODUCT_TTL_MS,
  PUSH_BATCH,
  SyncEngine,
  WRITE_DELAY_MS,
  backoffDelay,
  classify,
  type SyncCalls,
} from '../engine';
import { FakeCoordinator } from './fakeCoordinator';
import { DEVICE, FakeClock, T0, iso } from './harness';
import { STAMP, headOf, occOf, rig, seedCopies, serverVersion, uuid } from './engineSupport';

const shown = async (r: { store: { getView(): Promise<{ copies: Array<{ shown_in: string | null }> }> } }) =>
  (await r.store.getView()).copies.filter((c) => c.shown_in !== null).length;

const pushes = (server: FakeCoordinator) => server.calls.filter((c) => c.rpc === 'push').map((c) => c.request as PushRequest);

describe('hydrate: Delta to has_more=false in pages of 500, then GetProducts in batches of 200', () => {
  it('a cold start hydrates 1,200 copies and their products', async () => {
    const r = await rig();
    seedCopies(r.server, 1200);
    r.server.seedProducts(Array.from({ length: 1200 }, (_, i) => headOf(i)));
    await r.engine.trigger('start');
    expect(await shown(r)).toBe(1200);
    expect((await r.store.listProducts()).length).toBe(1200);
    const deltas = r.server.calls.filter((c) => c.rpc === 'delta').map((c) => c.request as { cursor: string; limit: number });
    expect(deltas.map((d) => d.limit)).toEqual([DELTA_PAGE, DELTA_PAGE, DELTA_PAGE, DELTA_PAGE, DELTA_PAGE]);
    expect(deltas[0]!.cursor).toBe('');
    const batches = r.server.calls.filter((c) => c.rpc === 'getProducts').map((c) => (c.request as { refs: unknown[] }).refs.length);
    expect(batches).toEqual([200, 200, 200, 200, 200, 200]);
    expect(Math.max(...batches)).toBeLessThanOrEqual(PRODUCT_BATCH);
    expect(r.engine.state.value).toMatchObject({ reachability: 'reachable', phase: 'idle', pending: 0, lastError: null });
  });

  it('keeps a transaction that a page cuts staged, and applies none of it until its commit_cursor arrives', async () => {
    const r = await rig();
    seedCopies(r.server, 300, 300); // one transaction of 600 events: the first page ends inside it
    r.server.fault('delta', { kind: 'pass' }, { kind: 'throw', error: new ConnectError('gone', Code.Unavailable) });
    await r.engine.trigger('start');
    expect(await r.store.listFacets()).toEqual([]);
    expect((await r.store.getMeta()).cursor).toBe('');
    await r.engine.trigger('manual');
    expect(await shown(r)).toBe(300);
    expect((await r.store.getMeta()).cursor).toBe('c600');
  });

  it('applies a transaction once: a page ending inside the next one parks the cursor at the last commit, and the rest is fetched again', async () => {
    const r = await rig();
    seedCopies(r.server, 200, 200); // seq 1..400, commit at 400
    const tail = Array.from({ length: 200 }, (_, i) => ({ facetKey: ufFacetKey(headOf(i), 'note'), version: serverVersion(T0, i + 1), op: SyncOp.UPSERT, payload: JSON.stringify({ note: `n${i}`, ...STAMP }) }));
    r.server.write(tail); // seq 401..600, commit at 600: page 1 is 1..500
    r.server.fault('delta', { kind: 'pass' }, { kind: 'throw', error: new ConnectError('gone', Code.Unavailable) });
    await r.engine.trigger('start');
    // Page 1 applied the first transaction only; the 100 staged notes wait.
    expect((await r.store.getMeta()).cursor).toBe('c400');
    expect((await r.store.listFacets()).filter((f) => f.family === 'uf/note')).toEqual([]);
    await r.engine.trigger('manual');
    const resumed = r.server.calls.filter((c) => c.rpc === 'delta').map((c) => (c.request as { cursor: string }).cursor);
    expect(resumed.at(-1)).toBe('c400');
    expect((await r.store.listFacets()).filter((f) => f.family === 'uf/note')).toHaveLength(200);
    expect((await r.store.getMeta()).cursor).toBe('c600');
  });

  it('resumes from the stored cursor and fetches nothing twice', async () => {
    const r = await rig();
    seedCopies(r.server, 10);
    await r.engine.trigger('start');
    seedCopies(r.server, 0);
    await r.engine.trigger('manual');
    const cursors = r.server.calls.filter((c) => c.rpc === 'delta').map((c) => (c.request as { cursor: string }).cursor);
    expect(cursors).toEqual(['', 'c20']);
  });

  it('stops walking a feed that answers has_more with no progress', async () => {
    const r = await rig();
    const stuck = vi.fn(async () => create((await import('@figurecollecting/fc-api-contract')).DeltaResponseSchema, { events: [], nextCursor: '', hasMore: true }));
    const engine = new SyncEngine({ store: async () => r.store, sync: { ...r.server.sync, delta: stuck }, catalog: r.server.catalog, clock: r.clock, timers: r.timers, timeoutSignal: r.timeouts.signal });
    await engine.trigger('start');
    expect(stuck).toHaveBeenCalledTimes(1);
  });

  it('fetches products for occ/*/head and uf/* heads only, when missing or older than 24 h', async () => {
    const clock = new FakeClock();
    const r = await rig({ clock });
    seedCopies(r.server, 3);
    r.server.write([
      { facetKey: ufFacetKey(headOf(10), 'score'), version: serverVersion(T0, 1), op: SyncOp.UPSERT, payload: JSON.stringify({ score: 7, ...STAMP }) },
      { facetKey: `imp/mfc/figure/${headOf(20)}`, version: iso(T0), op: SyncOp.UPSERT, payload: '{}' },
    ]);
    r.server.seedProducts([headOf(0), headOf(1), headOf(2), headOf(10), headOf(20)]);
    await r.engine.trigger('start');
    const asked = () => r.server.calls.filter((c) => c.rpc === 'getProducts').flatMap((c) => (c.request as { refs: Array<{ ref: { value: string } }> }).refs.map((x) => x.ref.value));
    expect(asked().sort()).toEqual([headOf(0), headOf(1), headOf(2), headOf(10)].sort());
    clock.advance(PRODUCT_TTL_MS - 1);
    await r.engine.trigger('manual');
    expect(asked()).toHaveLength(4);
    clock.advance(1);
    await r.engine.trigger('manual');
    expect(asked()).toHaveLength(8);
  });

  it('counts a head a card answered for (requested_as, a merge) as fetched', async () => {
    const r = await rig();
    seedCopies(r.server, 1);
    r.server.seedProducts([headOf(99)]);
    r.server.redirects.set(headOf(0), headOf(99));
    await r.engine.trigger('start');
    await r.engine.trigger('manual');
    expect(r.server.count('getProducts')).toBe(1);
    expect((await r.store.listProducts()).map((p) => p.head_id)).toEqual([headOf(99)]);
  });

  it('follows next_page_token within a batch', async () => {
    const r = await rig();
    seedCopies(r.server, 2);
    const pages = [
      create(GetProductsResponseSchema, { products: [create(ProductCardSchema, { headId: headOf(0), requestedAs: [{ ref: { case: 'headId', value: headOf(0) } }] })], nextPageToken: 'p2' }),
      create(GetProductsResponseSchema, { products: [create(ProductCardSchema, { headId: headOf(1), requestedAs: [{ ref: { case: 'headId', value: headOf(1) } }] })] }),
    ];
    const getProducts = vi.fn(async (_req: { pageToken?: string }) => pages.shift()!);
    const engine = new SyncEngine({ store: async () => r.store, sync: r.server.sync, catalog: { getProducts }, clock: r.clock, timers: r.timers, timeoutSignal: r.timeouts.signal });
    await engine.trigger('start');
    expect(getProducts.mock.calls.map((c) => (c[0] as { pageToken: string }).pageToken)).toEqual(['', 'p2']);
    expect((await r.store.listProducts()).map((p) => p.head_id).sort()).toEqual([headOf(0), headOf(1)].sort());
  });
});

describe('drain: frozen Push batches of at most 100 under a stable client_id', () => {
  it('takes a Status first, pushes before it pulls, and sends 250 edits in batches of at most 100', async () => {
    const r = await rig();
    for (let i = 0; i < 250; i++) await r.store.writeFacet(ufFacetKey(uuid(i, 'b'), 'score'), { score: (i % 10) + 1 });
    await r.engine.trigger('start');
    const order = r.server.calls.map((c) => c.rpc);
    expect(order.slice(0, 5)).toEqual(['status', 'push', 'push', 'push', 'delta']);
    const sizes = pushes(r.server).map((p) => p.events.length);
    expect(sizes).toEqual([100, 100, 50]);
    expect(Math.max(...sizes)).toBe(PUSH_BATCH);
    expect(new Set(pushes(r.server).map((p) => p.clientId)).size).toBe(3);
    expect((await r.store.listOutbox()).every((e) => e.state === 'APPLIED')).toBe(true);
    expect(r.engine.state.value.pending).toBe(0);
  });

  it('retries a Push whose reply was dropped with the same client_id and events: DUPLICATE, one receipt, feed unchanged', async () => {
    const r = await rig();
    await r.store.writeFacet(ufFacetKey(headOf(0), 'note'), { note: 'one' });
    r.server.fault('push', { kind: 'drop' });
    await r.engine.trigger('start');
    expect(r.engine.state.value.reachability).toBe('unreachable');
    const feedAfterFirst = r.server.feed.length;
    expect(feedAfterFirst).toBe(1);
    await r.engine.trigger('retry');
    const [first, retry] = pushes(r.server);
    expect(retry!.clientId).toBe(first!.clientId);
    expect(retry!.events).toEqual(first!.events);
    expect(r.server.receipts.size).toBe(1);
    expect(r.server.feed.length).toBe(feedAfterFirst);
    expect((await r.store.listOutbox())[0]).toMatchObject({ state: 'APPLIED', outcome: 'DUPLICATE' });
  });

  it('adopts current on STALE: version and payload together', async () => {
    const r = await rig();
    await r.store.writeFacet(ufFacetKey(headOf(0), 'note'), { note: 'mine' });
    const theirs = serverVersion(T0 + 60_000, 1);
    r.server.write([{ facetKey: ufFacetKey(headOf(0), 'note'), version: theirs, op: SyncOp.UPSERT, payload: JSON.stringify({ note: 'theirs', ...STAMP }) }]);
    await r.engine.trigger('start');
    expect((await r.store.listOutbox())[0]!.state).toBe('STALE');
    const facet = await r.store.getFacet(ufFacetKey(headOf(0), 'note'));
    expect(facet!.value).toMatchObject({ version: theirs });
    expect(JSON.parse(facet!.value!.payload).note).toBe('theirs');
  });

  it('shows a REJECTED edit to the user until dismissed, and re-mints a version_future one instead of showing it', async () => {
    const r = await rig();
    await r.store.writeFacet(ufFacetKey(headOf(0), 'note'), { note: 'a' });
    // The server answers REJECTED payload_invalid for this push only.
    const real = r.server.sync.push;
    let first = true;
    const push = vi.fn(async (req: Parameters<SyncCalls['push']>[0], opts?: { signal?: AbortSignal }) => {
      const res = await real(req, opts);
      if (first) {
        first = false;
        res.results[0]!.outcome = PushOutcome.REJECTED;
        res.results[0]!.reason = 'payload_invalid: test';
      }
      return res;
    });
    const engine = new SyncEngine({ store: async () => r.store, sync: { ...r.server.sync, push }, catalog: r.server.catalog, clock: r.clock, timers: r.timers, timeoutSignal: r.timeouts.signal });
    await engine.trigger('start');
    expect(engine.state.value.rejected).toEqual([expect.objectContaining({ facet_key: ufFacetKey(headOf(0), 'note'), reason: 'payload_invalid: test' })]);
    await engine.dismissRejected();
    expect(engine.state.value.rejected).toEqual([]);
    // Nothing else was lost: the store still has the entry, marked seen.
    expect((await r.store.listOutbox())[0]).toMatchObject({ state: 'REJECTED', dismissed: true });
  });

  it('takes a fresh Status when the store owes one after a REJECTED, then sends the next batch', async () => {
    const r = await rig();
    await r.store.writeFacet(ufFacetKey(headOf(0), 'note'), { note: 'a' });
    // The server's clock steps back after the Status: the edit lands past its bound, REJECTED version_future.
    const real = r.server.sync.push;
    const push = vi.fn(async (req: Parameters<SyncCalls['push']>[0], opts?: { signal?: AbortSignal }) => {
      if (push.mock.calls.length === 1) r.server.now = T0 - 10 * 60_000;
      return real(req, opts);
    });
    const engine = new SyncEngine({ store: async () => r.store, sync: { ...r.server.sync, push }, catalog: r.server.catalog, clock: r.clock, timers: r.timers, timeoutSignal: r.timeouts.signal });
    await engine.trigger('start');
    r.engine = engine;
    const rpcs = r.server.calls.map((c) => c.rpc);
    // status, push (REJECTED version_future), status (owed), push (the re-mint), delta
    expect(rpcs.slice(0, 5)).toEqual(['status', 'push', 'status', 'push', 'delta']);
    expect(r.engine.state.value.rejected).toEqual([]);
  });

  it('gives up on a store that keeps asking for a Status', async () => {
    const r = await rig();
    const nextBatch = vi.spyOn(r.store, 'nextBatch').mockResolvedValue({ kind: 'status_required' });
    await r.engine.trigger('start');
    expect(nextBatch).toHaveBeenCalledTimes(2);
    expect(r.engine.state.value.lastError).toMatch(/Status/);
  });
});

describe('reachability: a Status probe bounded at 3 s, never navigator.onLine', () => {
  it('reads "unreachable" when the probe hangs, whatever onLine says, and queues edits without error', async () => {
    const r = await rig();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    r.server.fault('status', { kind: 'hang' });
    await r.store.writeFacet(ufFacetKey(headOf(0), 'note'), { note: 'queued' });
    const run = r.engine.trigger('start');
    await vi.waitFor(() => expect(r.timeouts.made.length).toBe(1));
    expect(r.timeouts.made[0]!.ms).toBe(PROBE_TIMEOUT_MS);
    r.timeouts.expireAll();
    await run;
    expect(r.engine.state.value).toMatchObject({ reachability: 'unreachable', pending: 1 });
    expect(r.server.count('push')).toBe(0);
  });

  it('bounds the probe with AbortSignal.timeout(3000) by default, even when the call ignores its signal', async () => {
    const r = await rig();
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const controller = new AbortController();
    timeout.mockReturnValue(controller.signal);
    const engine = new SyncEngine({ store: async () => r.store, sync: { ...r.server.sync, status: () => new Promise(() => {}) }, catalog: r.server.catalog, clock: r.clock, timers: r.timers });
    const run = engine.trigger('start');
    await vi.waitFor(() => expect(timeout).toHaveBeenCalledWith(PROBE_TIMEOUT_MS));
    controller.abort(new DOMException('signal timed out', 'TimeoutError'));
    await run;
    expect(engine.state.value.reachability).toBe('unreachable');
    timeout.mockRestore();
  });

  it('feeds the HLC offset from the probe at the midpoint of the round trip', async () => {
    const clock = new FakeClock();
    const r = await rig({ clock });
    r.server.now = T0 + 60_000;
    const status = r.server.sync.status;
    const slow = vi.fn(async (req: object, opts?: { signal?: AbortSignal }) => {
      clock.advance(400);
      return status(req, opts);
    });
    const onStatus = vi.spyOn(r.store, 'onStatus');
    const engine = new SyncEngine({ store: async () => r.store, sync: { ...r.server.sync, status: slow }, catalog: r.server.catalog, clock, timers: r.timers, timeoutSignal: r.timeouts.signal });
    await engine.trigger('start');
    expect(onStatus.mock.calls[0]![1]).toBe(400);
    // server_now + rtt/2 - wall at the answer = 60,000 + 200 - 400
    expect((await r.store.getMeta()).offset_ms).toBe(59_800);
  });

  it('clamps an implausible round trip into [0, 3000] ms before it reaches the clock', async () => {
    const clock = new FakeClock();
    const r = await rig({ clock });
    const status = r.server.sync.status;
    const onStatus = vi.spyOn(r.store, 'onStatus');
    let step = -50;
    const odd = vi.fn(async (req: object, opts?: { signal?: AbortSignal }) => {
      clock.mono += step;
      return status(req, opts);
    });
    const engine = new SyncEngine({ store: async () => r.store, sync: { ...r.server.sync, status: odd }, catalog: r.server.catalog, clock, timers: r.timers, timeoutSignal: r.timeouts.signal });
    await engine.trigger('start');
    step = 60_000;
    await engine.trigger('manual');
    expect(onStatus.mock.calls.map((c) => c[1])).toEqual([0, PROBE_TIMEOUT_MS]);
  });

  it('refuses a Status whose server_now_iso it cannot read', async () => {
    const r = await rig();
    const status = r.server.sync.status;
    const bad = vi.fn(async (req: object, opts?: { signal?: AbortSignal }) => ({ ...(await status(req, opts)), serverNowIso: '2026-09-26T12:00:00Z' }));
    const engine = new SyncEngine({ store: async () => r.store, sync: { ...r.server.sync, status: bad }, catalog: r.server.catalog, clock: r.clock, timers: r.timers, timeoutSignal: r.timeouts.signal });
    await engine.trigger('start');
    expect(engine.state.value.lastError).toMatch(/server_now_iso/);
    expect(r.server.count('push') + r.server.count('delta')).toBe(0);
  });
});

describe('triggers', () => {
  function env() {
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
    return { win, doc };
  }

  it('runs on start, online, visibilitychange to visible and pageshow, and not on hidden', async () => {
    const { win, doc } = env();
    const r = await rig({ deps: { window: win, document: doc } });
    const trigger = vi.spyOn(r.engine, 'trigger').mockResolvedValue();
    r.engine.start();
    win.dispatchEvent(new Event('online'));
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    win.dispatchEvent(new Event('pageshow'));
    expect(trigger.mock.calls.map((c) => c[0])).toEqual(['start', 'online', 'visible', 'pageshow']);
    r.engine.start(); // a second start does nothing
    r.engine.stop();
    win.dispatchEvent(new Event('online'));
    expect(trigger).toHaveBeenCalledTimes(4);
    trigger.mockRestore();
    await r.engine.trigger('manual'); // stopped: no network
    expect(r.server.calls).toEqual([]);
  });

  it('counts what waits by the change the user made, not by facet entry', async () => {
    const r = await rig();
    vi.spyOn(r.engine, 'trigger').mockResolvedValue();
    await r.engine.write((s) => s.createCopy(headOf(0), 'ordered')); // head + status: one change
    expect((await r.store.listOutbox()).length).toBe(2);
    expect(r.engine.state.value.pending).toBe(1);
  });

  it('counts an entry kept from before intents were grouped (a v2 upgrade) as its own change', async () => {
    const r = await rig({ deps: { blocked: () => true } });
    const base = { sub: 'user-a', op: 'upsert' as const, payload: '{}', base_version: null, basis: '', state: 'PENDING' as const, attempts: 0, created_at: T0 };
    await r.db.add('outbox', { ...base, facet_key: ufFacetKey(headOf(0), 'note'), edit_version: serverVersion(T0, 1, DEVICE) });
    await r.db.add('outbox', { ...base, facet_key: ufFacetKey(headOf(1), 'note'), edit_version: serverVersion(T0, 2, DEVICE) });
    await r.engine.trigger('start');
    expect(r.engine.state.value.pending).toBe(2);
  });

  it('syncs 1 s after a local write, once for a burst of writes', async () => {
    const r = await rig();
    const trigger = vi.spyOn(r.engine, 'trigger').mockResolvedValue();
    await r.engine.write((s) => s.writeFacet(ufFacetKey(headOf(0), 'note'), { note: 'a' }));
    await r.engine.write((s) => s.writeFacet(ufFacetKey(headOf(0), 'note'), { note: 'b' }));
    expect(r.timers.delays()).toEqual([WRITE_DELAY_MS]);
    expect(trigger).not.toHaveBeenCalled();
    expect(r.engine.state.value.pending).toBe(2);
    r.timers.fireAll();
    expect(trigger.mock.calls.map((c) => c[0])).toEqual(['write']);
  });

  it('backs off with full jitter from 2 s to 5 min while visible, and retries at once on becoming visible', async () => {
    const { win, doc } = env();
    const r = await rig({ deps: { window: win, document: doc, random: () => 0.999 } });
    r.server.fault('status', ...Array.from({ length: 12 }, () => ({ kind: 'throw' as const, error: new ConnectError('down', Code.Unavailable) })));
    const delays: number[] = [];
    r.engine.start();
    await vi.waitFor(() => expect(r.timers.pending.size).toBe(1));
    for (let i = 0; i < 9; i++) {
      delays.push(...r.timers.delays());
      r.timers.fireAll();
      await vi.waitFor(() => expect(r.timers.pending.size).toBe(1));
    }
    expect(delays).toEqual([1998, 3996, 7992, 15984, 31968, 63936, 127872, 255744, 299700]);
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(r.timers.pending.size).toBe(0);
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(r.server.count('status')).toBe(11));
  });

  it('computes the backoff window per attempt', () => {
    expect(backoffDelay(0, () => 1)).toBe(BACKOFF_MIN_MS);
    expect(backoffDelay(3, () => 0.5)).toBe(8000);
    expect(backoffDelay(40, () => 1)).toBe(BACKOFF_MAX_MS);
    expect(backoffDelay(2, () => 0)).toBe(0);
  });

  it('runs one sync at a time: a trigger during a run asks for one more pass', async () => {
    const r = await rig();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const status = r.server.sync.status;
    const slow = vi.fn(async (req: object, opts?: { signal?: AbortSignal }) => {
      if (slow.mock.calls.length === 1) await gate;
      return status(req, opts);
    });
    const engine = new SyncEngine({ store: async () => r.store, sync: { ...r.server.sync, status: slow }, catalog: r.server.catalog, clock: r.clock, timers: r.timers, timeoutSignal: r.timeouts.signal });
    const a = engine.trigger('start');
    const b = engine.trigger('online');
    const c = engine.trigger('pageshow');
    expect(engine.state.value.phase).toBe('syncing');
    release();
    await Promise.all([a, b, c]);
    expect(slow).toHaveBeenCalledTimes(2);
  });
});

describe('recovery and auth', () => {
  it('replays from an empty cursor on INVALID_ARGUMENT, reaching the server state and keeping the outbox', async () => {
    const r = await rig();
    seedCopies(r.server, 5);
    await r.engine.trigger('start');
    // The server is restored from a backup that lost copy 4 and moved on: the client's cursor is unreadable there.
    const restored = new FakeCoordinator(r.server.now);
    seedCopies(restored, 4);
    const engine = new SyncEngine({ store: async () => r.store, sync: restored.sync, catalog: restored.catalog, clock: r.clock, timers: r.timers, timeoutSignal: r.timeouts.signal });
    await r.store.writeFacet(ufFacetKey(headOf(0), 'note'), { note: 'kept' });
    await engine.trigger('manual');
    const view = await r.store.getView();
    expect(view.copies.filter((c) => c.shown_in !== null).map((c) => c.occ_id).sort()).toEqual([0, 1, 2, 3].map(occOf).sort());
    expect((await r.store.getMeta()).cursor).toBe('c9');
    expect(JSON.parse((await r.store.getFacet(ufFacetKey(headOf(0), 'note')))!.value!.payload).note).toBe('kept');
    expect(restored.facets.get(ufFacetKey(headOf(0), 'note'))).toBeDefined();
    const fresh = await rig({ server: restored });
    await fresh.engine.trigger('start');
    const strip = (rows: Array<{ facet_key: string; value: unknown }>) =>
      rows.filter((f) => f.value !== null).map((f) => JSON.stringify([f.facet_key, f.value])).sort();
    expect(strip(await fresh.store.listFacets())).toEqual(strip(await r.store.listFacets()));
  });

  it('pauses while the session needs a sign-in: no network, nothing lost, and drains once it clears', async () => {
    let blocked = true;
    const r = await rig({ deps: { blocked: () => blocked } });
    await r.engine.write((s) => s.writeFacet(ufFacetKey(headOf(0), 'note'), { note: 'offline' }));
    await r.engine.trigger('start');
    expect(r.server.calls).toEqual([]);
    expect(r.engine.state.value).toMatchObject({ phase: 'paused', pending: 1 });
    expect(r.timers.delays()).toEqual([WRITE_DELAY_MS]);
    blocked = false;
    await r.engine.trigger('auth');
    expect(r.engine.state.value).toMatchObject({ phase: 'idle', pending: 0 });
  });

  it('pauses quietly while held even when there is no store to read (signed out)', async () => {
    const r = await rig();
    const engine = new SyncEngine({ store: () => Promise.reject(new AuthRequiredError('signed_out')), sync: r.server.sync, catalog: r.server.catalog, blocked: () => true, timers: r.timers });
    await engine.trigger('start');
    expect(engine.state.value).toMatchObject({ phase: 'paused', pending: 0, lastError: null });
    expect(r.timers.pending.size).toBe(0);
  });

  it('pauses without a retry timer when a call answers Unauthenticated or the store needs a reload', async () => {
    for (const error of [new ConnectError('sign in', Code.Unauthenticated), new AuthRequiredError('reauth'), new ReloadRequiredError(), new ConnectError('reload', Code.FailedPrecondition)]) {
      const r = await rig();
      r.server.fault('status', { kind: 'throw', error });
      await r.engine.trigger('start');
      expect(r.engine.state.value.phase).toBe('paused');
      expect(r.timers.pending.size).toBe(0);
    }
  });

  it('classifies what a call can throw', () => {
    expect(classify(new ConnectError('x', Code.Unavailable))).toBe('unreachable');
    expect(classify(new ConnectError('x', Code.DeadlineExceeded))).toBe('unreachable');
    expect(classify(new ConnectError('x', Code.Canceled))).toBe('unreachable');
    expect(classify(new DOMException('t', 'TimeoutError'))).toBe('unreachable');
    expect(classify(new DOMException('t', 'AbortError'))).toBe('unreachable');
    expect(classify(new TypeError('Failed to fetch'))).toBe('unreachable');
    expect(classify(new ConnectError('x', Code.Unauthenticated))).toBe('paused');
    expect(classify(Object.assign(new Error('v'), { name: 'VersionError' }))).toBe('paused');
    expect(classify(new ConnectError('x', Code.Internal))).toBe('error');
    expect(classify('weird')).toBe('error');
  });

  it('reports a store that will not open as an error and retries later', async () => {
    const r = await rig();
    const engine = new SyncEngine({ store: () => Promise.reject(new Error('no store')), sync: r.server.sync, catalog: r.server.catalog, clock: r.clock, timers: r.timers, timeoutSignal: r.timeouts.signal, random: () => 0.5 });
    await engine.trigger('start');
    expect(engine.state.value).toMatchObject({ phase: 'idle', lastError: 'no store' });
    expect(r.timers.delays()).toEqual([1000]);
    const odd = new SyncEngine({ store: () => Promise.reject(undefined), sync: r.server.sync, catalog: r.server.catalog, clock: r.clock, timers: r.timers });
    await odd.trigger('start');
    expect(odd.state.value.lastError).toBe('undefined');
  });
});

describe('device identity', () => {
  it('mints edits under the store device, never anything the engine invents', async () => {
    const r = await rig();
    await r.store.writeFacet(ufFacetKey(headOf(0), 'note'), { note: 'x' });
    await r.engine.trigger('start');
    expect(pushes(r.server)[0]!.events[0]!.version.endsWith(`#${DEVICE}`)).toBe(true);
    expect(pushes(r.server)[0]!.events[0]!.basis).toBe('');
    expect(occFacetKey(occOf(0), 'head')).toMatch(/^occ\//);
  });
});

describe('defaults', () => {
  it('uses the system timers and clock when none are given, and stop() cancels a scheduled pass', async () => {
    vi.useFakeTimers();
    try {
      const engine = new SyncEngine({ store: () => Promise.reject(new Error('unused')), sync: {} as SyncCalls, catalog: {} as never });
      const trigger = vi.spyOn(engine, 'trigger').mockResolvedValue();
      engine.notifyWrite();
      vi.advanceTimersByTime(WRITE_DELAY_MS - 1);
      expect(trigger).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(trigger).toHaveBeenCalledWith('write');
      engine.notifyWrite();
      engine.stop();
      vi.advanceTimersByTime(WRITE_DELAY_MS);
      expect(trigger).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('edges', () => {
  it('treats a call whose bound has already passed as unreachable without waiting for it', async () => {
    const r = await rig({ deps: { timeoutSignal: () => AbortSignal.abort(new DOMException('late', 'TimeoutError')) } });
    await r.engine.trigger('start');
    expect(r.engine.state.value).toMatchObject({ reachability: 'unreachable', lastError: 'late' });
  });

  it('schedules no retry for a pass that fails after stop()', async () => {
    const r = await rig();
    r.server.fault('status', { kind: 'hang' });
    const run = r.engine.trigger('start');
    await vi.waitFor(() => expect(r.timeouts.made.length).toBe(1));
    r.engine.stop();
    r.timeouts.expireAll();
    await run;
    expect(r.timers.pending.size).toBe(0);
  });

  it('reads only head_id refs of a card as the heads it answers for', async () => {
    const r = await rig();
    seedCopies(r.server, 1);
    const card = create(ProductCardSchema, {
      headId: headOf(0),
      requestedAs: [{ ref: { case: 'gtin14', value: '04925176739041' } }, { ref: { case: 'headId', value: headOf(0) } }],
    });
    const getProducts = vi.fn(async () => create(GetProductsResponseSchema, { products: [card] }));
    const engine = new SyncEngine({ store: async () => r.store, sync: r.server.sync, catalog: { getProducts }, clock: r.clock, timers: r.timers, timeoutSignal: r.timeouts.signal });
    await engine.trigger('start');
    await engine.trigger('manual');
    expect(getProducts).toHaveBeenCalledTimes(1);
  });

  it('shows a REJECTED edit that came with no reason', async () => {
    const r = await rig();
    await r.store.writeFacet(ufFacetKey(headOf(0), 'note'), { note: 'a' });
    const real = r.server.sync.push;
    const push = vi.fn(async (req: Parameters<SyncCalls['push']>[0], opts?: { signal?: AbortSignal }) => {
      const res = await real(req, opts);
      res.results[0]!.outcome = PushOutcome.REJECTED;
      res.results[0]!.reason = '';
      return res;
    });
    const engine = new SyncEngine({ store: async () => r.store, sync: { ...r.server.sync, push }, catalog: r.server.catalog, clock: r.clock, timers: r.timers, timeoutSignal: r.timeouts.signal });
    await engine.trigger('start');
    expect(engine.state.value.rejected).toEqual([expect.objectContaining({ reason: '' })]);
  });
});

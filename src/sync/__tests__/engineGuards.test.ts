// Paging guards: a server that never finishes paging ends the pass with a logged error and a
// backoff, never a hang, and the next trigger runs a fresh pass.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { Code, ConnectError } from '@connectrpc/connect';
import { DeltaResponseSchema, GetProductsResponseSchema } from '@figurecollecting/fc-api-contract';
import { SyncEngine, type CatalogCalls, type SyncCalls } from '../engine';
import { headOf, rig, seedCopies, type Rig } from './engineSupport';

/** Answers by call number; past `escape` calls it throws, so a missing guard fails instead of hanging. */
function paging<T>(escape: number, answer: (n: number) => T) {
  let n = 0;
  return vi.fn(async (_req: { pageToken?: string; cursor?: string }) => {
    n += 1;
    if (n > escape) throw new Error('escape hatch: the engine kept paging');
    return answer(n);
  });
}

function withProducts(r: Rig, getProducts: CatalogCalls['getProducts']) {
  return new SyncEngine({ store: async () => r.store, sync: r.server.sync, catalog: { getProducts }, clock: r.clock, timers: r.timers, timeoutSignal: r.timeouts.signal, random: () => 0.5 });
}

function withDelta(r: Rig, delta: SyncCalls['delta']) {
  return new SyncEngine({ store: async () => r.store, sync: { ...r.server.sync, delta }, catalog: r.server.catalog, clock: r.clock, timers: r.timers, timeoutSignal: r.timeouts.signal, random: () => 0.5 });
}

const products = (token: string) => create(GetProductsResponseSchema, { products: [], nextPageToken: token });
const feed = (cursor: string) => create(DeltaResponseSchema, { events: [], nextCursor: cursor, hasMore: true });

afterEach(() => vi.restoreAllMocks());

describe('GetProducts paging guard', () => {
  it('ends the pass on a next_page_token that repeats the one just sent: logged error, backoff, re-triggerable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await rig();
    seedCopies(r.server, 1);
    const getProducts = paging(50, () => products('same'));
    const engine = withProducts(r, getProducts);
    await engine.trigger('start');
    expect(getProducts.mock.calls.map((c) => c[0].pageToken)).toEqual(['', 'same']);
    expect(engine.state.value).toMatchObject({ phase: 'idle', reachability: 'reachable', lastError: expect.stringMatching(/GetProducts.*next_page_token "same"/) });
    expect(warn).toHaveBeenCalledWith('[sync] pass failed:', engine.state.value.lastError);
    expect(r.timers.delays()).toEqual([1000]); // backoffDelay(0, 0.5): the first retry
    r.timers.fireAll();
    await vi.waitFor(() => expect(getProducts).toHaveBeenCalledTimes(4));
    expect(getProducts.mock.calls[2]![0].pageToken).toBe('');
  });

  it('ends the pass on a token cycle (a, b, a)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await rig();
    seedCopies(r.server, 1);
    const getProducts = paging(50, (n) => products(['a', 'b', 'a'][n - 1] ?? 'z'));
    const engine = withProducts(r, getProducts);
    await engine.trigger('start');
    expect(getProducts.mock.calls.map((c) => c[0].pageToken)).toEqual(['', 'a', 'b']);
    expect(engine.state.value.lastError).toMatch(/next_page_token "a"/);
    expect(r.timers.pending.size).toBe(1);
  });

  it('stops a batch after 1,000 pages of ever-new tokens', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await rig();
    seedCopies(r.server, 1);
    const getProducts = paging(1_010, (n) => products(`t${n}`));
    const engine = withProducts(r, getProducts);
    await engine.trigger('start');
    expect(getProducts).toHaveBeenCalledTimes(1_000);
    expect(engine.state.value.lastError).toMatch(/GetProducts.*1000 pages/);
    expect(r.timers.pending.size).toBe(1);
  });

  it('still follows a token that ends on the last allowed page', async () => {
    const r = await rig();
    seedCopies(r.server, 1);
    const getProducts = paging(1_010, (n) => products(n < 1_000 ? `t${n}` : ''));
    const engine = withProducts(r, getProducts);
    await engine.trigger('start');
    expect(getProducts).toHaveBeenCalledTimes(1_000);
    expect(engine.state.value.lastError).toBeNull();
    expect(r.timers.pending.size).toBe(0);
  });

  it('scopes the sent-token guard to one batch of 200: two batches that both page with p2 both hydrate', async () => {
    const r = await rig();
    seedCopies(r.server, 250);
    r.server.seedProducts(Array.from({ length: 250 }, (_, i) => headOf(i)));
    // Offset-style paging: the first page answers half the refs and 'p2', the second the rest and ''.
    const getProducts = vi.fn(async (req: Parameters<CatalogCalls['getProducts']>[0]) => {
      const refs = req.refs ?? [];
      const half = Math.ceil(refs.length / 2);
      const part = req.pageToken === 'p2' ? refs.slice(half) : refs.slice(0, half);
      const page = await r.server.catalog.getProducts({ refs: part });
      return create(GetProductsResponseSchema, { products: page.products, nextPageToken: req.pageToken === 'p2' ? '' : 'p2' });
    });
    const engine = withProducts(r, getProducts);
    await engine.trigger('start');
    expect(getProducts.mock.calls.map((c) => [c[0].refs?.length, c[0].pageToken])).toEqual([[200, ''], [200, 'p2'], [50, ''], [50, 'p2']]);
    expect(engine.state.value.lastError).toBeNull();
    expect((await r.store.listProducts()).map((p) => p.head_id).sort()).toEqual(Array.from({ length: 250 }, (_, i) => headOf(i)).sort());
    expect(r.timers.pending.size).toBe(0);
  });
});

describe('Delta paging guard', () => {
  it('ends the pass on has_more with a next_cursor that does not advance: logged error, backoff, re-triggerable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await rig();
    const delta = paging(50, () => feed(''));
    const engine = withDelta(r, delta);
    await engine.trigger('start');
    expect(delta).toHaveBeenCalledTimes(1);
    expect(engine.state.value.lastError).toMatch(/Delta.*next_cursor ""/);
    expect(warn).toHaveBeenCalledWith('[sync] pass failed:', engine.state.value.lastError);
    expect(r.timers.delays()).toEqual([1000]);
    r.timers.fireAll();
    await vi.waitFor(() => expect(delta).toHaveBeenCalledTimes(2));
  });

  it('ends the pass on a cursor cycle (x, y, x)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await rig();
    const delta = paging(50, (n) => feed(['x', 'y', 'x'][n - 1] ?? 'z'));
    const engine = withDelta(r, delta);
    await engine.trigger('start');
    expect(delta.mock.calls.map((c) => c[0].cursor)).toEqual(['', 'x', 'y']);
    expect(engine.state.value.lastError).toMatch(/next_cursor "x"/);
    expect(r.timers.pending.size).toBe(1);
  });

  it('stops a walk after 10,000 pages of ever-new cursors', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await rig();
    const delta = paging(10_010, (n) => feed(`c${n}`));
    const engine = withDelta(r, delta);
    await engine.trigger('start');
    expect(delta).toHaveBeenCalledTimes(10_000);
    expect(engine.state.value.lastError).toMatch(/Delta.*10000 pages/);
    expect(r.timers.pending.size).toBe(1);
  });

  it('still finishes a walk whose has_more ends on the last allowed page', async () => {
    const r = await rig();
    const delta = paging(10_010, (n) => create(DeltaResponseSchema, { events: [], nextCursor: `c${n}`, hasMore: n < 10_000 }));
    const engine = withDelta(r, delta);
    await engine.trigger('start');
    expect(delta).toHaveBeenCalledTimes(10_000);
    expect(engine.state.value.lastError).toBeNull();
  });
});

describe('the pass log', () => {
  it('logs nothing for a server it cannot reach: only an error is logged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await rig();
    r.server.fault('status', { kind: 'throw', error: new ConnectError('down', Code.Unavailable) });
    await r.engine.trigger('start');
    expect(r.engine.state.value).toMatchObject({ reachability: 'unreachable', lastError: expect.stringMatching(/down/) });
    expect(warn).not.toHaveBeenCalled();
  });
});

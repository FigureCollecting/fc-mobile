// ADDR-1: the owned figures' images, kept for the offline case view. Online and signed in, the hook
// brings the caches to the owned figures (src/media/keptImages.ts) and answers each figure's
// primary; offline it answers from what was kept, asking nothing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/preact';
import { QueryClient } from '@tanstack/react-query';
import { create } from '@bufbuild/protobuf';
import { Code, ConnectError } from '@connectrpc/connect';
import { GetProductImagesResponseSchema } from '@figurecollecting/fc-api-contract';
import { SyncEngine } from '../../sync/engine';
import { FILL_AFTER_ORDER_MS, REFILL_AFTER_MS, imagesComplete, setFetchOrder, useCollectionImages } from '../useCollectionImages';
import { useOnlineStatus } from '../useOnlineStatus';
import { localRig, queryWrapper } from '../../local/__tests__/localHarness';
import { seedFigures } from '../../local/__tests__/seedFigures';
import { localSession } from '../../local/session';
import { headOf } from '../../sync/__tests__/engineSupport';
import { fakeCaches, type FakeCaches } from '../../test/fakeCaches';
import { ABSENT_RECHECK_MS, OWNED_MEDIA_CACHE, recallImages, rememberImages, syncKeptImages } from '../../media/keptImages';
import { installFakeLocks } from '../../test/fakeLocks';

const D = 'https://images.figurecollecting.com/d';
const url = (c: string) => `${D}/${c.repeat(64)}`;
let storage: FakeCaches;

/** A figure's list and its primary's bytes, as the last sync left them. */
async function keep(head: string, c: string, bytes = true): Promise<void> {
  await rememberImages(head, [{ url: url(c), width: 1, height: 1, role: 'gallery', primary: true }], storage);
  if (bytes) await (await storage.open(OWNED_MEDIA_CACHE)).put(url(c), new Response('bytes'));
}
const settle = () => new Promise((res) => setTimeout(res, 50));
/**
 * Long enough for a new order's wait (FILL_AFTER_ORDER_MS) or a pass's effect to start any fill, and for that fill to ask what
 * it asks, however loaded the host: each wait is set after the timers it must follow, so it fires after them.
 */
const quiet = async () => {
  await new Promise((res) => setTimeout(res, FILL_AFTER_ORDER_MS + 100));
  await settle();
  await settle();
};

beforeEach(() => {
  storage = fakeCaches();
  vi.stubGlobal('caches', storage);
  vi.stubGlobal('fetch', storage.fetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
  localSession.value = undefined;
  setFetchOrder([]);
});

describe('useCollectionImages', () => {
  it('online: caches the figures\' images, a wished one\'s asked for too, and answers each primary; one with no image answers none', async () => {
    const r = await localRig();
    r.clients.getProductImages.mockResolvedValue(
      create(GetProductImagesResponseSchema, {
        products: [{ headId: headOf(0), images: [{ derivativeId: 'a'.repeat(64), primary: true, url: url('a'), width: 600, height: 800 }] }],
      }),
    );
    await seedFigures(r, [{ title: 'Owned' }, { title: 'Wished', status: 'wished' }]);
    const { result } = renderHook(() => useCollectionImages(), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(url('a')));
    expect(r.clients.getProductImages).toHaveBeenCalledWith({ headIds: [headOf(0), headOf(1)], pageSize: 200 }, { signal: expect.any(AbortSignal), timeoutMs: 20_000 });
    expect(result.current.has(headOf(1))).toBe(false);
    expect([...(storage.stores.get(OWNED_MEDIA_CACHE)?.keys() ?? [])]).toEqual([url('a')]);
  });

  // FB-QUICK (Ross, 10-16): his Ordered and Wished stood as plates; every copy in the collection is kept.
  const listWithMask = (i: number, image: string, mask: string) => ({
    headId: headOf(i),
    images: [{ derivativeId: image.repeat(64), role: 'gallery', url: url(image), width: 550, height: 800, mask: { maskId: mask.repeat(64), contentType: 'image/png', url: url(mask) } }],
  });

  it('online: an ordered and a wished figure get their kept image and mask, as an owned one does', async () => {
    const r = await localRig();
    r.clients.getProductImages.mockResolvedValue(
      create(GetProductImagesResponseSchema, { products: [listWithMask(0, 'a', 'b'), listWithMask(1, 'c', 'd'), listWithMask(2, 'e', 'f')] }),
    );
    await seedFigures(r, [{ title: 'Owned' }, { title: 'Ordered', status: 'ordered' }, { title: 'Wished', status: 'wished' }]);
    const { result } = renderHook(() => useCollectionImages(), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.get(headOf(1))).toMatchObject({ url: url('c'), maskUrl: url('d') }), { timeout: 3000 });
    await waitFor(() => expect(result.current.get(headOf(2))).toMatchObject({ url: url('e'), maskUrl: url('f') }), { timeout: 3000 });
    expect(result.current.get(headOf(0))).toMatchObject({ url: url('a'), maskUrl: url('b') });
    expect([...(storage.stores.get(OWNED_MEDIA_CACHE)?.keys() ?? [])].sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f'].map(url));
  });

  // FETCH-FIRST (10-31: on a slow link, the case arranged by series, its first figure in view stood as its plate for a minute)
  it('fetches first the images of the figures the case view told it shows, in its order, then the others; a new order is no new sync (FETCH-FIRST)', async () => {
    const r = await localRig();
    r.clients.getProductImages.mockResolvedValue(
      create(GetProductImagesResponseSchema, { products: [listWithMask(0, 'a', 'b'), listWithMask(1, 'c', 'd'), listWithMask(2, 'e', 'f')] }),
    );
    await seedFigures(r, [{ title: 'One' }, { title: 'Two' }, { title: 'Three' }]);
    setFetchOrder([headOf(2), headOf(0)]);
    const { result, rerender } = renderHook(() => useCollectionImages(), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.size).toBe(3), { timeout: 3000 });
    expect(storage.added.map((q) => q.url)).toEqual(['e', 'f', 'a', 'b', 'c', 'd'].map(url));
    // the view moved: the next sync's fetches follow it, but the order alone starts none
    setFetchOrder([headOf(1)]);
    rerender();
    await settle();
    expect(r.clients.getProductImages).toHaveBeenCalledTimes(1);
  });

  // LOAD2 (Ross 11-04: about a minute from the cards to the first photo)
  it('asks the coordinator for the lists of the figures the case view shows first, in its order, a small batch first (LOAD2)', async () => {
    const r = await localRig();
    r.clients.getProductImages.mockResolvedValue(create(GetProductImagesResponseSchema, {}));
    await seedFigures(r, Array.from({ length: 30 }, (_, i) => ({ title: `F${i}` })));
    setFetchOrder([headOf(29), headOf(3)]);
    renderHook(() => useCollectionImages(), { wrapper: queryWrapper() });
    await waitFor(() => expect(r.clients.getProductImages).toHaveBeenCalledTimes(2));
    const firstCall = r.clients.getProductImages.mock.calls[0]![0] as { headIds: string[] };
    expect(firstCall.headIds).toHaveLength(25);
    expect(firstCall.headIds.slice(0, 3)).toEqual([headOf(29), headOf(3), headOf(0)]);
  });

  it('asks for the owned figures first, then the ordered, then the wished, each figure once; never one no longer owned', async () => {
    const r = await localRig();
    r.clients.getProductImages.mockResolvedValue(create(GetProductImagesResponseSchema, {}));
    await seedFigures(r, [
      { title: 'Wished', status: 'wished' },
      { title: 'Ordered', status: 'ordered' },
      { title: 'Owned' },
      { title: 'Sold', status: 'former', disposal: { reason: 'sold' } },
      { title: 'Owned too' },
    ]);
    // the first owned figure is wished as well: it is asked for once, with the owned ones
    await r.engine.write((store) => store.createCopy(headOf(2), 'wished'));
    renderHook(() => useCollectionImages(), { wrapper: queryWrapper() });
    await waitFor(() => expect(r.clients.getProductImages).toHaveBeenCalled());
    expect(r.clients.getProductImages).toHaveBeenLastCalledWith(
      { headIds: [headOf(2), headOf(4), headOf(1), headOf(0)], pageSize: 200 },
      { signal: expect.any(AbortSignal), timeoutMs: 20_000 },
    );
  });

  it('offline: answers from the kept lists and asks the coordinator nothing', async () => {
    renderHook(() => useOnlineStatus());
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    try {
      const r = await localRig();
      await seedFigures(r, [{ title: 'Owned' }]);
      await keep(headOf(0), 'b');
      const { result } = renderHook(() => useCollectionImages(), { wrapper: queryWrapper() });
      await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(url('b')));
      expect(r.clients.getProductImages).not.toHaveBeenCalled();
    } finally {
      act(() => {
        window.dispatchEvent(new Event('online'));
      });
    }
  });

  it('online, but the coordinator answers UNAVAILABLE: still shows what the last sync kept', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Owned' }]);
    await keep(headOf(0), 'b');
    r.clients.getProductImages.mockRejectedValue(new ConnectError('display restrictions are unavailable', Code.Unavailable));
    const { result } = renderHook(() => useCollectionImages(), { wrapper: queryWrapper() });
    await waitFor(() => expect(r.clients.getProductImages).toHaveBeenCalled());
    await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(url('b')));
  });

  // STALE-CONTENT (Ross 10-18, a cold launch that began "offline": "I had to change the pan mode before it redrew"): an image
  // sync that failed stood as the answer, fresh for ten minutes, so when the connection came back (or after a later outage)
  // nothing synced again and the case kept the plates.
  it('an image sync that failed (the lists could not be had) is not an answer: once the server is reached again, after an outage, it syncs again and the images arrive', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Owned' }]);
    // the launch: a new engine on the same store, its first probe failing
    const launch = new SyncEngine({ store: async () => r.store, sync: r.server.sync, catalog: r.server.catalog, clock: r.clock, timers: r.timers, timeoutSignal: r.timeouts.signal, random: () => 0.5, coldRetry: true });
    localSession.value = { ...r.session, engine: launch };
    r.server.fault('status', { kind: 'throw', error: new ConnectError('radio warming', Code.Unavailable) });
    const lists = create(GetProductImagesResponseSchema, {
      products: [{ headId: headOf(0), images: [{ derivativeId: 'a'.repeat(64), primary: true, url: url('a'), width: 600, height: 800 }] }],
    });
    // the first lists call fails (a radio blip), the next ones answer
    r.clients.getProductImages.mockRejectedValueOnce(new ConnectError('blip', Code.Unavailable)).mockResolvedValue(lists);
    // the app's own cache settings (src/app.tsx): an answer is kept 30 minutes, and what a query answered is fresh for ten
    const { result } = renderHook(() => useCollectionImages(), { wrapper: queryWrapper(new QueryClient({ defaultOptions: { queries: { gcTime: 30 * 60_000, staleTime: 60_000, refetchOnWindowFocus: false, networkMode: 'always' } } })) });
    await launch.trigger('start');
    await act(async () => {
      r.timers.fireAll();
      await settle();
    });
    await waitFor(() => expect(launch.state.value.reachability).toBe('reachable'));
    // reached; the first sync's lists call fails: plates
    await waitFor(() => expect(r.clients.getProductImages).toHaveBeenCalledTimes(1));
    await settle();
    expect(result.current.size).toBe(0);
    // an outage and the way back
    r.server.fault('status', { kind: 'throw', error: new ConnectError('down', Code.Unavailable) });
    await launch.trigger('manual');
    expect(launch.state.value.reachability).toBe('unreachable');
    await launch.trigger('manual');
    expect(launch.state.value.reachability).toBe('reachable');
    await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(url('a')), { timeout: 3000 });
    expect(r.clients.getProductImages).toHaveBeenCalledTimes(2);
  });

  it('asks nothing before the server has answered the first probe: an image sync before it would run with the connection still warming', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Owned' }]);
    const launch = new SyncEngine({ store: async () => r.store, sync: r.server.sync, catalog: r.server.catalog, clock: r.clock, timers: r.timers, timeoutSignal: r.timeouts.signal, random: () => 0.5, coldRetry: true });
    localSession.value = { ...r.session, engine: launch };
    expect(launch.state.value.reachability).toBe('unknown');
    r.clients.getProductImages.mockResolvedValue(create(GetProductImagesResponseSchema, {}));
    renderHook(() => useCollectionImages(), { wrapper: queryWrapper() });
    await settle();
    expect(r.clients.getProductImages).not.toHaveBeenCalled();
    await launch.trigger('start');
    await waitFor(() => expect(r.clients.getProductImages).toHaveBeenCalledTimes(1));
  });

  it('online, but the server out of reach (the sync engine\'s probe failed): asks nothing and shows what was kept with its bytes', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Owned' }, { title: 'Owned, bytes never kept' }]);
    r.server.fault('status', { kind: 'throw', error: new ConnectError('down', Code.Unavailable) });
    await r.engine.trigger('manual');
    expect(r.engine.state.value.reachability).toBe('unreachable');
    await keep(headOf(0), 'b');
    await keep(headOf(1), 'c', false);
    const { result } = renderHook(() => useCollectionImages(), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(url('b')));
    expect(result.current.has(headOf(1))).toBe(false);
    expect(r.clients.getProductImages).not.toHaveBeenCalled();
  });

  it('answers no image for a figure whose bytes are not on the device, so the case draws its plate', async () => {
    storage = fakeCaches(async () => new Response('nope', { status: 404 }));
    vi.stubGlobal('caches', storage);
    vi.stubGlobal('fetch', storage.fetch);
    const r = await localRig();
    r.clients.getProductImages.mockResolvedValue(
      create(GetProductImagesResponseSchema, {
        products: [{ headId: headOf(0), images: [{ derivativeId: 'a'.repeat(64), primary: true, url: url('a'), width: 600, height: 800 }] }],
      }),
    );
    await seedFigures(r, [{ title: 'Owned' }, { title: 'Owned too' }]);
    await keep(headOf(1), 'c', false);
    const { result } = renderHook(() => useCollectionImages(), { wrapper: queryWrapper() });
    await waitFor(() => expect(r.clients.getProductImages).toHaveBeenCalled());
    await settle();
    expect([...(storage.stores.get(OWNED_MEDIA_CACHE)?.keys() ?? [])]).toEqual([]);
    expect(result.current.size).toBe(0);
  });

  it('cancels its sync when the case view goes away: the call in flight is aborted, nothing more is asked', async () => {
    const r = await localRig();
    let seen: AbortSignal | undefined;
    r.clients.getProductImages.mockImplementation((_req: unknown, opts?: { signal?: AbortSignal }) => {
      seen = opts?.signal;
      return new Promise(() => {});
    });
    await seedFigures(r, [{ title: 'Owned' }]);
    const { unmount } = renderHook(() => useCollectionImages(), { wrapper: queryWrapper() });
    await waitFor(() => expect(r.clients.getProductImages).toHaveBeenCalledTimes(1));
    expect(seen?.aborted).toBe(false);
    unmount();
    await waitFor(() => expect(seen?.aborted).toBe(true));
    expect(r.clients.getProductImages).toHaveBeenCalledTimes(1);
  });

  it('cancels its sync when the case view goes away: an image fetch in flight is aborted too, so the sync lets go of the lock', async () => {
    const uninstall = installFakeLocks();
    try {
      // An image link that never answers: only an abort of the request's own signal ends the fetch.
      storage = fakeCaches((req) => new Promise<Response>((_res, rej) => req.signal.addEventListener('abort', () => rej(req.signal.reason))));
      vi.stubGlobal('caches', storage);
      vi.stubGlobal('fetch', storage.fetch);
      const r = await localRig();
      r.clients.getProductImages.mockResolvedValue(
        create(GetProductImagesResponseSchema, { products: [{ headId: headOf(0), images: [{ derivativeId: 'a'.repeat(64), role: 'gallery', primary: true, url: url('a'), width: 1, height: 1 }] }] }),
      );
      await seedFigures(r, [{ title: 'Owned' }]);
      const { unmount } = renderHook(() => useCollectionImages(), { wrapper: queryWrapper() });
      await waitFor(() => expect(storage.added).toHaveLength(1));
      const fetching = storage.added[0]!.signal;
      expect(fetching.aborted).toBe(false);
      unmount();
      await waitFor(() => expect(fetching.aborted).toBe(true));
      // The lock is free: the next sync (another document's) runs at once.
      const next = await syncKeptImages([headOf(0)], async () => new Map(), { storage, lockWaitMs: 100 }).then(() => 'synced', (e: unknown) => (e as { name?: string }).name);
      expect(next).toBe('synced');
    } finally {
      uninstall();
    }
  });

  // IMG-SHOW-1: the coordinator's lists as they are (no row marked primary, the mask on the first), and a link
  // whose answer to `held` waits until released: the sync is still fetching while the figures it kept are shown.
  const realShaped = () =>
    create(GetProductImagesResponseSchema, {
      products: [
        { headId: headOf(0), images: [{ derivativeId: 'a'.repeat(64), role: 'gallery', url: url('a'), width: 550, height: 800 }] },
        {
          headId: headOf(1),
          images: [{ derivativeId: 'b'.repeat(64), role: 'gallery', url: url('b'), width: 550, height: 800, mask: { maskId: 'c'.repeat(64), contentType: 'image/png', url: url('c') } }],
        },
      ],
    });
  const holding = (held: string) => {
    let release!: () => void;
    const released = new Promise<void>((res) => (release = res));
    return {
      release,
      caches: fakeCaches(async (req) => {
        if (req.url === held) await released;
        return new Response('img');
      }),
    };
  };
  /** As the app's: an answer outlives its case view (gcTime), so one opened again finds it. */
  const appClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 30 * 60_000, networkMode: 'always' } } });

  it('while its sync is still fetching, answers what the device kept at once and each image as the sync keeps it (IMG-SHOW-1)', async () => {
    const link = holding(url('c'));
    storage = link.caches;
    vi.stubGlobal('caches', storage);
    vi.stubGlobal('fetch', storage.fetch);
    const r = await localRig();
    r.clients.getProductImages.mockResolvedValue(realShaped());
    await seedFigures(r, [{ title: 'Kept by the last sync' }, { title: 'Fetched by this one' }]);
    await keep(headOf(0), 'a');
    const { result, unmount } = renderHook(() => useCollectionImages(), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(url('a')));
    await waitFor(() => expect(result.current.get(headOf(1))).toMatchObject({ url: url('b'), maskUrl: url('c') }), { timeout: 3000 });
    // the mask is still on its way: the sync has not ended
    expect(storage.stores.get(OWNED_MEDIA_CACHE)?.has(url('c'))).toBe(false);
    unmount();
    link.release();
  });

  it('a case view gone part way leaves what its sync kept: opened again it shows that at once, and its sync fetches only what is missing (IMG-SHOW-1)', async () => {
    // b's link never answers: only the case view going away (the request's abort) ends it
    storage = fakeCaches((req) =>
      req.url === url('b') ? new Promise<Response>((_res, rej) => req.signal.addEventListener('abort', () => rej(req.signal.reason))) : Promise.resolve(new Response('img')),
    );
    vi.stubGlobal('caches', storage);
    vi.stubGlobal('fetch', storage.fetch);
    const r = await localRig();
    r.clients.getProductImages.mockResolvedValue(realShaped());
    await seedFigures(r, [{ title: 'Fetched first' }, { title: 'On a stalled link' }]);
    const client = appClient();
    const first = renderHook(() => useCollectionImages(), { wrapper: queryWrapper(client) });
    await waitFor(() => expect(first.result.current.get(headOf(0))?.url).toBe(url('a')), { timeout: 3000 });
    await waitFor(() => expect(storage.added.some((q) => q.url === url('b'))).toBe(true));
    const fetching = storage.added.find((q) => q.url === url('b'))!.signal;
    first.unmount();
    await waitFor(() => expect(fetching.aborted).toBe(true));
    const asked = r.clients.getProductImages.mock.calls.length;

    const second = renderHook(() => useCollectionImages(), { wrapper: queryWrapper(client) });
    expect(second.result.current.get(headOf(0))?.url).toBe(url('a'));
    await waitFor(() => expect(r.clients.getProductImages.mock.calls.length).toBeGreaterThan(asked));
    await waitFor(() => expect(storage.added.filter((q) => q.url === url('b'))).toHaveLength(2));
    expect(storage.added.filter((q) => q.url === url('a'))).toHaveLength(1);
    second.unmount();
  });

  it('a figure added (a new set of owned figures) keeps the pictures the case view shows while their sync runs (IMG-SHOW-1)', async () => {
    const link = holding(url('b'));
    storage = link.caches;
    vi.stubGlobal('caches', storage);
    vi.stubGlobal('fetch', storage.fetch);
    const r = await localRig();
    const all = [
      { headId: headOf(0), images: [{ derivativeId: 'a'.repeat(64), role: 'gallery', url: url('a'), width: 550, height: 800 }] },
      { headId: headOf(1), images: [{ derivativeId: 'b'.repeat(64), role: 'gallery', url: url('b'), width: 550, height: 800 }] },
    ];
    r.clients.getProductImages.mockImplementation(async (req: { headIds: string[] }) =>
      create(GetProductImagesResponseSchema, { products: all.filter((p) => req.headIds.includes(p.headId)) }),
    );
    await seedFigures(r, [{ title: 'Shown' }]);
    const { result, unmount } = renderHook(() => useCollectionImages(), { wrapper: queryWrapper(appClient()) });
    await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(url('a')), { timeout: 3000 });

    // the owned figures change: the case view's answer is asked again, under a new key
    await r.engine.write((store) => store.createCopy(headOf(1), 'owned'));
    await waitFor(() => expect(storage.added.some((q) => q.url === url('b'))).toBe(true));
    // the added figure's image is still on its way, and the figure shown keeps its picture
    await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(url('a')));
    expect(result.current.has(headOf(1))).toBe(false);
    unmount();
    link.release();
  });

  it('a sync that left an image unfetched answers what it kept, and the case view opened again syncs again (IMG-SHOW-1)', async () => {
    storage = fakeCaches(async (req) => (req.url === url('b') ? new Response('', { status: 503 }) : new Response('img')));
    vi.stubGlobal('caches', storage);
    vi.stubGlobal('fetch', storage.fetch);
    const r = await localRig();
    r.clients.getProductImages.mockResolvedValue(realShaped());
    await seedFigures(r, [{ title: 'Fetched' }, { title: 'Refused' }]);
    const client = appClient();
    const first = renderHook(() => useCollectionImages(), { wrapper: queryWrapper(client) });
    await waitFor(() => expect(storage.added.map((q) => q.url).sort()).toEqual([url('a'), url('b'), url('c')]));
    await waitFor(() => expect(client.getQueryCache().findAll({ queryKey: ['local', 'kept-images'], fetchStatus: 'idle', predicate: (q) => q.state.data !== undefined })).toHaveLength(1));
    // the hook renders the cache's answer a tick after the cache holds it
    await waitFor(() => expect(first.result.current.get(headOf(0))?.url).toBe(url('a')));
    expect(first.result.current.has(headOf(1))).toBe(false);
    first.unmount();
    expect(r.clients.getProductImages).toHaveBeenCalledTimes(1);

    const second = renderHook(() => useCollectionImages(), { wrapper: queryWrapper(client) });
    expect(second.result.current.get(headOf(0))?.url).toBe(url('a'));
    await waitFor(() => expect(r.clients.getProductImages).toHaveBeenCalledTimes(2));
    second.unmount();
  });

  // LAYOUT-STABLE-1: the case lays the wall out once everything has arrived; it must be told when that is.
  it('imagesComplete: not while the first answer is on its way, nor while the sync is still fetching, and yes for the answer of the sync that ends', async () => {
    const link = holding(url('c'));
    storage = link.caches;
    vi.stubGlobal('caches', storage);
    vi.stubGlobal('fetch', storage.fetch);
    const r = await localRig();
    r.clients.getProductImages.mockResolvedValue(realShaped());
    await seedFigures(r, [{ title: 'Kept by the last sync' }, { title: 'Fetched by this one' }]);
    await keep(headOf(0), 'a');
    const { result, unmount } = renderHook(() => useCollectionImages(), { wrapper: queryWrapper() });
    // signed in, nothing answered yet: the pictures are not all in
    expect(imagesComplete(result.current)).toBe(false);
    await waitFor(() => expect(result.current.get(headOf(1))).toMatchObject({ url: url('b'), maskUrl: url('c') }), { timeout: 3000 });
    // an answer shown while the sync is still fetching (its mask is on its way) is partial
    expect(imagesComplete(result.current)).toBe(false);
    link.release();
    await waitFor(() => expect(imagesComplete(result.current)).toBe(true), { timeout: 3000 });
    expect(result.current.get(headOf(1))?.maskUrl).toBe(url('c'));
    unmount();
  });

  it('imagesComplete: never for the answer of a sync that left an image unfetched (the case then lays out after a quiet spell instead)', async () => {
    storage = fakeCaches(async (req) => (req.url === url('b') ? new Response('', { status: 503 }) : new Response('img')));
    vi.stubGlobal('caches', storage);
    vi.stubGlobal('fetch', storage.fetch);
    const r = await localRig();
    r.clients.getProductImages.mockResolvedValue(realShaped());
    await seedFigures(r, [{ title: 'Fetched' }, { title: 'Refused' }]);
    const client = appClient();
    const first = renderHook(() => useCollectionImages(), { wrapper: queryWrapper(client) });
    await waitFor(() => expect(first.result.current.get(headOf(0))?.url).toBe(url('a')), { timeout: 3000 });
    await waitFor(() => expect(client.getQueryCache().findAll({ queryKey: ['local', 'kept-images'], fetchStatus: 'idle', predicate: (q) => q.state.data !== undefined })).toHaveLength(1));
    expect(imagesComplete(first.result.current)).toBe(false);
    first.unmount();
  });

  // PHOTOS1 (11-05: most misses were display copies the server had not made yet, 404): the layout waited QUIET_MS on them
  it('imagesComplete: yes for a sync whose only misses are display copies not made yet (404): nothing the link could bring is missing (PHOTOS1)', async () => {
    storage = fakeCaches(async (req) => (req.url === url('b') ? new Response('not found', { status: 404 }) : new Response('img')));
    vi.stubGlobal('caches', storage);
    vi.stubGlobal('fetch', storage.fetch);
    const r = await localRig();
    r.clients.getProductImages.mockResolvedValue(realShaped());
    await seedFigures(r, [{ title: 'Fetched' }, { title: 'Not made yet' }]);
    const client = appClient();
    const { result } = renderHook(() => useCollectionImages(), { wrapper: queryWrapper(client) });
    await waitFor(() => expect(client.getQueryCache().findAll({ queryKey: ['local', 'kept-images'], fetchStatus: 'idle', predicate: (q) => q.state.data !== undefined })).toHaveLength(1));
    await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(url('a')));
    expect(imagesComplete(result.current)).toBe(true);
    expect(result.current.has(headOf(1))).toBe(false);
  });

  it('a display copy not made yet (404) is asked for again by the first pass ABSENT_RECHECK_MS after, not by a pass or a walk before (PHOTOS1)', async () => {
    let made = false;
    storage = fakeCaches(async (req) => (req.url === url('b') && !made ? new Response('not found', { status: 404 }) : new Response('img')));
    vi.stubGlobal('caches', storage);
    vi.stubGlobal('fetch', storage.fetch);
    const r = await localRig();
    r.clients.getProductImages.mockResolvedValue(realShaped());
    await seedFigures(r, [{ title: 'Fetched' }, { title: 'Made later' }]);
    const client = appClient();
    const { result } = renderHook(() => useCollectionImages(), { wrapper: queryWrapper(client) });
    await waitFor(() => expect(client.getQueryCache().findAll({ queryKey: ['local', 'kept-images'], fetchStatus: 'idle', predicate: (q) => q.state.data !== undefined })).toHaveLength(1));
    const asked = () => storage.added.filter((q) => q.url === url('b')).length;
    expect(asked()).toBe(1);
    made = true;
    await nextPass(r);
    setFetchOrder([headOf(1)]);
    await quiet();
    expect(asked()).toBe(1);
    const now = Date.now();
    const later = vi.spyOn(Date, 'now').mockReturnValue(now + ABSENT_RECHECK_MS);
    try {
      await nextPass(r);
      await waitFor(() => expect(result.current.get(headOf(1))?.url).toBe(url('b')), { timeout: 3000 });
      expect(asked()).toBe(2);
      expect(r.clients.getProductImages).toHaveBeenCalledTimes(1);
    } finally {
      later.mockRestore();
    }
  });

  it('imagesComplete: yes while signed out, where nothing will ever stream in', async () => {
    const { result } = renderHook(() => useCollectionImages(), { wrapper: queryWrapper() });
    await new Promise((res) => setTimeout(res, 20));
    expect(imagesComplete(result.current)).toBe(true);
  });

  // NEWHOLD-IMG-1 (Ross 10-31): one list call answered 503 with the server still in reach; the figures held since the last
  // sync that read the lists stood as plates until the Collection page was opened again.
  const oneImage = (i: number, c: string) =>
    create(GetProductImagesResponseSchema, { products: [{ headId: headOf(i), images: [{ derivativeId: c.repeat(64), role: 'gallery', url: url(c), width: 600, height: 800 }] }] });
  /** The engine's next completed pass, a minute on (its idle poll). */
  const nextPass = async (r: Awaited<ReturnType<typeof localRig>>) => {
    r.clock.advance(60_000);
    await r.engine.trigger('poll');
  };

  it('a sync that could not read the lists is not asked again at once, but is after the engine\'s next completed pass, and its images arrive (NEWHOLD-IMG-1)', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Owned' }]);
    r.clients.getProductImages.mockRejectedValueOnce(new ConnectError('display restrictions are unavailable', Code.Unavailable)).mockResolvedValue(oneImage(0, 'a'));
    const { result } = renderHook(() => useCollectionImages(), { wrapper: queryWrapper() });
    await waitFor(() => expect(r.clients.getProductImages).toHaveBeenCalledTimes(1));
    await settle();
    await settle();
    expect(r.clients.getProductImages).toHaveBeenCalledTimes(1);
    expect(result.current.size).toBe(0);
    expect(imagesComplete(result.current)).toBe(false);
    await nextPass(r);
    await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(url('a')), { timeout: 3000 });
    expect(r.clients.getProductImages).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(imagesComplete(result.current)).toBe(true));
    // synced: a later pass asks nothing more
    await nextPass(r);
    await settle();
    expect(r.clients.getProductImages).toHaveBeenCalledTimes(2);
  });

  // PHOTOS1 (Ross 11-04): the figures past the first cabinets stood as name cards for as long as the page stayed open
  it('a sync that read the lists and left an image unfetched has it fetched at the engine\'s next pass, from the kept list: no list is read again (PHOTOS1)', async () => {
    let refusing = true;
    storage = fakeCaches(async () => (refusing ? new Response('', { status: 503 }) : new Response('img')));
    vi.stubGlobal('caches', storage);
    vi.stubGlobal('fetch', storage.fetch);
    const r = await localRig();
    await seedFigures(r, [{ title: 'Refused, then served' }]);
    r.clients.getProductImages.mockResolvedValue(oneImage(0, 'a'));
    const client = appClient();
    const { result } = renderHook(() => useCollectionImages(), { wrapper: queryWrapper(client) });
    await waitFor(() => expect(storage.added.map((q) => q.url)).toEqual([url('a')]));
    await waitFor(() => expect(client.getQueryCache().findAll({ queryKey: ['local', 'kept-images'], fetchStatus: 'idle', predicate: (q) => q.state.data !== undefined })).toHaveLength(1));
    await waitFor(() => expect(imagesComplete(result.current)).toBe(false));
    refusing = false;
    await nextPass(r);
    await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(url('a')), { timeout: 3000 });
    expect(storage.added.map((q) => q.url)).toEqual([url('a'), url('a')]);
    expect(r.clients.getProductImages).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(imagesComplete(result.current)).toBe(true));
    // nothing is left: a later pass fetches nothing
    await nextPass(r);
    await quiet();
    expect(storage.added).toHaveLength(2);
  });

  it('a sync that left images unfetched: the view moved to them fetches them at once, in its order, with no pass and no list read (PHOTOS1)', async () => {
    let refusing = true;
    storage = fakeCaches(async () => (refusing ? new Response('', { status: 503 }) : new Response('img')));
    vi.stubGlobal('caches', storage);
    vi.stubGlobal('fetch', storage.fetch);
    const r = await localRig();
    r.clients.getProductImages.mockResolvedValue(
      create(GetProductImagesResponseSchema, { products: [listWithMask(0, 'a', 'b'), listWithMask(1, 'c', 'd'), listWithMask(2, 'e', 'f')] }),
    );
    await seedFigures(r, [{ title: 'One' }, { title: 'Two' }, { title: 'Three' }]);
    const client = appClient();
    const { result } = renderHook(() => useCollectionImages(), { wrapper: queryWrapper(client) });
    await waitFor(() => expect(storage.added).toHaveLength(6));
    await waitFor(() => expect(client.getQueryCache().findAll({ queryKey: ['local', 'kept-images'], fetchStatus: 'idle', predicate: (q) => q.state.data !== undefined })).toHaveLength(1));
    refusing = false;
    // Free camera walked far along: the case now draws the third figure, then the first
    setFetchOrder([headOf(2), headOf(0), headOf(1)]);
    await waitFor(() => expect(result.current.size).toBe(3), { timeout: 3000 });
    expect(storage.added.slice(6).map((q) => q.url)).toEqual(['e', 'f', 'a', 'b', 'c', 'd'].map(url));
    expect(r.clients.getProductImages).toHaveBeenCalledTimes(1);
  });

  /** A sync that read the lists of `n` figures (image c0, c1, ...) and left every image unfetched: the link refused them (503). */
  const leftAll = async (n: number, link: (req: Request) => Promise<Response>) => {
    storage = fakeCaches(link);
    vi.stubGlobal('caches', storage);
    vi.stubGlobal('fetch', storage.fetch);
    const r = await localRig();
    r.clients.getProductImages.mockResolvedValue(
      create(GetProductImagesResponseSchema, {
        products: Array.from({ length: n }, (_, i) => ({ headId: headOf(i), images: [{ derivativeId: String(i).repeat(64), role: 'gallery', url: url(String(i)), width: 600, height: 800 }] })),
      }),
    );
    await seedFigures(r, Array.from({ length: n }, (_, i) => ({ title: `F${i}` })));
    const client = appClient();
    const view = renderHook(() => useCollectionImages(), { wrapper: queryWrapper(client) });
    await waitFor(() => expect(storage.added).toHaveLength(n), { timeout: 5000 });
    await waitFor(() => expect(client.getQueryCache().findAll({ queryKey: ['local', 'kept-images'], fetchStatus: 'idle', predicate: (q) => q.state.data !== undefined })).toHaveLength(1), { timeout: 5000 });
    return { r, client, view };
  };

  it('a fill the link still refuses part of leaves the answer partial, and that image to a fill REFILL_AFTER_MS on, not one at every order (PHOTOS1)', async () => {
    let serve = new Set<string>();
    const { view } = await leftAll(2, async (req) => (serve.has(req.url) ? new Response('img') : new Response('', { status: 503 })));
    serve = new Set([url('0')]);
    setFetchOrder([headOf(0), headOf(1)]);
    await waitFor(() => expect(view.result.current.get(headOf(0))?.url).toBe(url('0')), { timeout: 3000 });
    expect(imagesComplete(view.result.current)).toBe(false);
    const asked = storage.added.length;
    expect(asked).toBe(4);
    // the view moves again at once: the refused image is not asked for again yet
    setFetchOrder([headOf(1), headOf(0)]);
    await quiet();
    expect(storage.added).toHaveLength(asked);
    serve = new Set([url('0'), url('1')]);
    const later = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + REFILL_AFTER_MS);
    try {
      setFetchOrder([headOf(1)]);
      await waitFor(() => expect(view.result.current.get(headOf(1))?.url).toBe(url('1')), { timeout: 3000 });
    } finally {
      later.mockRestore();
    }
    expect(REFILL_AFTER_MS).toBe(30_000);
  });

  // PHOTOS1 fix round (B1): an origin refusing every image was asked again by a fill every 30 s for as long as the page stayed open
  it('a fill that fetched nothing, the link refusing all, starts no other fill till the soonest refused address may be asked: 30 s, then 60 s (PHOTOS1)', async () => {
    const uninstall = installFakeLocks();
    try {
      const { view } = await leftAll(2, async () => new Response('', { status: 503 }));
      const locks = (navigator as unknown as { locks: { asked: string[] } }).locks;
      const fills = locks.asked.length;
      setFetchOrder([headOf(0), headOf(1)]);
      await waitFor(() => expect(storage.added).toHaveLength(4));
      await quiet();
      const t = Date.now();
      // the view moves again at once: no fill starts
      setFetchOrder([headOf(1), headOf(0)]);
      await quiet();
      expect(locks.asked.length).toBe(fills + 1);
      const at = (ms: number) => vi.spyOn(Date, 'now').mockReturnValue(t + ms);
      try {
        at(REFILL_AFTER_MS);
        setFetchOrder([headOf(0), headOf(1)]);
        await waitFor(() => expect(storage.added).toHaveLength(6));
        // refused twice now: held 60 s more, so a pass or a move 30 s on starts no fill
        at(2 * REFILL_AFTER_MS);
        setFetchOrder([headOf(1), headOf(0)]);
        await quiet();
        expect(locks.asked.length).toBe(fills + 2);
        at(3 * REFILL_AFTER_MS);
        setFetchOrder([headOf(0), headOf(1)]);
        await waitFor(() => expect(storage.added).toHaveLength(8));
      } finally {
        vi.restoreAllMocks();
      }
      expect(view.result.current.size).toBe(0);
    } finally {
      uninstall();
    }
  });

  it('a fill the device refused to keep an image for want of space starts no other fill, however long the view moves; the next sync asks again (PHOTOS1)', async () => {
    const uninstall = installFakeLocks();
    try {
      let serve = false;
      const { r } = await leftAll(10, async () => (serve ? new Response('img') : new Response('', { status: 503 })));
      serve = true;
      const open = storage.open.bind(storage);
      storage.open = (async (name: string) => {
        const cache = await open(name);
        if (name !== OWNED_MEDIA_CACHE) return cache;
        cache.put = async () => {
          throw new DOMException('the device is full', 'QuotaExceededError');
        };
        return cache;
      }) as typeof storage.open;
      const locks = (navigator as unknown as { locks: { asked: string[] } }).locks;
      const fills = locks.asked.length;
      const t = Date.now();
      setFetchOrder([headOf(0), headOf(1)]);
      await waitFor(() => expect(storage.added.length).toBeGreaterThan(10));
      await quiet();
      // the fetches in flight when the first write was refused end; no other starts
      const asked = storage.added.length;
      expect(asked).toBeLessThan(20);
      vi.spyOn(Date, 'now').mockReturnValue(t + 20 * REFILL_AFTER_MS);
      try {
        setFetchOrder([headOf(1), headOf(0)]);
        await quiet();
        await nextPass(r);
        await quiet();
        expect(locks.asked.length).toBe(fills + 1);
        expect(storage.added).toHaveLength(asked);
      } finally {
        vi.restoreAllMocks();
      }
      await r.engine.write((store) => store.createCopy(headOf(15), 'owned'));
      await waitFor(() => expect(r.clients.getProductImages).toHaveBeenCalledTimes(2));
    } finally {
      uninstall();
    }
  });

  it('a fill that finds nothing left to fetch (another document fetched it) leaves the answer as it is and asks nothing again (PHOTOS1)', async () => {
    const uninstall = installFakeLocks();
    try {
      const { view } = await leftAll(1, async () => new Response('', { status: 503 }));
      const before = view.result.current;
      // another document of the app kept the bytes meanwhile
      await (await storage.open(OWNED_MEDIA_CACHE)).put(url('0'), new Response('bytes'));
      const locks = (navigator as unknown as { locks: { asked: string[] } }).locks;
      const asked = locks.asked.length;
      setFetchOrder([headOf(0)]);
      await waitFor(() => expect(locks.asked.length).toBe(asked + 1));
      await quiet();
      expect(view.result.current).toBe(before);
      setFetchOrder([headOf(0), headOf(0)]);
      await quiet();
      expect(locks.asked.length).toBe(asked + 1);
      expect(storage.added).toHaveLength(1);
    } finally {
      uninstall();
    }
  });

  it('another document\'s sync holding the lock: the fill fetches nothing, and a later order fills (PHOTOS1)', async () => {
    const uninstall = installFakeLocks();
    try {
      let serve = false;
      const { view } = await leftAll(1, async () => (serve ? new Response('img') : new Response('', { status: 503 })));
      // another document's sync of the same figure, reading its lists (the link still refusing its image)
      let answer!: () => void;
      const list = await recallImages(headOf(0), storage);
      const other = syncKeptImages([headOf(0)], async () => {
        await new Promise<void>((res) => (answer = res));
        return new Map([[headOf(0), list!.map((i) => ({ ...i, derivativeId: i.url.slice(-64), $typeName: 'fc.api.v1.ProductImage' }) as never)]]);
      }, { storage, lockWaitMs: 60_000 });
      await settle();
      setFetchOrder([headOf(0)]);
      await quiet();
      expect(storage.added).toHaveLength(1);
      answer();
      await other;
      expect(storage.added).toHaveLength(2);
      serve = true;
      setFetchOrder([headOf(0), headOf(0)]);
      await waitFor(() => expect(view.result.current.get(headOf(0))?.url).toBe(url('0')), { timeout: 3000 });
    } finally {
      uninstall();
    }
  });

  it('a new sync (the kept figures changed) stops a fill under way first, its fetch aborted, so the sync never waits on its lock (PHOTOS1)', async () => {
    const uninstall = installFakeLocks();
    try {
      let hang = false;
      const { r } = await leftAll(1, (req) =>
        hang ? new Promise<Response>((_res, rej) => req.signal.addEventListener('abort', () => rej(req.signal.reason))) : Promise.resolve(new Response('', { status: 503 })),
      );
      hang = true;
      setFetchOrder([headOf(0)]);
      await waitFor(() => expect(storage.added).toHaveLength(2));
      const filling = storage.added[1]!.signal;
      expect(filling.aborted).toBe(false);
      await r.engine.write((store) => store.createCopy(headOf(5), 'owned'));
      await waitFor(() => expect(filling.aborted).toBe(true));
      await waitFor(() => expect(r.clients.getProductImages).toHaveBeenCalledTimes(2));
    } finally {
      uninstall();
    }
  });

  it('the case view going away stops its fill, the fetch in flight aborted (PHOTOS1)', async () => {
    let hang = false;
    const { view } = await leftAll(1, (req) =>
      hang ? new Promise<Response>((_res, rej) => req.signal.addEventListener('abort', () => rej(req.signal.reason))) : Promise.resolve(new Response('', { status: 503 })),
    );
    hang = true;
    setFetchOrder([headOf(0)]);
    await waitFor(() => expect(storage.added).toHaveLength(2));
    const filling = storage.added[1]!.signal;
    view.unmount();
    await waitFor(() => expect(filling.aborted).toBe(true));
  });

  it('a pass the engine completes while a sync is under way neither stops it nor starts another (NEWHOLD-IMG-1)', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Owned' }]);
    let answer!: () => void;
    let seen: AbortSignal | undefined;
    r.clients.getProductImages.mockImplementation((_req: unknown, opts?: { signal?: AbortSignal }) => {
      seen = opts?.signal;
      return new Promise((res) => (answer = () => res(oneImage(0, 'a'))));
    });
    const { result } = renderHook(() => useCollectionImages(), { wrapper: queryWrapper() });
    await waitFor(() => expect(r.clients.getProductImages).toHaveBeenCalledTimes(1));
    await nextPass(r);
    await settle();
    expect(seen?.aborted).toBe(false);
    expect(r.clients.getProductImages).toHaveBeenCalledTimes(1);
    answer();
    await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(url('a')), { timeout: 3000 });
    expect(r.clients.getProductImages).toHaveBeenCalledTimes(1);
  });

  it('a pass the engine completes while the device is signed out asks nothing (NEWHOLD-IMG-1)', async () => {
    const r = await localRig({ status: 'signed-out' });
    await seedFigures(r, [{ title: 'Owned' }]);
    const { result } = renderHook(() => useCollectionImages(), { wrapper: queryWrapper() });
    await nextPass(r);
    await settle();
    expect(r.clients.getProductImages).not.toHaveBeenCalled();
    expect(result.current.size).toBe(0);
  });

  it('answers nothing while signed out', async () => {
    const { result } = renderHook(() => useCollectionImages(), { wrapper: queryWrapper() });
    await new Promise((res) => setTimeout(res, 20));
    expect(result.current.size).toBe(0);
  });
});

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
import { imagesComplete, useCollectionImages } from '../useCollectionImages';
import { useOnlineStatus } from '../useOnlineStatus';
import { localRig, queryWrapper } from '../../local/__tests__/localHarness';
import { seedFigures } from '../../local/__tests__/seedFigures';
import { localSession } from '../../local/session';
import { headOf } from '../../sync/__tests__/engineSupport';
import { fakeCaches, type FakeCaches } from '../../test/fakeCaches';
import { OWNED_MEDIA_CACHE, rememberImages, syncKeptImages } from '../../media/keptImages';
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

beforeEach(() => {
  storage = fakeCaches();
  vi.stubGlobal('caches', storage);
  vi.stubGlobal('fetch', storage.fetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
  localSession.value = undefined;
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

  it('imagesComplete: yes while signed out, where nothing will ever stream in', async () => {
    const { result } = renderHook(() => useCollectionImages(), { wrapper: queryWrapper() });
    await new Promise((res) => setTimeout(res, 20));
    expect(imagesComplete(result.current)).toBe(true);
  });

  it('answers nothing while signed out', async () => {
    const { result } = renderHook(() => useCollectionImages(), { wrapper: queryWrapper() });
    await new Promise((res) => setTimeout(res, 20));
    expect(result.current.size).toBe(0);
  });
});

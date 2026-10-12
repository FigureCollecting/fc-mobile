// ADDR-1: an image a completed owned sync withheld is not answered again by the case view's hook
// (useOwnedImages) or the figure page's (useProductImage), offline or online, whatever answer either
// gave before the sync: in the document that ran it, and in every other open document of the app (a
// tab, the installed window), each with its own QueryClient over the same caches, told on a
// BroadcastChannel. Each QueryClient has the app's defaults (src/app.tsx): an answer no view shows is
// kept 30 minutes, and each hook keeps its answers fresh for 10.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/preact';
import { create } from '@bufbuild/protobuf';
import { QueryClient } from '@tanstack/react-query';
import { GetProductImagesResponseSchema } from '@figurecollecting/fc-api-contract';
import { useOwnedImages } from '../useOwnedImages';
import { useProductImage } from '../useProductImage';
import { useOnlineStatus } from '../useOnlineStatus';
import { localRig, queryWrapper, type LocalRig } from '../../local/__tests__/localHarness';
import { seedFigures } from '../../local/__tests__/seedFigures';
import { localSession } from '../../local/session';
import { headOf } from '../../sync/__tests__/engineSupport';
import { fakeCaches, type FakeCaches } from '../../test/fakeCaches';
import { BROWSED_MEDIA_CACHE, IMAGE_LISTS_CACHE, OWNED_MEDIA_CACHE, WITHHELD_CACHE, rememberImages, syncOwnedImages, withheldAmong } from '../../media/ownedImages';
import { tellOwnedSync } from '../imageAnswers';

const D = 'https://images.figurecollecting.com/d';
const X = `${D}/${'c'.repeat(64)}`;
const B = `${D}/${'0'.repeat(64)}`;
const Y = `${D}/${'e'.repeat(64)}`;
let storage: FakeCaches;

/** The app's QueryClient (src/app.tsx). */
const appQueryClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 60_000, gcTime: 30 * 60_000, networkMode: 'offlineFirst' } } });
/** The coordinator's list for the figure: the first image primary. None: every image withheld. */
const listOf = (...urls: string[]) => listing(...urls.map((url, i) => ({ url, primary: i === 0 })));
/** The coordinator's list for the figure, in this order, each marked primary or not. */
const listing = (...images: { url: string; primary: boolean }[]) =>
  create(GetProductImagesResponseSchema, { products: [{ headId: headOf(0), images: images.map((i) => ({ derivativeId: i.url.slice(-64), role: 'gallery', primary: i.primary, url: i.url, width: 600, height: 800 })) }] });
const setOnline = (on: boolean) =>
  act(() => {
    window.dispatchEvent(new Event(on ? 'online' : 'offline'));
  });
const settle = () => new Promise((res) => setTimeout(res, 50));
/** Every address any cache holds an entry for. */
const held = () => [OWNED_MEDIA_CACHE, BROWSED_MEDIA_CACHE].flatMap((n) => [...(storage.stores.get(n)?.keys() ?? [])]);
/** The channel each document of the app hears another's completed sync on: one name across builds. */
const CHANNEL = 'fc-owned-images';
/** The figure page's answers a document's QueryClient holds, shown or not. */
const pageAnswers = (client: QueryClient) => client.getQueryCache().findAll({ queryKey: ['local', 'image'] }).length;

/** The last sync kept X for the owned figure: its list and its bytes. */
async function keptX(): Promise<void> {
  await rememberImages(headOf(0), [{ url: X, width: 600, height: 800, role: 'gallery', primary: true }], storage);
  await (await storage.open(OWNED_MEDIA_CACHE)).put(X, new Response('bytes'));
}

/** The case view opens in reach: its sync runs on the coordinator's fresh list and completes; then it goes away. */
async function caseViewSyncs(r: LocalRig, client: QueryClient, fresh: ReturnType<typeof listOf>): Promise<void> {
  r.clients.getProductImages.mockResolvedValue(fresh);
  // Its answer of an earlier sync is stale (ten minutes on), so this one syncs.
  client.removeQueries({ queryKey: ['local', 'owned-images'] });
  const asked = r.clients.getProductImages.mock.calls.length;
  const view = renderHook(() => useOwnedImages(), { wrapper: queryWrapper(client) });
  await waitFor(() => expect(r.clients.getProductImages.mock.calls.length).toBeGreaterThan(asked));
  await waitFor(() => expect(client.isFetching()).toBe(0));
  view.unmount();
}

/** The figure page's answer: on its first render, and once it settles. */
async function figurePage(client: QueryClient): Promise<{ first: string | null | undefined; settled: string | null | undefined }> {
  const page = renderHook(() => useProductImage(headOf(0)), { wrapper: queryWrapper(client) });
  const first = page.result.current.data === undefined ? undefined : (page.result.current.data?.url ?? null);
  await waitFor(() => expect(page.result.current.isFetching).toBe(false));
  await settle();
  const settled = page.result.current.data === undefined ? undefined : (page.result.current.data?.url ?? null);
  page.unmount();
  return { first, settled };
}

beforeEach(() => {
  storage = fakeCaches();
  vi.stubGlobal('caches', storage);
  renderHook(() => useOnlineStatus());
});
afterEach(() => {
  setOnline(true);
  vi.unstubAllGlobals();
  localSession.value = undefined;
});

describe('the case view (useOwnedImages), offline, then online a sync withholds the kept image, then offline again', () => {
  it.each([
    ['the plate, when the figure has no image left', [] as string[], undefined],
    ['the image the sync kept instead', [B], B],
  ])('answers %s, never the withheld one', async (_name, fresh, expected) => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Owned' }]);
    await keptX();
    const client = appQueryClient();
    setOnline(false);
    const { result } = renderHook(() => useOwnedImages(), { wrapper: queryWrapper(client) });
    await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(X));
    r.clients.getProductImages.mockResolvedValue(listOf(...fresh));
    setOnline(true);
    await waitFor(() => expect(r.clients.getProductImages).toHaveBeenCalled());
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(result.current.get(headOf(0))?.url).toBe(expected);
    expect(held()).not.toContain(X);
    setOnline(false);
    expect(result.current.get(headOf(0))?.url).not.toBe(X);
    await settle();
    expect(result.current.get(headOf(0))?.url).toBe(expected);
  });
});

describe('the figure page (useProductImage) after the case view\'s sync withheld its image, in the same document', () => {
  it('offline, then the sync online, then offline again: answers the plate, never the withheld image', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Owned' }]);
    await keptX();
    const client = appQueryClient();
    setOnline(false);
    expect((await figurePage(client)).settled).toBe(X);
    setOnline(true);
    await caseViewSyncs(r, client, listOf());
    expect(held()).not.toContain(X);
    setOnline(false);
    expect(await figurePage(client)).toEqual({ first: undefined, settled: null });
  });

  it('online before and after the sync: asks again, and answers what the coordinator now lists, never the withheld image', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Owned' }]);
    const client = appQueryClient();
    r.clients.getProductImages.mockResolvedValue(listOf(X));
    expect((await figurePage(client)).settled).toBe(X);
    await caseViewSyncs(r, client, listOf(B));
    const asked = r.clients.getProductImages.mock.calls.length;
    expect(await figurePage(client)).toEqual({ first: undefined, settled: B });
    expect(r.clients.getProductImages.mock.calls.length).toBe(asked + 1);
  });

  it('open while the sync withholds its image: asks again and stops answering it', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Owned' }]);
    const client = appQueryClient();
    r.clients.getProductImages.mockResolvedValue(listOf(X));
    const page = renderHook(() => useProductImage(headOf(0)), { wrapper: queryWrapper(client) });
    await waitFor(() => expect(page.result.current.data?.url).toBe(X));
    await caseViewSyncs(r, client, listOf());
    await waitFor(() => expect(page.result.current.data).toBeNull());
  });

  it('online: never answers an address the last sync withheld, even when the coordinator lists it again before the next sync', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Owned' }]);
    await keptX();
    const client = appQueryClient();
    await caseViewSyncs(r, client, listOf());
    expect([...(await withheldAmong([X], storage))]).toEqual([X]);
    r.clients.getProductImages.mockResolvedValue(listOf(X, Y));
    expect((await figurePage(client)).settled).toBe(Y);
    client.clear();
    r.clients.getProductImages.mockResolvedValue(listOf(X));
    expect((await figurePage(client)).settled).toBeNull();
    // A sync whose fresh list carries it again forgets it: the figure page answers it.
    await caseViewSyncs(r, client, listOf(X));
    expect((await figurePage(client)).settled).toBe(X);
  });
});

describe('the figure page (useProductImage) online, the withheld address the primary but not listed first', () => {
  it('answers the other image, never the withheld one', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Owned' }]);
    await keptX();
    const client = appQueryClient();
    await caseViewSyncs(r, client, listOf());
    expect([...(await withheldAmong([X], storage))]).toEqual([X]);
    client.clear();
    r.clients.getProductImages.mockResolvedValue(listing({ url: Y, primary: false }, { url: X, primary: true }));
    expect((await figurePage(client)).settled).toBe(Y);
  });
});

describe('what a completed sync leaves alone', () => {
  it('drops no answer but the two image hooks\': another local answer, or another image answer, stays', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Owned' }]);
    await keptX();
    const client = appQueryClient();
    client.setQueryData(['local', 'collection-counts'], { owned: 1 });
    client.setQueryData(['remote', 'image', headOf(0)], { url: X });
    await caseViewSyncs(r, client, listOf());
    expect(client.getQueryData(['local', 'collection-counts'])).toEqual({ owned: 1 });
    expect(client.getQueryData(['remote', 'image', headOf(0)])).toEqual({ url: X });
    expect(client.getQueryState(['local', 'collection-counts'])?.isInvalidated).toBe(false);
  });
});

describe('the case view\'s own answer', () => {
  it('is not dropped by its own sync, nor by the message the sync tells: a sync over an earlier answer (ten minutes on) runs once and answers once', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Owned' }]);
    const client = appQueryClient();
    // A sync that dropped its own answer would sync again, endlessly: the coordinator stops answering after 3.
    r.clients.getProductImages.mockImplementation(async () => (r.clients.getProductImages.mock.calls.length > 3 ? new Promise(() => {}) : listOf(B)));
    const { result } = renderHook(() => useOwnedImages(), { wrapper: queryWrapper(client) });
    await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(B));
    expect(r.clients.getProductImages).toHaveBeenCalledTimes(1);
    await act(() => client.refetchQueries({ queryKey: ['local', 'owned-images'] }));
    await waitFor(() => expect(client.isFetching()).toBe(0));
    await settle();
    expect(r.clients.getProductImages).toHaveBeenCalledTimes(2);
    expect(result.current.get(headOf(0))?.url).toBe(B);
    // The document that told never hears its own message: a case view that did would answer again from the caches.
    expect(client.getQueryCache().findAll({ queryKey: ['local', 'owned-images'] }).map((q) => q.state.dataUpdateCount)).toEqual([2]);
  });
});

describe('a sync that does not complete', () => {
  it('drops no answer: offline the figure page still answers the kept image, its bytes still on the device', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Owned' }]);
    await keptX();
    const client = appQueryClient();
    setOnline(false);
    expect((await figurePage(client)).settled).toBe(X);
    setOnline(true);
    r.clients.getProductImages.mockRejectedValue(new Error('unavailable'));
    const view = renderHook(() => useOwnedImages(), { wrapper: queryWrapper(client) });
    await waitFor(() => expect(r.clients.getProductImages).toHaveBeenCalled());
    await waitFor(() => expect(client.isFetching()).toBe(0));
    view.unmount();
    setOnline(false);
    expect((await figurePage(client)).first).toBe(X);
    expect([...(storage.stores.get(IMAGE_LISTS_CACHE)?.keys() ?? [])]).toHaveLength(1);
  });
});

describe('another open document of the app (a tab, the installed window): its own QueryClient, the same caches', () => {
  it('the figure page, offline in both, then the first document\'s case view syncs online and withholds its image, then offline: both answer the plate', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Owned' }]);
    await keptX();
    const docA = appQueryClient();
    const docB = appQueryClient();
    setOnline(false);
    expect((await figurePage(docA)).settled).toBe(X);
    expect((await figurePage(docB)).settled).toBe(X);
    setOnline(true);
    await caseViewSyncs(r, docA, listOf());
    // Told of the sync, the other document drops the answer no view shows.
    await waitFor(() => expect(pageAnswers(docB)).toBe(0));
    setOnline(false);
    expect(await figurePage(docA)).toEqual({ first: undefined, settled: null });
    expect(await figurePage(docB)).toEqual({ first: undefined, settled: null });
  });

  it('the figure page, open online in the other document while the sync withholds its image: asks again and stops answering it', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Owned' }]);
    const docA = appQueryClient();
    const docB = appQueryClient();
    r.clients.getProductImages.mockResolvedValue(listOf(X));
    const page = renderHook(() => useProductImage(headOf(0)), { wrapper: queryWrapper(docB) });
    await waitFor(() => expect(page.result.current.data?.url).toBe(X));
    await caseViewSyncs(r, docA, listOf());
    await waitFor(() => expect(page.result.current.data).toBeNull());
  });

  it('the case view, open online in both: the other answers what the first one\'s sync kept, and neither syncs again', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Owned' }]);
    const docA = appQueryClient();
    const docB = appQueryClient();
    r.clients.getProductImages.mockResolvedValue(listOf(X));
    const viewB = renderHook(() => useOwnedImages(), { wrapper: queryWrapper(docB) });
    await waitFor(() => expect(viewB.result.current.get(headOf(0))?.url).toBe(X));
    r.clients.getProductImages.mockResolvedValue(listOf(B));
    const viewA = renderHook(() => useOwnedImages(), { wrapper: queryWrapper(docA) });
    await waitFor(() => expect(viewA.result.current.get(headOf(0))?.url).toBe(B));
    await waitFor(() => expect(viewB.result.current.get(headOf(0))?.url).toBe(B));
    await settle();
    expect(held()).not.toContain(X);
    // One sync each: a document told of another's sync answers from what it kept, so two open case views never sync each other.
    expect(r.clients.getProductImages).toHaveBeenCalledTimes(2);
    expect(viewA.result.current.get(headOf(0))?.url).toBe(B);
    expect(viewB.result.current.get(headOf(0))?.url).toBe(B);
    // Only that once: the other document's next sync of its own asks the coordinator.
    await act(() => docB.refetchQueries({ queryKey: ['local', 'owned-images'] }));
    await waitFor(() => expect(docB.isFetching()).toBe(0));
    expect(r.clients.getProductImages).toHaveBeenCalledTimes(3);
  });

  it('the case view, open out of reach in the other document: told of a sync that withheld its image, answers the plate', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Owned' }]);
    await keptX();
    const docA = appQueryClient();
    const docB = appQueryClient();
    setOnline(false);
    const viewB = renderHook(() => useOwnedImages(), { wrapper: queryWrapper(docB) });
    await waitFor(() => expect(viewB.result.current.get(headOf(0))?.url).toBe(X));
    // The first document, in reach, completes a sync the coordinator's lists withhold the image in.
    await syncOwnedImages([headOf(0)], async () => new Map(), { storage });
    tellOwnedSync(docA);
    await waitFor(() => expect(viewB.result.current.get(headOf(0))).toBeUndefined());
    expect(r.clients.getProductImages).not.toHaveBeenCalled();
  });

  it('a figure page answer still being read when the sync completes is read again, so it never answers the withheld image', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Owned' }]);
    await keptX();
    const docA = appQueryClient();
    const docB = appQueryClient();
    // The other document's figure page has looked for a withheld record (none yet) and not answered.
    let looked!: () => void;
    const looking = new Promise<void>((res) => (looked = res));
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    let first = true;
    const open = storage.open.bind(storage);
    (storage as unknown as { open: (name: string) => Promise<Cache> }).open = async (name: string) => {
      const cache = await open(name);
      if (name !== WITHHELD_CACHE) return cache;
      return Object.assign(Object.create(cache) as Cache, {
        match: async (req: RequestInfo | URL, o?: CacheQueryOptions) => {
          const found = await cache.match(req, o);
          if (first) {
            first = false;
            looked();
            await gate;
          }
          return found;
        },
      });
    };
    r.clients.getProductImages.mockResolvedValue(listOf(X));
    const answers: (string | null | undefined)[] = [];
    const page = renderHook(
      () => {
        const q = useProductImage(headOf(0));
        answers.push(q.data === undefined ? undefined : (q.data?.url ?? null));
        return q;
      },
      { wrapper: queryWrapper(docB) },
    );
    await looking;
    const asked = r.clients.getProductImages.mock.calls.length;
    await caseViewSyncs(r, docA, listOf());
    // The first document's sync asked once; told of it, the other stops that read and asks again.
    await waitFor(() => expect(r.clients.getProductImages.mock.calls.length).toBe(asked + 2));
    release();
    await waitFor(() => expect(page.result.current.data).toBeNull());
    await settle();
    expect(page.result.current.data).toBeNull();
    expect(answers).not.toContain(X);
  });

  it('a sync that does not complete tells no other document: their answers stand', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Owned' }]);
    await keptX();
    const docA = appQueryClient();
    const docB = appQueryClient();
    setOnline(false);
    expect((await figurePage(docB)).settled).toBe(X);
    const listener = new BroadcastChannel(CHANNEL);
    const heard: unknown[] = [];
    listener.onmessage = (e) => heard.push(e.data);
    setOnline(true);
    r.clients.getProductImages.mockRejectedValue(new Error('unavailable'));
    const view = renderHook(() => useOwnedImages(), { wrapper: queryWrapper(docA) });
    await waitFor(() => expect(r.clients.getProductImages).toHaveBeenCalled());
    await waitFor(() => expect(docA.isFetching()).toBe(0));
    view.unmount();
    // A completed sync's message arrives within milliseconds (the next test); none comes.
    await settle();
    await settle();
    listener.close();
    expect(heard).toEqual([]);
    expect(pageAnswers(docB)).toBe(1);
  });

  it('a completed sync is told once, on the channel every document listens on', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Owned' }]);
    const listener = new BroadcastChannel(CHANNEL);
    const heard: unknown[] = [];
    listener.onmessage = (e) => heard.push(e.data);
    try {
      await caseViewSyncs(r, appQueryClient(), listOf(B));
      await waitFor(() => expect(heard).toHaveLength(1));
      await settle();
      expect(heard).toHaveLength(1);
    } finally {
      listener.close();
    }
  });

  it('where the browser has no BroadcastChannel: nothing is told, and the document that ran the sync still drops its own answers', async () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    const r = await localRig();
    await seedFigures(r, [{ title: 'Owned' }]);
    await keptX();
    const client = appQueryClient();
    setOnline(false);
    expect((await figurePage(client)).settled).toBe(X);
    setOnline(true);
    await caseViewSyncs(r, client, listOf());
    setOnline(false);
    expect(await figurePage(client)).toEqual({ first: undefined, settled: null });
  });
});

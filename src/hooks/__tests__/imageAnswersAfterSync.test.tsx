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
import { BROWSED_MEDIA_CACHE, IMAGE_LISTS_CACHE, OWNED_MEDIA_CACHE, WITHHELD_CACHE, recallImages, rememberImages, syncOwnedImages, withheldAmong } from '../../media/ownedImages';
import { tellOwnedSync } from '../imageAnswers';
import { fakeLocks, installFakeLocks, type FakeLocks } from '../../test/fakeLocks';

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
  vi.stubGlobal('fetch', storage.fetch);
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
    tellOwnedSync(docA, 'synced');
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

describe('an answer a view shows, while it is asked again after a sync that withheld its image: it never waits on the coordinator to stop naming it', () => {
  /** The coordinator withholds X now; its first answer (the case view's sync) comes at once, every later one waits for `answer`. With `from` 1, every answer waits. */
  function laterAnswersWait(r: LocalRig, from = 2): { answer: () => void; asked: () => number } {
    let answer!: () => void;
    const later = new Promise<void>((res) => (answer = res));
    let n = 0;
    r.clients.getProductImages.mockImplementation(async () => {
      n += 1;
      if (n >= from) await later;
      return listOf();
    });
    return { answer, asked: () => n };
  }

  it.each([
    ['another document', true],
    ['the document that ran the sync', false],
  ])('the figure page, open online in %s: answers the plate before the coordinator answers its re-ask', async (_where, other) => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Owned' }]);
    const docA = appQueryClient();
    const docB = other ? appQueryClient() : docA;
    r.clients.getProductImages.mockResolvedValue(listOf(X));
    const first = renderHook(() => useOwnedImages(), { wrapper: queryWrapper(docA) });
    await waitFor(() => expect(first.result.current.get(headOf(0))?.url).toBe(X));
    first.unmount();
    const page = renderHook(() => useProductImage(headOf(0)), { wrapper: queryWrapper(docB) });
    await waitFor(() => expect(page.result.current.data?.url).toBe(X));
    const coordinator = laterAnswersWait(r);
    docA.removeQueries({ queryKey: ['local', 'owned-images'] });
    const view = renderHook(() => useOwnedImages(), { wrapper: queryWrapper(docA) });
    await waitFor(() => expect(coordinator.asked()).toBe(2));
    // The page's re-ask is with the coordinator: its answer is already the plate.
    await waitFor(() => expect(page.result.current.data).toBeNull());
    expect(page.result.current.isFetching).toBe(true);
    coordinator.answer();
    await waitFor(() => expect(page.result.current.isFetching).toBe(false));
    expect(page.result.current.data).toBeNull();
    view.unmount();
  });

  it('the figure page, open online in another document, its re-ask never answered: answers the plate, and goes on answering it', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Owned' }]);
    const docA = appQueryClient();
    const docB = appQueryClient();
    r.clients.getProductImages.mockResolvedValue(listOf(X));
    const first = renderHook(() => useOwnedImages(), { wrapper: queryWrapper(docA) });
    await waitFor(() => expect(first.result.current.get(headOf(0))?.url).toBe(X));
    first.unmount();
    const page = renderHook(() => useProductImage(headOf(0)), { wrapper: queryWrapper(docB) });
    await waitFor(() => expect(page.result.current.data?.url).toBe(X));
    const coordinator = laterAnswersWait(r);
    docA.removeQueries({ queryKey: ['local', 'owned-images'] });
    const view = renderHook(() => useOwnedImages(), { wrapper: queryWrapper(docA) });
    await waitFor(() => expect(coordinator.asked()).toBe(2));
    await waitFor(() => expect(page.result.current.data).toBeNull());
    await new Promise((res) => setTimeout(res, 500));
    expect(page.result.current.data).toBeNull();
    expect(page.result.current.isFetching).toBe(true);
    page.unmount();
    view.unmount();
  });

  it('the figure page, open online in another document, its image not withheld: goes on answering it while it is asked again', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Owned' }]);
    const docA = appQueryClient();
    const docB = appQueryClient();
    r.clients.getProductImages.mockResolvedValue(listOf(B));
    const page = renderHook(() => useProductImage(headOf(0)), { wrapper: queryWrapper(docB) });
    await waitFor(() => expect(page.result.current.data?.url).toBe(B));
    let answer!: () => void;
    const later = new Promise<void>((res) => (answer = res));
    let n = 0;
    r.clients.getProductImages.mockImplementation(async () => {
      n += 1;
      if (n >= 2) await later;
      return listOf(B);
    });
    const view = renderHook(() => useOwnedImages(), { wrapper: queryWrapper(docA) });
    // The page's re-ask is with the coordinator.
    await waitFor(() => expect(n).toBe(2));
    expect(docB.isFetching()).toBe(1);
    await settle();
    expect(page.result.current.data?.url).toBe(B);
    answer();
    await waitFor(() => expect(docB.isFetching()).toBe(0));
    expect(page.result.current.data?.url).toBe(B);
    view.unmount();
    page.unmount();
  });

  it('the figure page asks the coordinator with a deadline of 10 s, so a re-ask on a stalled link ends', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Owned' }]);
    r.clients.getProductImages.mockResolvedValue(listOf(X));
    expect((await figurePage(appQueryClient())).settled).toBe(X);
    expect(r.clients.getProductImages).toHaveBeenCalledWith({ headIds: [headOf(0)] }, expect.objectContaining({ timeoutMs: 10_000, signal: expect.any(AbortSignal) }));
  });

  /** The first document's sync, run as its case view runs it, told to the others; then `onTold` runs, before any of them hears. */
  async function anotherDocumentSyncs(fresh: ReturnType<typeof listOf>, onTold: () => void): Promise<void> {
    await syncOwnedImages([headOf(0)], async () => new Map([[headOf(0), fresh.products[0]?.images ?? []]]), { storage });
    onTold();
    tellOwnedSync(appQueryClient(), 'synced');
  }

  /** Holds the next read of the kept lists (the case view answering again from what the sync kept) until released. */
  function holdNextKeptRead(): { hold: () => void; release: () => void } {
    let on = false;
    let release!: () => void;
    const held = new Promise<void>((res) => (release = res));
    const open = storage.open.bind(storage);
    (storage as unknown as { open: (name: string) => Promise<Cache> }).open = async (name: string) => {
      if (on && name === IMAGE_LISTS_CACHE) {
        on = false;
        await held;
      }
      return open(name);
    };
    return { hold: () => (on = true), release };
  }

  it.each([
    ['out of reach, the figure has no image left: the plate', false, [] as string[], undefined],
    ['online, the sync kept another image: the plate, then that image', true, [B], B],
  ])('the case view, open %s; told of a sync that withheld its image, its figure is drawn as the plate before it answers again', async (_name, online, fresh, after) => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Owned' }]);
    await keptX();
    const docB = appQueryClient();
    setOnline(online);
    r.clients.getProductImages.mockResolvedValue(listOf(X));
    const viewB = renderHook(() => useOwnedImages(), { wrapper: queryWrapper(docB) });
    await waitFor(() => expect(viewB.result.current.get(headOf(0))?.url).toBe(X));
    await waitFor(() => expect(docB.isFetching()).toBe(0));
    const kept = holdNextKeptRead();
    await anotherDocumentSyncs(listOf(...fresh), kept.hold);
    await waitFor(() => expect(docB.isFetching()).toBe(1));
    await waitFor(() => expect(viewB.result.current.get(headOf(0))).toBeUndefined());
    kept.release();
    await waitFor(() => expect(docB.isFetching()).toBe(0));
    await settle();
    expect(viewB.result.current.get(headOf(0))?.url).toBe(after);
  });

  it('the case view, told of a sync that withheld one figure\'s image: every other figure stays drawn while it answers again', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Owned' }, { title: 'Owned too' }]);
    await keptX();
    await rememberImages(headOf(1), [{ url: Y, width: 600, height: 800, role: 'gallery', primary: true }], storage);
    await (await storage.open(OWNED_MEDIA_CACHE)).put(Y, new Response('bytes'));
    const docB = appQueryClient();
    setOnline(false);
    const viewB = renderHook(() => useOwnedImages(), { wrapper: queryWrapper(docB) });
    await waitFor(() => expect(viewB.result.current.get(headOf(1))?.url).toBe(Y));
    expect(viewB.result.current.get(headOf(0))?.url).toBe(X);
    const kept = holdNextKeptRead();
    await syncOwnedImages([headOf(0), headOf(1)], async () => new Map([[headOf(1), listOf(Y).products[0]!.images]]), { storage });
    kept.hold();
    tellOwnedSync(appQueryClient(), 'synced');
    await waitFor(() => expect(viewB.result.current.get(headOf(0))).toBeUndefined());
    expect(viewB.result.current.get(headOf(1))?.url).toBe(Y);
    expect(docB.isFetching()).toBe(1);
    kept.release();
    await waitFor(() => expect(docB.isFetching()).toBe(0));
    expect(viewB.result.current.get(headOf(0))).toBeUndefined();
    expect(viewB.result.current.get(headOf(1))?.url).toBe(Y);
  });

  it('the case view, told of a sync that withheld only a figure\'s mask: names the image without the mask before it answers again', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Owned' }]);
    const M = `${D}/${'a'.repeat(64)}`;
    const M2 = `${D}/${'b'.repeat(64)}`;
    const withMask = (mask: string) =>
      create(GetProductImagesResponseSchema, { products: [{ headId: headOf(0), images: [{ derivativeId: X.slice(-64), role: 'gallery', primary: true, url: X, width: 600, height: 800, mask: { maskId: mask.slice(-64), contentType: 'image/png', url: mask } }] }] });
    const docB = appQueryClient();
    setOnline(false);
    await syncOwnedImages([headOf(0)], async () => new Map([[headOf(0), withMask(M).products[0]!.images]]), { storage });
    const viewB = renderHook(() => useOwnedImages(), { wrapper: queryWrapper(docB) });
    await waitFor(() => expect(viewB.result.current.get(headOf(0))?.maskUrl).toBe(M));
    const kept = holdNextKeptRead();
    await anotherDocumentSyncs(withMask(M2), kept.hold);
    await waitFor(() => expect(viewB.result.current.get(headOf(0))?.maskUrl).toBeUndefined());
    expect(viewB.result.current.get(headOf(0))?.url).toBe(X);
    kept.release();
    await waitFor(() => expect(viewB.result.current.get(headOf(0))?.maskUrl).toBe(M2));
  });
  /** Holds every open of the withheld record after the first `skip` (a sync's own), until released: the drop's lookup. */
  function holdWithheldLookups(skip: number): { reached: () => boolean; release: () => void } {
    let seen = 0;
    let release!: () => void;
    const held = new Promise<void>((res) => (release = res));
    const open = storage.open.bind(storage);
    (storage as unknown as { open: (name: string) => Promise<Cache> }).open = async (name: string) => {
      if (name === WITHHELD_CACHE) {
        seen += 1;
        if (seen > skip) await held;
      }
      return open(name);
    };
    return { reached: () => seen > skip, release };
  }

  it.each([
    ['another document, its answer stale', true, true],
    ['another document, its answer fresh', true, false],
    ['the document that ran the sync, its answer stale', false, true],
    ['the document that ran the sync, its answer fresh', false, false],
  ])('the figure page, opened again in %s while the drop looks up what the sync withheld: answers the plate before the coordinator answers its re-ask', async (_where, other, stale) => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Owned' }]);
    const docA = appQueryClient();
    const docB = other ? appQueryClient() : docA;
    r.clients.getProductImages.mockResolvedValue(listOf(X));
    const first = renderHook(() => useOwnedImages(), { wrapper: queryWrapper(docA) });
    await waitFor(() => expect(first.result.current.get(headOf(0))?.url).toBe(X));
    first.unmount();
    // The figure page answered X, and the user left it: its answer is kept, no view shows it.
    const left = renderHook(() => useProductImage(headOf(0)), { wrapper: queryWrapper(docB) });
    await waitFor(() => expect(left.result.current.data?.url).toBe(X));
    left.unmount();
    if (stale) docB.getQueryCache().findAll({ queryKey: ['local', 'image'] }).forEach((q) => q.setState({ dataUpdatedAt: Date.now() - 11 * 60_000 }));
    let lookup: ReturnType<typeof holdWithheldLookups>;
    let coordinator: ReturnType<typeof laterAnswersWait>;
    let view: { unmount: () => void } | undefined;
    if (other) {
      // The first document's sync withholds X; then this document's drop, told, looks up the record.
      coordinator = laterAnswersWait(r, 1);
      await anotherDocumentSyncs(listOf(), () => (lookup = holdWithheldLookups(0)));
    } else {
      // This document's case view syncs and withholds X; its own open of the record goes, its drop's lookup waits.
      coordinator = laterAnswersWait(r);
      lookup = holdWithheldLookups(1);
      docA.removeQueries({ queryKey: ['local', 'owned-images'] });
      view = renderHook(() => useOwnedImages(), { wrapper: queryWrapper(docA) });
    }
    await waitFor(() => expect(lookup!.reached()).toBe(true));
    // The user opens the figure page again while the lookup runs.
    const page = renderHook(() => useProductImage(headOf(0)), { wrapper: queryWrapper(docB) });
    lookup!.release();
    // Its re-ask is with the coordinator: its answer is already the plate.
    await waitFor(() => expect(docB.isFetching()).toBeGreaterThan(0));
    await waitFor(() => expect(page.result.current.data).toBeNull());
    await new Promise((res) => setTimeout(res, 300));
    expect(page.result.current.data).toBeNull();
    expect(docB.getQueryState(['local', 'image', headOf(0), true])?.fetchStatus).toBe('fetching');
    coordinator.answer();
    await waitFor(() => expect(docB.isFetching()).toBe(0));
    expect(page.result.current.data).toBeNull();
    page.unmount();
    view?.unmount();
  });

  it.each([
    ['another document', true],
    ['the document that ran the sync', false],
  ])('the figure page, open online in %s beside an open page that answers the plate: answers the plate before the coordinator answers its re-ask', async (_where, other) => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Owned' }, { title: 'No image' }]);
    const docA = appQueryClient();
    const docB = other ? appQueryClient() : docA;
    r.clients.getProductImages.mockResolvedValue(listOf(X));
    const first = renderHook(() => useOwnedImages(), { wrapper: queryWrapper(docA) });
    await waitFor(() => expect(first.result.current.get(headOf(0))?.url).toBe(X));
    first.unmount();
    const page = renderHook(() => useProductImage(headOf(0)), { wrapper: queryWrapper(docB) });
    const plate = renderHook(() => useProductImage(headOf(1)), { wrapper: queryWrapper(docB) });
    await waitFor(() => expect(page.result.current.data?.url).toBe(X));
    await waitFor(() => expect(plate.result.current.data).toBeNull());
    const coordinator = laterAnswersWait(r);
    docA.removeQueries({ queryKey: ['local', 'owned-images'] });
    const view = renderHook(() => useOwnedImages(), { wrapper: queryWrapper(docA) });
    await waitFor(() => expect(coordinator.asked()).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(page.result.current.data).toBeNull());
    expect(docB.getQueryState(['local', 'image', headOf(0), true])?.fetchStatus).toBe('fetching');
    coordinator.answer();
    await waitFor(() => expect(docB.isFetching()).toBe(0));
    expect(page.result.current.data).toBeNull();
    expect(plate.result.current.data).toBeNull();
    page.unmount();
    plate.unmount();
    view.unmount();
  });
});

describe('two documents sync at once, and the coordinator withholds the image between their reads of the lists', () => {
  it('the sync that read older lists never undoes the withholding: no current image is refused, the withheld one is never fetched again, and the next sync withholds it', async () => {
    const uninstall = installFakeLocks();
    try {
      let releaseY!: () => void;
      const yGate = new Promise<void>((res) => (releaseY = res));
      storage = fakeCaches(async (req) => {
        if (req.url === Y) await yGate;
        return new Response('img');
      });
      vi.stubGlobal('caches', storage);
      vi.stubGlobal('fetch', storage.fetch);
      const forgotten: string[] = [];
      const open = storage.open.bind(storage);
      (storage as unknown as { open: (name: string) => Promise<Cache> }).open = async (name: string) => {
        const cache = await open(name);
        if (name !== WITHHELD_CACHE) return cache;
        return Object.assign(Object.create(cache) as Cache, {
          delete: async (req: RequestInfo | URL, o?: CacheQueryOptions) => {
            forgotten.push(decodeURIComponent(new URL(req instanceof Request ? req.url : String(req)).pathname));
            return cache.delete(req, o);
          },
        });
      };
      const r = await localRig();
      await seedFigures(r, [{ title: 'Owned' }]);
      await keptX();
      const docA = appQueryClient();
      const docB = appQueryClient();
      // The first read (document B's) was answered before the restriction (X), and comes late; every later one lists Y.
      let releaseB!: () => void;
      const bGate = new Promise<void>((res) => (releaseB = res));
      let call = 0;
      r.clients.getProductImages.mockImplementation(async () => {
        call += 1;
        if (call === 1) {
          await bGate;
          return listOf(X);
        }
        return listOf(Y);
      });
      const viewB = renderHook(() => useOwnedImages(), { wrapper: queryWrapper(docB) });
      await waitFor(() => expect(call).toBe(1));
      const viewA = renderHook(() => useOwnedImages(), { wrapper: queryWrapper(docA) });
      await settle();
      await settle();
      releaseB();
      await waitFor(() => expect(docB.isFetching()).toBe(0));
      await settle();
      releaseY();
      await waitFor(() => expect(docA.isFetching() + docB.isFetching()).toBe(0));
      await settle();
      expect([...(await withheldAmong([Y], storage))]).toEqual([]);
      expect(forgotten.filter((k) => k.includes(X))).toEqual([]);
      expect(storage.added.map((q) => q.url)).not.toContain(X);
      // The next sync of either reads the lists after the restriction: it withholds X, and both answer Y.
      await act(() => docA.refetchQueries({ queryKey: ['local', 'owned-images'] }));
      await waitFor(() => expect(docA.isFetching() + docB.isFetching()).toBe(0));
      await settle();
      expect([...(await withheldAmong([X, Y], storage))]).toEqual([X]);
      expect(viewA.result.current.get(headOf(0))?.url).toBe(Y);
      await waitFor(() => expect(viewB.result.current.get(headOf(0))?.url).toBe(Y));
      expect(held()).not.toContain(X);
      viewA.unmount();
      viewB.unmount();
    } finally {
      uninstall();
    }
  });
});

describe('a sync stopped part way, its case view gone while an image fetch stalls, after it recorded what the coordinator withholds', () => {
  const Z = `${D}/${'d'.repeat(64)}`;
  const row = (url: string) => ({ derivativeId: url.slice(-64), role: 'gallery', primary: true, url, width: 600, height: 800 });
  /** The coordinator's lists for two owned figures: the first's images, the second's. */
  const lists = (first: string[], second: string[]) =>
    create(GetProductImagesResponseSchema, { products: [{ headId: headOf(0), images: first.map(row) }, { headId: headOf(1), images: second.map(row) }] });
  let locks: FakeLocks;
  let uninstall: () => void = () => {};
  /** How a later fetch of Z is answered, where a test sets it: by default at once. */
  let laterZ: (() => Promise<Response>) | undefined;
  beforeEach(() => {
    locks = fakeLocks();
    uninstall = installFakeLocks(locks);
    laterZ = undefined;
    // Z's first fetch stalls: only an abort of its request ends it. Every other fetch answers.
    let zAsked = 0;
    storage = fakeCaches((req) =>
      req.url === Z && (zAsked += 1) === 1
        ? new Promise<Response>((_res, rej) => req.signal.addEventListener('abort', () => rej(req.signal.reason)))
        : req.url === Z && laterZ !== undefined
          ? laterZ()
          : Promise.resolve(new Response('img')),
    );
    vi.stubGlobal('caches', storage);
    vi.stubGlobal('fetch', storage.fetch);
  });
  afterEach(() => uninstall());
  const caseView = (doc: QueryClient) => renderHook(() => useOwnedImages(), { wrapper: queryWrapper(doc) });
  /** The first document's case view syncs, records what the lists withhold, stalls on Z's fetch, and goes away. */
  async function stopsPartWay(docA: QueryClient, before?: () => Promise<void>): Promise<void> {
    const viewA = caseView(docA);
    await waitFor(() => expect(storage.added.map((q) => q.url)).toContain(Z));
    await before?.();
    viewA.unmount();
  }
  const idle = async (...docs: QueryClient[]) => {
    await waitFor(() => expect(docs.reduce((n, d) => n + d.isFetching(), 0)).toBe(0));
    await settle();
    await waitFor(() => expect(docs.reduce((n, d) => n + d.isFetching(), 0)).toBe(0));
  };
  /** A case view and every address it answered for the first figure, render by render (undefined: its plate). */
  const watchedCaseView = (doc: QueryClient) => {
    const named: (string | undefined)[] = [];
    const view = renderHook(
      () => {
        const images = useOwnedImages();
        named.push(images.get(headOf(0))?.url);
        return images;
      },
      { wrapper: queryWrapper(doc) },
    );
    return { view, named };
  };
  /** The second document's case view synced before the takedown, answering X, and went away; its answer is now ten minutes old. */
  async function answeredXLongAgo(r: LocalRig, docB: QueryClient): Promise<void> {
    r.clients.getProductImages.mockResolvedValue(lists([X], []));
    const first = caseView(docB);
    await waitFor(() => expect(first.result.current.get(headOf(0))?.url).toBe(X));
    await idle(docB);
    first.unmount();
    const [answer] = docB.getQueryCache().findAll({ queryKey: ['local', 'owned-images'] });
    docB.setQueryData(answer!.queryKey, answer!.state.data, { updatedAt: Date.now() - 11 * 60_000 });
  }
  /** The first document's case view reads lists that withhold X, records it, and stalls on Z's fetch, holding the lock. */
  async function recordsXAndStalls(docA: QueryClient): Promise<ReturnType<typeof caseView>> {
    const viewA = caseView(docA);
    await waitFor(() => expect(storage.added.map((q) => q.url)).toContain(Z));
    expect([...(await withheldAmong([X], storage))]).toEqual([X]);
    return viewA;
  }

  it.each([[0], [50]])('the case view of another document, waiting on the lock: syncs once it is free, records the withholding and answers the plate (its list read answered in %i ms)', async (latency) => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Owned' }, { title: 'Owned too' }]);
    await keptX();
    let call = 0;
    r.clients.getProductImages.mockImplementation(async () => {
      call += 1;
      // The first read (the first document's) comes before the restriction; every later one withholds X.
      if (call === 1) return lists([X], [Z]);
      await new Promise((res) => setTimeout(res, latency));
      return lists([], [Z]);
    });
    const docA = appQueryClient();
    const docB = appQueryClient();
    let viewB!: ReturnType<typeof caseView>;
    await stopsPartWay(docA, async () => {
      viewB = caseView(docB);
      await waitFor(() => expect(locks.asked).toHaveLength(2));
    });
    await idle(docA, docB);
    expect(call).toBe(2);
    expect([...(await withheldAmong([X], storage))]).toEqual([X]);
    expect(viewB.result.current.has(headOf(0))).toBe(false);
    expect(viewB.result.current.get(headOf(1))?.url).toBe(Z);
    expect(held()).not.toContain(X);
    viewB.unmount();
  });

  it('the figure page open in another document, naming what the stopped sync recorded withheld: answers the plate', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Owned' }, { title: 'Owned too' }]);
    await keptX();
    const docA = appQueryClient();
    const docB = appQueryClient();
    r.clients.getProductImages.mockResolvedValue(lists([X], []));
    const page = renderHook(() => useProductImage(headOf(0)), { wrapper: queryWrapper(docB) });
    await waitFor(() => expect(page.result.current.data?.url).toBe(X));
    r.clients.getProductImages.mockResolvedValue(lists([], [Z]));
    await stopsPartWay(docA, async () => expect([...(await withheldAmong([X], storage))]).toEqual([X]));
    await waitFor(() => expect(page.result.current.data).toBeNull());
    await idle(docA, docB);
    expect(page.result.current.data).toBeNull();
    page.unmount();
  });

  it('the case view open in another document, its own sync done: answers the plate for the figure whose image the stopped sync recorded withheld', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Owned' }, { title: 'Owned too' }]);
    const docA = appQueryClient();
    const docB = appQueryClient();
    r.clients.getProductImages.mockResolvedValue(lists([X], []));
    const viewB = caseView(docB);
    await waitFor(() => expect(viewB.result.current.get(headOf(0))?.url).toBe(X));
    await idle(docB);
    r.clients.getProductImages.mockResolvedValue(lists([], [Z]));
    await stopsPartWay(docA);
    await waitFor(() => expect(viewB.result.current.has(headOf(0))).toBe(false));
    await idle(docA, docB);
    expect(viewB.result.current.has(headOf(0))).toBe(false);
    viewB.unmount();
  });

  it.each([['reads its lists'], ['fetches an image']])(
    'the case view of another document, opened again on its ten-minute-old answer naming the image, inside its own sync that %s: stops naming it once the record is read, while that sync runs on and records the withholding',
    async (where) => {
      const r = await localRig();
      await seedFigures(r, [{ title: 'Owned' }, { title: 'Owned too' }]);
      const docA = appQueryClient();
      const docB = appQueryClient();
      await answeredXLongAgo(r, docB);
      // The takedown: every later read withholds X, the first document's first, then B's. B's sync is
      // held where it is until released.
      let releaseB!: () => void;
      const heldB = new Promise<void>((res) => (releaseB = res));
      let call = 0;
      r.clients.getProductImages.mockImplementation(async () => {
        call += 1;
        if (call === 2 && where === 'reads its lists') await heldB;
        return lists([], [Z]);
      });
      if (where === 'fetches an image') laterZ = () => heldB.then(() => new Response('img'));
      const viewA = await recordsXAndStalls(docA);
      const b = watchedCaseView(docB);
      expect(b.named).toEqual([X]);
      await waitFor(() => expect(locks.asked).toHaveLength(3));
      viewA.unmount();
      await waitFor(() => expect(b.view.result.current.get(headOf(0))?.url).not.toBe(X));
      // B's own sync is still under way, held.
      expect(docB.isFetching()).toBe(1);
      releaseB();
      await idle(docA, docB);
      expect(call).toBe(2);
      expect([...(await withheldAmong([X], storage))]).toEqual([X]);
      expect(b.view.result.current.has(headOf(0))).toBe(false);
      expect(b.view.result.current.get(headOf(1))?.url).toBe(Z);
      expect(b.named.slice(b.named.findIndex((u) => u !== X))).not.toContain(X);
      b.view.unmount();
    },
  );

  it('the case view of another document, its answer stripped of the image inside its own sync, then gone before that sync ends: opened again, never names it, and syncs again, its answer as old as before', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Owned' }, { title: 'Owned too' }]);
    const docA = appQueryClient();
    const docB = appQueryClient();
    await answeredXLongAgo(r, docB);
    let releaseB!: () => void;
    const heldB = new Promise<void>((res) => (releaseB = res));
    let call = 0;
    r.clients.getProductImages.mockImplementation(async () => {
      call += 1;
      if (call === 2) await heldB;
      return lists([], [Z]);
    });
    const viewA = await recordsXAndStalls(docA);
    const b = watchedCaseView(docB);
    await waitFor(() => expect(locks.asked).toHaveLength(3));
    viewA.unmount();
    await waitFor(() => expect(b.view.result.current.get(headOf(0))?.url).not.toBe(X));
    await waitFor(() => expect(call).toBe(2));
    // B's case view goes away while its sync reads the lists: the query is cancelled and reverts.
    b.view.unmount();
    releaseB();
    await idle(docA, docB);
    const again = watchedCaseView(docB);
    await waitFor(() => expect(call).toBe(3));
    await idle(docB);
    expect(again.named).not.toContain(X);
    expect(again.view.result.current.has(headOf(0))).toBe(false);
    expect(again.view.result.current.get(headOf(1))?.url).toBe(Z);
    expect([...(await withheldAmong([X], storage))]).toEqual([X]);
    again.view.unmount();
  });

  it('a sync that completes, by contrast: stops the case view of another document waiting on the lock, which answers from what that sync kept and keeps nothing of its own read (a takedown between their reads lands at its next sync)', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Owned' }, { title: 'Owned too' }]);
    let answer!: () => void;
    const answered = new Promise<void>((res) => (answer = res));
    let call = 0;
    r.clients.getProductImages.mockImplementation(async () => {
      call += 1;
      // The first document's read answers when released: X. The other's, later and slower, lists Y instead.
      if (call === 1) {
        await answered;
        return lists([X], []);
      }
      await new Promise((res) => setTimeout(res, 50));
      return lists([Y], []);
    });
    const docA = appQueryClient();
    const docB = appQueryClient();
    const viewA = caseView(docA);
    await waitFor(() => expect(call).toBe(1));
    const viewB = caseView(docB);
    await waitFor(() => expect(locks.asked).toHaveLength(2));
    answer();
    await waitFor(() => expect(viewB.result.current.get(headOf(0))?.url).toBe(X));
    await idle(docA, docB);
    expect(viewB.result.current.get(headOf(0))?.url).toBe(X);
    expect(storage.added.map((q) => q.url)).not.toContain(Y);
    expect((await recallImages(headOf(0), storage))?.map((i) => i.url)).toEqual([X]);
    viewA.unmount();
    viewB.unmount();
  });
});

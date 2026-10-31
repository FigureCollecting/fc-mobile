// GALLERY-1 (Ross 10-18): every photo of a figure, for the Photos tab: what GetProductImages sends (the derivatives of every
// captured photo, each with its mask when it has one), the kept list offline, and never an address a sync withheld.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/preact';
import { create } from '@bufbuild/protobuf';
import { QueryClient } from '@tanstack/react-query';
import { Code, ConnectError } from '@connectrpc/connect';
import { GetProductImagesResponseSchema } from '@figurecollecting/fc-api-contract';
import { PHOTO_PAGES_MAX, useProductPhotos } from '../useProductPhotos';
import { useOnlineStatus } from '../useOnlineStatus';
import { dropImageAnswers } from '../imageAnswers';
import { localRig, queryWrapper } from '../../local/__tests__/localHarness';
import { seedFigures } from '../../local/__tests__/seedFigures';
import { localSession } from '../../local/session';
import { headOf } from '../../sync/__tests__/engineSupport';
import { fakeCaches, type FakeCaches } from '../../test/fakeCaches';
import { WITHHELD_CACHE, rememberImages, withheldKey } from '../../media/keptImages';
import { fixturePhotos, setFixtureMode } from '../../dev-fixtures/fixtures';

const D = 'https://images.figurecollecting.com/d';
const url = (c: string) => `${D}/${c.repeat(64)}`;
let storage: FakeCaches;

const list = (...rows: { c: string; primary?: boolean; mask?: string; role?: string }[]) =>
  create(GetProductImagesResponseSchema, {
    products: [
      {
        headId: headOf(0),
        images: rows.map((r) => ({
          derivativeId: r.c.repeat(64),
          role: r.role ?? 'gallery',
          primary: r.primary ?? false,
          url: url(r.c),
          width: 600,
          height: 800,
          ...(r.mask === undefined ? {} : { mask: { maskId: r.mask.repeat(64), contentType: 'image/png', url: url(r.mask) } }),
        })),
      },
    ],
  });
const setOnline = (on: boolean) =>
  act(() => {
    window.dispatchEvent(new Event(on ? 'online' : 'offline'));
  });

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
  setFixtureMode(false);
  window.history.pushState({}, '', '/');
});

describe('useProductPhotos', () => {
  it('online: every photo of the figure with its size, its mask and which is the primary, the primary first', async () => {
    const r = await localRig();
    r.clients.getProductImages.mockResolvedValue(list({ c: 'b', mask: 'f' }, { c: 'a', primary: true }, { c: 'c', role: 'box' }));
    await seedFigures(r, [{ title: 'Kurumi' }]);
    const { result } = renderHook(() => useProductPhotos(headOf(0)), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data!.photos.map((p) => [p.url, p.primary, p.maskUrl])).toEqual([
      [url('a'), true, undefined],
      [url('b'), false, url('f')],
      [url('c'), false, undefined],
    ]);
    expect(r.clients.getProductImages).toHaveBeenCalledWith({ headIds: [headOf(0)] }, { signal: expect.any(AbortSignal), timeoutMs: 10_000 });
    expect(result.current.data!.refreshFailed).toBe(false);
  });

  it('keeps only the addresses the public image address carries', async () => {
    const r = await localRig();
    const res = list({ c: 'a', primary: true }, { c: 'b' });
    res.products[0]!.images[1]!.url = 'https://images.store.example/original.jpg';
    r.clients.getProductImages.mockResolvedValue(res);
    await seedFigures(r, [{ title: 'Kurumi' }]);
    const { result } = renderHook(() => useProductPhotos(headOf(0)), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.data?.photos.map((p) => p.url)).toEqual([url('a')]));
  });

  it('offline: the kept list, nothing asked of the coordinator', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Kurumi' }]);
    await rememberImages(
      headOf(0),
      [
        { url: url('b'), width: 600, height: 800, role: 'gallery', primary: false },
        { url: url('a'), width: 600, height: 800, role: 'gallery', primary: true },
      ],
      storage,
    );
    setOnline(false);
    const { result } = renderHook(() => useProductPhotos(headOf(0)), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.data).toEqual({ photos: [expect.objectContaining({ url: url('a') }), expect.objectContaining({ url: url('b') })], refreshFailed: false }));
    expect(r.clients.getProductImages).not.toHaveBeenCalled();
  });

  it('when the coordinator does not answer: the kept list, not an error, and says it could not refresh', async () => {
    const r = await localRig();
    r.clients.getProductImages.mockRejectedValue(new ConnectError('down', Code.Unavailable));
    await seedFigures(r, [{ title: 'Kurumi' }]);
    await rememberImages(headOf(0), [{ url: url('a'), width: 600, height: 800, role: 'gallery', primary: true }], storage);
    const { result } = renderHook(() => useProductPhotos(headOf(0)), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.data?.photos.map((p) => p.url)).toEqual([url('a')]));
    expect(result.current.data?.refreshFailed).toBe(true);
  });

  it('is empty for a figure with no photo', async () => {
    const r = await localRig();
    r.clients.getProductImages.mockResolvedValue(create(GetProductImagesResponseSchema, {}));
    await seedFigures(r, [{ title: 'Kurumi' }]);
    const { result } = renderHook(() => useProductPhotos(headOf(0)), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.data).toEqual({ photos: [], refreshFailed: false }));
  });

  it('never answers a photo, or a mask, a sync withheld', async () => {
    const r = await localRig();
    r.clients.getProductImages.mockResolvedValue(list({ c: 'a', primary: true }, { c: 'b', mask: 'f' }, { c: 'c' }));
    await seedFigures(r, [{ title: 'Kurumi' }]);
    await (await storage.open(WITHHELD_CACHE)).put(withheldKey(url('c')), new Response(null));
    await (await storage.open(WITHHELD_CACHE)).put(withheldKey(url('f')), new Response(null));
    const { result } = renderHook(() => useProductPhotos(headOf(0)), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data!.photos.map((p) => [p.url, p.maskUrl])).toEqual([
      [url('a'), undefined],
      [url('b'), undefined],
    ]);
  });

  it('drops a photo a later sync withholds from an answer already given, as every image answer does', async () => {
    const r = await localRig();
    r.clients.getProductImages.mockResolvedValue(list({ c: 'a', primary: true }, { c: 'b' }));
    await seedFigures(r, [{ title: 'Kurumi' }]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000, gcTime: 30 * 60_000 } } });
    const { result } = renderHook(() => useProductPhotos(headOf(0)), { wrapper: queryWrapper(client) });
    await waitFor(() => expect(result.current.data?.photos).toHaveLength(2));
    r.clients.getProductImages.mockResolvedValue(list({ c: 'a', primary: true }));
    await (await storage.open(WITHHELD_CACHE)).put(withheldKey(url('b')), new Response(null));
    await act(async () => {
      await dropImageAnswers(client);
    });
    await waitFor(() => expect(result.current.data?.photos.map((p) => p.url)).toEqual([url('a')]));
  });
});

// PHOTOS-FIND-1 (Ross 10-31: "only one picture per figure"): the coordinator pages a figure's photos (50 to a page by default)
// and answers them under the head the spine resolves, which is another head once two were merged.
const page = (head: string, cs: string[], nextPageToken = '', primary = '') =>
  create(GetProductImagesResponseSchema, {
    products: [{ headId: head, images: cs.map((c) => ({ derivativeId: c.repeat(64), role: 'gallery', primary: c === primary, url: url(c), width: 600, height: 800 })) }],
    nextPageToken,
  });
const OTHER_HEAD = '99999999-9999-4999-8999-999999999999';

describe('useProductPhotos reads every page and the merged head', () => {
  it('follows the next page token to the last page: every photo, in order, the primary first', async () => {
    const r = await localRig();
    r.clients.getProductImages.mockImplementation(async (req: { pageToken?: string }) =>
      req.pageToken === undefined ? page(headOf(0), ['a'], 'p2', 'a') : req.pageToken === 'p2' ? page(headOf(0), ['b', 'c'], 'p3') : page(headOf(0), ['d', 'e']),
    );
    await seedFigures(r, [{ title: 'Kurumi' }]);
    const { result } = renderHook(() => useProductPhotos(headOf(0)), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data!.photos.map((p) => p.url)).toEqual(['a', 'b', 'c', 'd', 'e'].map(url));
    expect(result.current.data!.refreshFailed).toBe(false);
    expect(r.clients.getProductImages.mock.calls.map((c) => c[0])).toEqual([
      { headIds: [headOf(0)] },
      { headIds: [headOf(0)], pageToken: 'p2' },
      { headIds: [headOf(0)], pageToken: 'p3' },
    ]);
  });

  it('reads at most ten pages: a coordinator that always sends a token answers what those pages held', async () => {
    const r = await localRig();
    let n = 0;
    r.clients.getProductImages.mockImplementation(async () => {
      n += 1;
      return page(headOf(0), [n.toString(16)], `p${n + 1}`, n === 1 ? '1' : '');
    });
    await seedFigures(r, [{ title: 'Kurumi' }]);
    const { result } = renderHook(() => useProductPhotos(headOf(0)), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(r.clients.getProductImages).toHaveBeenCalledTimes(PHOTO_PAGES_MAX);
    expect(PHOTO_PAGES_MAX).toBe(10);
    expect(result.current.data!.photos).toHaveLength(10);
  });

  it('a merged head: one product answered under another head is this figure\'s photos', async () => {
    const r = await localRig();
    r.clients.getProductImages.mockResolvedValue(page(OTHER_HEAD, ['a', 'b'], '', 'a'));
    await seedFigures(r, [{ title: 'Kurumi' }]);
    const { result } = renderHook(() => useProductPhotos(headOf(0)), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.data?.photos.map((p) => p.url)).toEqual([url('a'), url('b')]));
  });

  it('this head\'s own product wins over another one in the answer; two others and not this one are no answer', async () => {
    const r = await localRig();
    const mixed = page(OTHER_HEAD, ['c']);
    mixed.products.push(...page(headOf(0), ['a', 'b'], '', 'a').products);
    r.clients.getProductImages.mockResolvedValue(mixed);
    await seedFigures(r, [{ title: 'Kurumi' }, { title: 'Rem' }]);
    const own = renderHook(() => useProductPhotos(headOf(0)), { wrapper: queryWrapper() });
    await waitFor(() => expect(own.result.current.data?.photos.map((p) => p.url)).toEqual([url('a'), url('b')]));
    const two = page(OTHER_HEAD, ['c']);
    two.products.push(...page(headOf(1), ['d']).products);
    r.clients.getProductImages.mockResolvedValue(two);
    const none = renderHook(() => useProductPhotos(headOf(0)), { wrapper: queryWrapper() });
    await waitFor(() => expect(none.result.current.data).toEqual({ photos: [], refreshFailed: false }));
  });

  it('a page that fails part way: the kept list, and it says it could not refresh', async () => {
    const r = await localRig();
    r.clients.getProductImages.mockImplementation(async (req: { pageToken?: string }) => {
      if (req.pageToken === undefined) return page(headOf(0), ['a', 'b'], 'p2', 'a');
      throw new ConnectError('down', Code.Unavailable);
    });
    await seedFigures(r, [{ title: 'Kurumi' }]);
    await rememberImages(headOf(0), [{ url: url('a'), width: 600, height: 800, role: 'gallery', primary: true }], storage);
    const { result } = renderHook(() => useProductPhotos(headOf(0)), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.data).toEqual({ photos: [expect.objectContaining({ url: url('a') })], refreshFailed: true }));
  });
});

describe('a later sync withholds only a mask', () => {
  it('drops the mask from the answer already given and keeps the photo', async () => {
    const r = await localRig();
    r.clients.getProductImages.mockResolvedValue(list({ c: 'a', primary: true }, { c: 'b', mask: 'f' }));
    await seedFigures(r, [{ title: 'Kurumi' }]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000, gcTime: 30 * 60_000 } } });
    const { result } = renderHook(() => useProductPhotos(headOf(0)), { wrapper: queryWrapper(client) });
    await waitFor(() => expect(result.current.data?.photos[1]?.maskUrl).toBe(url('f')));
    await (await storage.open(WITHHELD_CACHE)).put(withheldKey(url('f')), new Response(null));
    await act(async () => {
      await dropImageAnswers(client);
    });
    await waitFor(() => expect(result.current.data?.photos.map((p) => [p.url, p.maskUrl])).toEqual([[url('a'), undefined], [url('b'), undefined]]));
  });
});

describe('useProductPhotos on the dev fixtures (?fxphotos=1)', () => {
  it('answers the fixtures\' three photos with no session and no coordinator', async () => {
    setFixtureMode(true);
    window.history.pushState({}, '', '/?fxphotos=1');
    const { result } = renderHook(() => useProductPhotos('fx-rem'), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.data).toEqual({ photos: fixturePhotos(), refreshFailed: false }));
  });

  it('answers as many photos as ?fxphotocount= asks (PHOTOS-FIND-1), each its own address', async () => {
    setFixtureMode(true);
    window.history.pushState({}, '', '/?fxphotos=1&fxphotocount=5');
    const { result } = renderHook(() => useProductPhotos('fx-rem'), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.data?.photos).toHaveLength(5));
    expect(new Set(result.current.data!.photos.map((p) => p.url)).size).toBe(5);
    expect(result.current.data!.photos.slice(0, 3)).toEqual(fixturePhotos(3));
  });

  it('is not on for the fixtures without the switch: nothing is asked and nothing answered', async () => {
    setFixtureMode(true);
    const { result } = renderHook(() => useProductPhotos('fx-rem'), { wrapper: queryWrapper() });
    await new Promise((res) => setTimeout(res, 30));
    expect(result.current.data).toBeUndefined();
  });
});

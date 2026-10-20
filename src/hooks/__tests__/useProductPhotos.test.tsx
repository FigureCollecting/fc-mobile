// GALLERY-1 (Ross 10-18): every photo of a figure, for the Photos tab: what GetProductImages sends (the derivatives of every
// captured photo, each with its mask when it has one), the kept list offline, and never an address a sync withheld.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/preact';
import { create } from '@bufbuild/protobuf';
import { QueryClient } from '@tanstack/react-query';
import { Code, ConnectError } from '@connectrpc/connect';
import { GetProductImagesResponseSchema } from '@figurecollecting/fc-api-contract';
import { useProductPhotos } from '../useProductPhotos';
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
    expect(result.current.data!.map((p) => [p.url, p.primary, p.maskUrl])).toEqual([
      [url('a'), true, undefined],
      [url('b'), false, url('f')],
      [url('c'), false, undefined],
    ]);
    expect(r.clients.getProductImages).toHaveBeenCalledWith({ headIds: [headOf(0)] }, { signal: expect.any(AbortSignal), timeoutMs: 10_000 });
  });

  it('keeps only the addresses the public image address carries', async () => {
    const r = await localRig();
    const res = list({ c: 'a', primary: true }, { c: 'b' });
    res.products[0]!.images[1]!.url = 'https://images.store.example/original.jpg';
    r.clients.getProductImages.mockResolvedValue(res);
    await seedFigures(r, [{ title: 'Kurumi' }]);
    const { result } = renderHook(() => useProductPhotos(headOf(0)), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.data?.map((p) => p.url)).toEqual([url('a')]));
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
    await waitFor(() => expect(result.current.data?.map((p) => p.url)).toEqual([url('a'), url('b')]));
    expect(r.clients.getProductImages).not.toHaveBeenCalled();
  });

  it('when the coordinator does not answer: the kept list, not an error', async () => {
    const r = await localRig();
    r.clients.getProductImages.mockRejectedValue(new ConnectError('down', Code.Unavailable));
    await seedFigures(r, [{ title: 'Kurumi' }]);
    await rememberImages(headOf(0), [{ url: url('a'), width: 600, height: 800, role: 'gallery', primary: true }], storage);
    const { result } = renderHook(() => useProductPhotos(headOf(0)), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.data?.map((p) => p.url)).toEqual([url('a')]));
  });

  it('is empty for a figure with no photo', async () => {
    const r = await localRig();
    r.clients.getProductImages.mockResolvedValue(create(GetProductImagesResponseSchema, {}));
    await seedFigures(r, [{ title: 'Kurumi' }]);
    const { result } = renderHook(() => useProductPhotos(headOf(0)), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.data).toEqual([]));
  });

  it('never answers a photo, or a mask, a sync withheld', async () => {
    const r = await localRig();
    r.clients.getProductImages.mockResolvedValue(list({ c: 'a', primary: true }, { c: 'b', mask: 'f' }, { c: 'c' }));
    await seedFigures(r, [{ title: 'Kurumi' }]);
    await (await storage.open(WITHHELD_CACHE)).put(withheldKey(url('c')), new Response(null));
    await (await storage.open(WITHHELD_CACHE)).put(withheldKey(url('f')), new Response(null));
    const { result } = renderHook(() => useProductPhotos(headOf(0)), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data!.map((p) => [p.url, p.maskUrl])).toEqual([
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
    await waitFor(() => expect(result.current.data).toHaveLength(2));
    r.clients.getProductImages.mockResolvedValue(list({ c: 'a', primary: true }));
    await (await storage.open(WITHHELD_CACHE)).put(withheldKey(url('b')), new Response(null));
    await act(async () => {
      await dropImageAnswers(client);
    });
    await waitFor(() => expect(result.current.data?.map((p) => p.url)).toEqual([url('a')]));
  });
});

describe('a later sync withholds only a mask', () => {
  it('drops the mask from the answer already given and keeps the photo', async () => {
    const r = await localRig();
    r.clients.getProductImages.mockResolvedValue(list({ c: 'a', primary: true }, { c: 'b', mask: 'f' }));
    await seedFigures(r, [{ title: 'Kurumi' }]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000, gcTime: 30 * 60_000 } } });
    const { result } = renderHook(() => useProductPhotos(headOf(0)), { wrapper: queryWrapper(client) });
    await waitFor(() => expect(result.current.data?.[1]?.maskUrl).toBe(url('f')));
    await (await storage.open(WITHHELD_CACHE)).put(withheldKey(url('f')), new Response(null));
    await act(async () => {
      await dropImageAnswers(client);
    });
    await waitFor(() => expect(result.current.data?.map((p) => [p.url, p.maskUrl])).toEqual([[url('a'), undefined], [url('b'), undefined]]));
  });
});

describe('useProductPhotos on the dev fixtures (?fxphotos=1)', () => {
  it('answers the fixtures\' three photos with no session and no coordinator', async () => {
    setFixtureMode(true);
    window.history.pushState({}, '', '/?fxphotos=1');
    const { result } = renderHook(() => useProductPhotos('fx-rem'), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.data).toEqual(fixturePhotos()));
  });

  it('is not on for the fixtures without the switch: nothing is asked and nothing answered', async () => {
    setFixtureMode(true);
    const { result } = renderHook(() => useProductPhotos('fx-rem'), { wrapper: queryWrapper() });
    await new Promise((res) => setTimeout(res, 30));
    expect(result.current.data).toBeUndefined();
  });
});

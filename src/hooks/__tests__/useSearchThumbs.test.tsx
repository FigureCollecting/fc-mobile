// SEARCH-THUMB-1 (Ross 10-31: "figure search needs thumbnail (full view but very small) to tell entries apart"): each search
// row's figure as the photo the app shows for it, the user's choice respected. A figure the device keeps images for answers
// with no request; every other figure of the rows is asked in ONE batched GetProductImages read, never one call a row.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/preact';
import { create, type MessageInitShape } from '@bufbuild/protobuf';
import { Code, ConnectError } from '@connectrpc/connect';
import { GetProductImagesResponseSchema, ProductImageSchema } from '@figurecollecting/fc-api-contract';
import { useSearchThumbs } from '../useSearchThumbs';
import { useOnlineStatus } from '../useOnlineStatus';
import { localRig, queryWrapper, type LocalRig } from '../../local/__tests__/localHarness';
import { seedFigures } from '../../local/__tests__/seedFigures';
import { localSession } from '../../local/session';
import { headOf } from '../../sync/__tests__/engineSupport';
import { fakeCaches, type FakeCaches } from '../../test/fakeCaches';
import { OWNED_MEDIA_CACHE, WITHHELD_CACHE, rememberImages, withheldKey } from '../../media/keptImages';
import { __resetPhotoChoices, setPhotoChoice } from '../../media/photoChoice';
import { dropImageAnswers } from '../imageAnswers';
import { makeTestQueryClient } from '../../test/testUtils';

const D = 'https://images.figurecollecting.com/d';
const url = (c: string) => `${D}/${c.repeat(64)}`;
/** Figure i's photo n on the public image address. */
const photo = (i: number, n: number) => `${D}/${(i * 10 + n).toString(16).padStart(64, '0')}`;
const SUB = 'user-a';
let storage: FakeCaches;

type Row = MessageInitShape<typeof ProductImageSchema>;
/** Figure i's list: photo 1 the primary (a mask, a dominant colour), photo 2 and 3 plain. */
const rowsOf = (i: number): Row[] => [
  { role: 'gallery', primary: true, url: photo(i, 1), width: 550, height: 800, dominantColor: '#8a9bb0', mask: { maskId: 'f'.repeat(64), contentType: 'image/png', url: url('f') } },
  { role: 'gallery', primary: false, url: photo(i, 2), width: 600, height: 800 },
  { role: 'gallery', primary: false, url: photo(i, 3), width: 500, height: 700, dominantColor: '#223344' },
];
/** GetProductImages as the coordinator answers it: every asked head's rows, paged by `pageSize` rows. */
function answerLists(r: LocalRig, rows: (i: number) => Row[] = rowsOf) {
  r.clients.getProductImages.mockImplementation(async (req: { headIds: string[]; pageSize?: number; pageToken?: string }) => {
    const all = req.headIds.flatMap((h) => rows(Number.parseInt(h.slice(-6), 16)).map((row) => ({ headId: h, row })));
    const size = req.pageSize || 50;
    const at = req.pageToken ? Number(req.pageToken) : 0;
    const products: { headId: string; images: Row[] }[] = [];
    for (const { headId, row } of all.slice(at, at + size)) {
      const last = products[products.length - 1];
      if (last?.headId === headId) last.images.push(row);
      else products.push({ headId, images: [row] });
    }
    return create(GetProductImagesResponseSchema, { products, nextPageToken: at + size < all.length ? String(at + size) : '' });
  });
}
const setOnline = (on: boolean) =>
  act(() => {
    window.dispatchEvent(new Event(on ? 'online' : 'offline'));
  });
const kept = async (i: number, list: { url: string; primary: boolean }[]) => {
  await rememberImages(headOf(i), list.map((l) => ({ ...l, width: 400, height: 600, role: 'gallery' })), storage);
  const media = await storage.open(OWNED_MEDIA_CACHE);
  for (const l of list) await media.put(l.url, new Response('img'));
};

beforeEach(() => {
  localStorage.clear();
  __resetPhotoChoices();
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

describe('useSearchThumbs', () => {
  it('answers a kept figure with the photo the case draws, and asks nothing', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Kurumi' }]);
    await kept(0, [{ url: photo(0, 1), primary: true }]);
    const { result } = renderHook(() => useSearchThumbs([headOf(0)]), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.get(headOf(0))).toEqual({ url: photo(0, 1), width: 400, height: 600 }));
    expect(r.clients.getProductImages).not.toHaveBeenCalled();
  });

  it('answers the photo the user chose once its bytes are kept, as the case does', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Kurumi' }]);
    await kept(0, [
      { url: photo(0, 1), primary: true },
      { url: photo(0, 3), primary: false },
    ]);
    setPhotoChoice(SUB, headOf(0), photo(0, 3));
    const { result } = renderHook(() => useSearchThumbs([headOf(0)]), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(photo(0, 3)));
    act(() => setPhotoChoice(SUB, headOf(0), null));
    await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(photo(0, 1)));
  });

  it('asks the 20 figures of a search the device keeps nothing for in ONE GetProductImages call, never one a row', async () => {
    const r = await localRig();
    await seedFigures(r, Array.from({ length: 20 }, (_, i) => ({ title: `Kurumi ${i}`, status: 'former' as const })));
    answerLists(r);
    const heads = Array.from({ length: 20 }, (_, i) => headOf(i));
    const { result } = renderHook(() => useSearchThumbs(heads), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.size).toBe(20));
    // 20 figures x 3 rows = 60 rows: one page of 200
    expect(r.clients.getProductImages).toHaveBeenCalledTimes(1);
    expect(r.clients.getProductImages.mock.calls[0]![0]).toEqual({ headIds: heads, pageSize: 200 });
    // the primary, with its dominant colour for the placeholder
    expect(result.current.get(headOf(7))).toEqual({ url: photo(7, 1), width: 550, height: 800, color: '#8a9bb0' });
  });

  it('answers the chosen photo from the list, else the primary, else the first; none for a figure with no photo', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'a', status: 'former' }, { title: 'b', status: 'former' }, { title: 'c', status: 'former' }]);
    answerLists(r, (i) => (i === 0 ? rowsOf(0) : i === 1 ? rowsOf(1).map((row) => ({ ...row, primary: false })) : []));
    setPhotoChoice(SUB, headOf(0), photo(0, 3));
    const { result } = renderHook(() => useSearchThumbs([headOf(0), headOf(1), headOf(2)]), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.size).toBe(2));
    expect(result.current.get(headOf(0))).toEqual({ url: photo(0, 3), width: 500, height: 700, color: '#223344' });
    expect(result.current.get(headOf(1))?.url).toBe(photo(1, 1));
    expect(result.current.has(headOf(2))).toBe(false);
  });

  it('never answers an address the last image sync withheld, nor one off the public image address', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'a', status: 'former' }, { title: 'b', status: 'former' }]);
    answerLists(r, (i) => (i === 0 ? rowsOf(0) : [{ role: 'gallery', primary: true, url: 'https://elsewhere.example/x.jpg', width: 1, height: 1 }]));
    await (await storage.open(WITHHELD_CACHE)).put(withheldKey(photo(0, 1)), new Response(null));
    const { result } = renderHook(() => useSearchThumbs([headOf(0), headOf(1)]), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(photo(0, 2)));
    expect(result.current.has(headOf(1))).toBe(false);
  });

  it('asks only for the figures the device keeps nothing for, and paged lists are followed: one call a page', async () => {
    const r = await localRig();
    await seedFigures(r, Array.from({ length: 21 }, (_, i) => ({ title: `f${i}`, status: i === 0 ? ('owned' as const) : ('former' as const) })));
    await kept(0, [{ url: photo(0, 1), primary: true }]);
    // 20 asked figures x 12 rows = 240 rows: two pages of 200
    answerLists(r, (i) => Array.from({ length: 12 }, (_, n) => ({ role: 'gallery', primary: n === 0, url: photo(i, n + 1), width: 500, height: 700 })));
    const heads = Array.from({ length: 21 }, (_, i) => headOf(i));
    const { result } = renderHook(() => useSearchThumbs(heads), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.size).toBe(21));
    expect(r.clients.getProductImages).toHaveBeenCalledTimes(2);
    expect(r.clients.getProductImages.mock.calls[0]![0].headIds).toEqual(heads.slice(1));
  });

  it('out of reach, answers only what the device kept, and asks nothing', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'kept' }, { title: 'not kept', status: 'former' }]);
    answerLists(r);
    await kept(0, [{ url: photo(0, 1), primary: true }]);
    setOnline(false);
    const { result } = renderHook(() => useSearchThumbs([headOf(0), headOf(1)]), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(photo(0, 1)));
    expect(result.current.has(headOf(1))).toBe(false);
    expect(r.clients.getProductImages).not.toHaveBeenCalled();
  });

  it('when the read fails, answers what the device kept and the rest stand as placeholders', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'kept' }, { title: 'not kept', status: 'former' }]);
    r.clients.getProductImages.mockRejectedValue(new ConnectError('upstream answered 503', Code.Unavailable));
    await kept(0, [{ url: photo(0, 1), primary: true }]);
    const { result } = renderHook(() => useSearchThumbs([headOf(0), headOf(1)]), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(photo(0, 1)));
    expect(result.current.has(headOf(1))).toBe(false);
    expect(r.clients.getProductImages).toHaveBeenCalledTimes(1);
  });

  it('joins the image answers: a sync that withholds a row\'s photo drops it from the row, which then shows the next one', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Kurumi', status: 'former' }]);
    answerLists(r);
    const client = makeTestQueryClient();
    const { result } = renderHook(() => useSearchThumbs([headOf(0)]), { wrapper: queryWrapper(client) });
    await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(photo(0, 1)));
    await (await storage.open(WITHHELD_CACHE)).put(withheldKey(photo(0, 1)), new Response(null));
    await act(() => dropImageAnswers(client));
    await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(photo(0, 2)));
  });

  it('stops its read when the search goes away, its call aborted', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Kurumi', status: 'former' }]);
    let signal: AbortSignal | undefined;
    r.clients.getProductImages.mockImplementation(
      (_req: unknown, options: { signal?: AbortSignal }) =>
        new Promise((_res, rej) => {
          signal = options.signal;
          options.signal?.addEventListener('abort', () => rej(options.signal!.reason), { once: true });
        }),
    );
    const view = renderHook(() => useSearchThumbs([headOf(0)]), { wrapper: queryWrapper() });
    await waitFor(() => expect(signal).toBeDefined());
    view.unmount();
    await waitFor(() => expect(signal!.aborted).toBe(true));
  });

  it('answers nothing and asks nothing for no rows, or signed out', async () => {
    const r = await localRig();
    const { result } = renderHook(() => useSearchThumbs([]), { wrapper: queryWrapper() });
    expect(result.current.size).toBe(0);
    localSession.value = undefined;
    const out = renderHook(() => useSearchThumbs([headOf(0)]), { wrapper: queryWrapper() });
    expect(out.result.current.size).toBe(0);
    expect(r.clients.getProductImages).not.toHaveBeenCalled();
  });
});

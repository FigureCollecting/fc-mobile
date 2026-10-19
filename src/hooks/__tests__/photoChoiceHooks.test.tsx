// GALLERY-1 (Ross 10-18): the photo a user chose for a figure is the one the case (useCollectionImages) and Info and the
// figure page (useProductImage) show, online and off, and a change of choice reaches them while they are open.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/preact';
import { create } from '@bufbuild/protobuf';
import { GetProductImagesResponseSchema } from '@figurecollecting/fc-api-contract';
import { useCollectionImages } from '../useCollectionImages';
import { useProductImage } from '../useProductImage';
import { useOnlineStatus } from '../useOnlineStatus';
import { localRig, queryWrapper } from '../../local/__tests__/localHarness';
import { seedFigures } from '../../local/__tests__/seedFigures';
import { localSession } from '../../local/session';
import { headOf } from '../../sync/__tests__/engineSupport';
import { fakeCaches, type FakeCaches } from '../../test/fakeCaches';
import { OWNED_MEDIA_CACHE, rememberImages } from '../../media/keptImages';
import { __resetPhotoChoices, setPhotoChoice } from '../../media/photoChoice';

const D = 'https://images.figurecollecting.com/d';
const url = (c: string) => `${D}/${c.repeat(64)}`;
const SUB = 'user-a';
let storage: FakeCaches;

/** The coordinator's list for the figure: `a` the primary, `b` and `c` other photos of it, `b` with a mask. */
const photos = () =>
  create(GetProductImagesResponseSchema, {
    products: [
      {
        headId: headOf(0),
        images: [
          { derivativeId: 'a'.repeat(64), role: 'gallery', primary: true, url: url('a'), width: 600, height: 800 },
          { derivativeId: 'b'.repeat(64), role: 'gallery', primary: false, url: url('b'), width: 550, height: 800, mask: { maskId: 'f'.repeat(64), contentType: 'image/png', url: url('f') } },
          { derivativeId: 'c'.repeat(64), role: 'gallery', primary: false, url: url('c'), width: 500, height: 700 },
        ],
      },
    ],
  });
const setOnline = (on: boolean) =>
  act(() => {
    window.dispatchEvent(new Event(on ? 'online' : 'offline'));
  });
const settle = () => new Promise((res) => setTimeout(res, 50));

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

describe('the case (useCollectionImages)', () => {
  it('shows the primary until a photo is chosen, then the chosen one with its mask, fetched by the sync', async () => {
    const r = await localRig();
    r.clients.getProductImages.mockResolvedValue(photos());
    await seedFigures(r, [{ title: 'Kurumi' }]);
    const { result } = renderHook(() => useCollectionImages(), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(url('a')));
    act(() => setPhotoChoice(SUB, headOf(0), url('b')));
    await waitFor(() => expect(result.current.get(headOf(0))).toMatchObject({ url: url('b'), maskUrl: url('f') }), { timeout: 3000 });
    // the primary stays on the device beside it (the figure shows it till the chosen one is here)
    expect([...(storage.stores.get(OWNED_MEDIA_CACHE)?.keys() ?? [])].sort()).toEqual([url('a'), url('b'), url('f')].sort());
  });

  it('goes back to the primary when the choice is forgotten', async () => {
    const r = await localRig();
    r.clients.getProductImages.mockResolvedValue(photos());
    await seedFigures(r, [{ title: 'Kurumi' }]);
    setPhotoChoice(SUB, headOf(0), url('c'));
    const { result } = renderHook(() => useCollectionImages(), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(url('c')), { timeout: 3000 });
    act(() => setPhotoChoice(SUB, headOf(0), null));
    await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(url('a')), { timeout: 3000 });
  });

  it('shows the chosen photo offline too, from what the device kept', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Kurumi' }]);
    await rememberImages(
      headOf(0),
      [
        { url: url('a'), width: 600, height: 800, role: 'gallery', primary: true },
        { url: url('b'), width: 550, height: 800, role: 'gallery', primary: false },
      ],
      storage,
    );
    const media = await storage.open(OWNED_MEDIA_CACHE);
    await media.put(url('a'), new Response('a'));
    await media.put(url('b'), new Response('b'));
    setPhotoChoice(SUB, headOf(0), url('b'));
    setOnline(false);
    const { result } = renderHook(() => useCollectionImages(), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(url('b')));
  });

  it('is not moved by another user\'s choice on the same device', async () => {
    const r = await localRig();
    r.clients.getProductImages.mockResolvedValue(photos());
    await seedFigures(r, [{ title: 'Kurumi' }]);
    setPhotoChoice('someone-else', headOf(0), url('c'));
    const { result } = renderHook(() => useCollectionImages(), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(url('a')));
    await settle();
    expect(result.current.get(headOf(0))?.url).toBe(url('a'));
  });
});

describe('Info and the figure page (useProductImage)', () => {
  it('answers the primary, the chosen photo once chosen, and the primary again when the choice is forgotten', async () => {
    const r = await localRig();
    r.clients.getProductImages.mockResolvedValue(photos());
    await seedFigures(r, [{ title: 'Kurumi' }]);
    const { result } = renderHook(() => useProductImage(headOf(0)), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.data?.url).toBe(url('a')));
    act(() => setPhotoChoice(SUB, headOf(0), url('c')));
    await waitFor(() => expect(result.current.data).toMatchObject({ url: url('c'), width: 500, height: 700 }));
    act(() => setPhotoChoice(SUB, headOf(0), null));
    await waitFor(() => expect(result.current.data?.url).toBe(url('a')));
  });

  it('answers the primary when the chosen photo is no longer in the list (taken down)', async () => {
    const r = await localRig();
    r.clients.getProductImages.mockResolvedValue(photos());
    await seedFigures(r, [{ title: 'Kurumi' }]);
    setPhotoChoice(SUB, headOf(0), url('d'));
    const { result } = renderHook(() => useProductImage(headOf(0)), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.data?.url).toBe(url('a')));
  });

  it('answers the chosen photo offline from what the device kept', async () => {
    const r = await localRig();
    await seedFigures(r, [{ title: 'Kurumi' }]);
    await rememberImages(
      headOf(0),
      [
        { url: url('a'), width: 600, height: 800, role: 'gallery', primary: true },
        { url: url('c'), width: 500, height: 700, role: 'gallery', primary: false },
      ],
      storage,
    );
    const media = await storage.open(OWNED_MEDIA_CACHE);
    await media.put(url('a'), new Response('a'));
    await media.put(url('c'), new Response('c'));
    setPhotoChoice(SUB, headOf(0), url('c'));
    setOnline(false);
    const { result } = renderHook(() => useProductImage(headOf(0)), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.data?.url).toBe(url('c')));
  });
});

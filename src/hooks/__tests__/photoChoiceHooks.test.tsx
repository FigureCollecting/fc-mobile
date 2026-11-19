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
import { BROWSED_MEDIA_CACHE, OWNED_MEDIA_CACHE, rememberImages } from '../../media/keptImages';
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

  it('PICK-SLOW: shows a pick the Photos sheet loaded at once, from its bytes on the device, never waiting on an older choice still coming', async () => {
    const r = await localRig();
    const image = (c: string, primary: boolean) => ({ derivativeId: c.repeat(64), role: 'gallery', primary, url: url(c), width: 600, height: 800 });
    r.clients.getProductImages.mockResolvedValue(
      create(GetProductImagesResponseSchema, {
        products: [
          { headId: headOf(0), images: [image('a', true), image('c', false)] },
          { headId: headOf(1), images: [image('d', true), image('e', false)] },
        ],
      }),
    );
    await seedFigures(r, [{ title: 'Kurumi' }, { title: 'Rem' }]);
    // the device kept both lists and both primaries; the older choice, figure 0's photo c, is not here and its fetch
    // never answers (a slow link), till it is aborted
    storage = fakeCaches(
      (request) =>
        new Promise<Response>((res, rej) => {
          if (request.url !== url('c')) res(new Response('img'));
          else request.signal.addEventListener('abort', () => rej(request.signal.reason));
        }),
    );
    vi.stubGlobal('caches', storage);
    vi.stubGlobal('fetch', storage.fetch);
    for (const [i, primary, other] of [[0, 'a', 'c'], [1, 'd', 'e']] as const) {
      await rememberImages(headOf(i), [{ url: url(primary), width: 600, height: 800, role: 'gallery', primary: true }, { url: url(other), width: 600, height: 800, role: 'gallery', primary: false }], storage);
      await (await storage.open(OWNED_MEDIA_CACHE)).put(url(primary), new Response(primary));
    }
    setPhotoChoice(SUB, headOf(0), url('c'));
    const seen: (string | undefined)[] = [];
    const { result } = renderHook(
      () => {
        const answer = useCollectionImages();
        seen.push(answer.get(headOf(1))?.url);
        return answer;
      },
      { wrapper: queryWrapper() },
    );
    await waitFor(() => expect(result.current.get(headOf(1))?.url).toBe(url('d')));
    // the sheet showed photo e: the worker kept its bytes in the browsed cache
    await (await storage.open(BROWSED_MEDIA_CACHE)).put(url('e'), new Response('e', { status: 200 }));
    storage.added.length = 0;
    seen.length = 0;
    act(() => setPhotoChoice(SUB, headOf(1), url('e')));
    // well inside KEPT_SHOWN_EVERY_MS (1 s): at once, not on the next drawing of a sync's progress
    await waitFor(() => expect(result.current.get(headOf(1))?.url).toBe(url('e')), { timeout: 600 });
    // the figure stood as its primary until then, never as nothing (its plate)
    expect(seen.filter((u) => u !== url('d') && u !== url('e'))).toEqual([]);
    expect(storage.added.map((q) => q.url)).not.toContain(url('e'));
  });

  it('PICK-SLOW: draws the newest pick, then each older choice kept after it, and the sync\'s answer keeps them all', async () => {
    const r = await localRig();
    const image = (c: string, primary: boolean) => ({ derivativeId: c.repeat(64), role: 'gallery', primary, url: url(c), width: 600, height: 800 });
    r.clients.getProductImages.mockResolvedValue(
      create(GetProductImagesResponseSchema, {
        products: [
          { headId: headOf(0), images: [image('a', true), image('c', false)] },
          { headId: headOf(1), images: [image('d', true), image('e', false)] },
        ],
      }),
    );
    await seedFigures(r, [{ title: 'Kurumi' }, { title: 'Rem' }]);
    const { result } = renderHook(() => useCollectionImages(), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.get(headOf(1))?.url).toBe(url('d')));
    // two choices at once (another tab's record): neither photo is on the device
    localStorage.setItem(`fc-photo-choices-v1:${SUB}`, JSON.stringify({ [headOf(0)]: url('c'), [headOf(1)]: url('e') }));
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: `fc-photo-choices-v1:${SUB}` }));
    });
    await waitFor(() => expect(result.current.get(headOf(1))?.url).toBe(url('e')), { timeout: 600 });
    await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(url('c')), { timeout: 3000 });
    // the newest first: figure 1's photo was fetched before figure 0's
    const asked = storage.added.map((q) => q.url);
    expect(asked.indexOf(url('e'))).toBeLessThan(asked.indexOf(url('c')));
  });

  it('PICK-SLOW: draws nothing new for a pick whose photo did not come and whose figure has nothing kept', async () => {
    const r = await localRig();
    r.clients.getProductImages.mockResolvedValue(photos());
    await seedFigures(r, [{ title: 'Kurumi' }]);
    // the device kept the list but no bytes: photo b fails, its mask f comes
    storage = fakeCaches(async (request) => (request.url === url('b') || request.url === url('a') ? new Response('down', { status: 503 }) : new Response('img')));
    vi.stubGlobal('caches', storage);
    vi.stubGlobal('fetch', storage.fetch);
    await rememberImages(
      headOf(0),
      [
        { url: url('a'), width: 600, height: 800, role: 'gallery', primary: true },
        { url: url('b'), width: 550, height: 800, role: 'gallery', primary: false, maskUrl: url('f') },
      ],
      storage,
    );
    const { result } = renderHook(() => useCollectionImages(), { wrapper: queryWrapper() });
    await waitFor(() => expect(storage.added.map((q) => q.url)).toContain(url('a')));
    act(() => setPhotoChoice(SUB, headOf(0), url('b')));
    await waitFor(() => expect(storage.added.map((q) => q.url)).toContain(url('f')));
    await settle();
    expect(result.current.get(headOf(0))).toBeUndefined();
  });

  it('PICK-SLOW: a pick whose keeping fails outright leaves the figure as it was, and the sync still answers', async () => {
    const r = await localRig();
    r.clients.getProductImages.mockResolvedValue(photos());
    await seedFigures(r, [{ title: 'Kurumi' }]);
    const { result } = renderHook(() => useCollectionImages(), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(url('a')));
    // the browsed cache cannot be opened: keepChosenPhotos throws before it keeps anything
    const open = storage.open.bind(storage);
    vi.spyOn(storage, 'open').mockImplementation(async (name: string) => {
      if (name === BROWSED_MEDIA_CACHE) throw new DOMException('refused', 'SecurityError');
      return open(name);
    });
    act(() => setPhotoChoice(SUB, headOf(0), url('c')));
    await settle();
    expect(result.current.get(headOf(0))?.url).toBe(url('a'));
  });

  it('PICK-SLOW: a new collection is never drawn with the last one\'s pictures while its own answer comes', async () => {
    const r = await localRig();
    r.clients.getProductImages.mockResolvedValue(photos());
    await seedFigures(r, [{ title: 'Kurumi' }]);
    const { result } = renderHook(() => useCollectionImages(), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(url('a')));
    // the device's caches hold still: the new collection's answer cannot come yet
    let release: () => void = () => {};
    const held = new Promise<void>((res) => (release = res));
    const read = storage.open.bind(storage);
    vi.spyOn(storage, 'open').mockImplementation(async (name: string) => {
      await held;
      return read(name);
    });
    // another figure comes into the collection: other kept figures, a new key
    await seedFigures(r, [{ title: 'Kurumi' }, { title: 'Rem' }]);
    await waitFor(() => expect(result.current.size).toBe(0));
    release();
    await waitFor(() => expect(result.current.get(headOf(0))?.url).toBe(url('a')));
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

// ADDR-1: the image, mask and grounding of OWNED figures, kept for the offline case view: one list
// record per figure (the fresh GetProductImages list replaces it, so an image or mask a restriction
// now withholds is dropped), the primary image and its mask in a bounded cache the service worker
// reads first, both evicted with the collection.
import { create } from '@bufbuild/protobuf';
import { ProductImageSchema, type ProductImage } from '@figurecollecting/fc-api-contract';
import { describe, expect, it, vi } from 'vitest';
import { fakeCaches } from '../../test/fakeCaches';
import {
  IMAGE_LISTS_CACHE,
  OWNED_MEDIA_CACHE,
  fetchImageLists,
  primaryImage,
  recallImages,
  rememberImages,
  syncOwnedImages,
  toCachedImages,
  type CachedImage,
} from '../ownedImages';

const D = 'https://images.figurecollecting.com/d';
const hex = (c: string) => c.repeat(64);
const url = (c: string) => `${D}/${hex(c)}`;
const img = (c: string, over: Partial<ProductImage> = {}): ProductImage =>
  create(ProductImageSchema, { derivativeId: hex(c), role: 'gallery', primary: false, url: url(c), width: 600, height: 800, ...over });

describe('toCachedImages', () => {
  it('keeps the address, size, role and primary of every image on the public address, with its mask and grounding', () => {
    const list = toCachedImages([
      img('a', { primary: true, mask: { maskId: hex('m'), contentType: 'image/png', url: url('m') }, bottomMarginFrac: 0.08, contactBand: { centerXFrac: 0.5, widthFrac: 0.3 } }),
      img('b', { role: 'other' }),
    ]);
    expect(list).toEqual([
      { url: url('a'), width: 600, height: 800, role: 'gallery', primary: true, maskUrl: url('m'), bottomMarginFrac: 0.08, contactBand: { centerXFrac: 0.5, widthFrac: 0.3 } },
      { url: url('b'), width: 600, height: 800, role: 'other', primary: false },
    ]);
  });

  it('keeps a measured 0 as a measurement', () => {
    expect(toCachedImages([img('a', { bottomMarginFrac: 0 })])[0]).toMatchObject({ bottomMarginFrac: 0 });
  });

  it('drops an image, or a mask, that is not on the public address', () => {
    const list = toCachedImages([
      img('a', { url: 'https://images.store.example/a.jpg' }),
      img('b', { url: '' }),
      img('c', { mask: { maskId: hex('m'), contentType: '', url: 'https://elsewhere.example/m.png' } }),
    ]);
    expect(list).toEqual([{ url: url('c'), width: 600, height: 800, role: 'gallery', primary: false }]);
  });
});

describe('primaryImage', () => {
  it('is the image marked primary, else the first, else none', () => {
    const a = { url: url('a'), width: 1, height: 1, role: 'gallery', primary: false } satisfies CachedImage;
    const b = { ...a, url: url('b'), primary: true };
    expect(primaryImage([a, b])).toBe(b);
    expect(primaryImage([a])).toBe(a);
    expect(primaryImage([])).toBeUndefined();
  });
});

describe('rememberImages / recallImages', () => {
  it('keeps a figure\'s list and gives it back, and forgets it when the fresh list is empty', async () => {
    const storage = fakeCaches();
    const list = toCachedImages([img('a', { primary: true })]);
    await rememberImages('h1', list, storage);
    expect(await recallImages('h1', storage)).toEqual(list);
    expect(await recallImages('h2', storage)).toBeUndefined();
    await rememberImages('h1', [], storage);
    expect(await recallImages('h1', storage)).toBeUndefined();
  });

  it('reads nothing from a record it cannot parse', async () => {
    const storage = fakeCaches();
    await (await storage.open(IMAGE_LISTS_CACHE)).put(new Request('http://localhost:3000/__fc/image-list/h1'), new Response('{'));
    expect(await recallImages('h1', storage)).toBeUndefined();
  });

  it('answers undefined where the browser has no Cache API', async () => {
    expect(await recallImages('h1', undefined)).toBeUndefined();
    await expect(rememberImages('h1', [], undefined)).resolves.toBeUndefined();
  });
});

describe('syncOwnedImages', () => {
  const lists = (m: Record<string, ProductImage[]>) => vi.fn(async (heads: readonly string[]) => new Map(heads.filter((h) => h in m).map((h) => [h, m[h]!])));
  const owned = async (storage: ReturnType<typeof fakeCaches>) => [...(storage.stores.get(OWNED_MEDIA_CACHE)?.keys() ?? [])].sort();

  it('caches the primary image and its mask of every owned figure, by a CORS request without credentials', async () => {
    const storage = fakeCaches();
    const fetchLists = lists({
      h1: [img('a', { primary: true, mask: { maskId: hex('m'), contentType: 'image/png', url: url('m') } }), img('b')],
      h2: [img('c')],
    });
    const result = await syncOwnedImages(['h1', 'h2', 'h3'], fetchLists, { storage });
    expect(fetchLists).toHaveBeenCalledWith(['h1', 'h2', 'h3']);
    expect(await owned(storage)).toEqual([url('a'), url('c'), url('m')].sort());
    expect(storage.added.every((r) => r.mode === 'cors' && r.credentials === 'omit')).toBe(true);
    expect(await recallImages('h1', storage)).toHaveLength(2);
    expect(await recallImages('h3', storage)).toBeUndefined();
    expect(result).toEqual({ figures: 2, images: 3, added: 3, evicted: 0, failed: 0 });
  });

  it('evicts with the collection: a figure no longer owned loses its list and its images', async () => {
    const storage = fakeCaches();
    await syncOwnedImages(['h1', 'h2'], lists({ h1: [img('a', { primary: true })], h2: [img('c', { primary: true })] }), { storage });
    const result = await syncOwnedImages(['h1'], lists({ h1: [img('a', { primary: true })] }), { storage });
    expect(await owned(storage)).toEqual([url('a')]);
    expect(await recallImages('h2', storage)).toBeUndefined();
    expect(result).toMatchObject({ added: 0, evicted: 1 });
  });

  it('replaces a figure\'s list with the fresh one: a withdrawn image or mask is dropped from the cache', async () => {
    const storage = fakeCaches();
    await syncOwnedImages(['h1'], lists({ h1: [img('a', { primary: true, mask: { maskId: hex('m'), contentType: '', url: url('m') } })] }), { storage });
    await syncOwnedImages(['h1'], lists({ h1: [img('b', { primary: true })] }), { storage });
    expect(await owned(storage)).toEqual([url('b')]);
    expect((await recallImages('h1', storage))?.map((i) => i.url)).toEqual([url('b')]);
  });

  it('keeps at most `max` figures, the first in the order given', async () => {
    const storage = fakeCaches();
    const fetchLists = lists({ h1: [img('a')], h2: [img('b')], h3: [img('c')] });
    await syncOwnedImages(['h1', 'h1', 'h2', 'h3'], fetchLists, { storage, max: 2 });
    expect(fetchLists).toHaveBeenCalledWith(['h1', 'h2']);
    expect(await owned(storage)).toEqual([url('a'), url('b')]);
  });

  it('counts an image it could not fetch and carries on', async () => {
    const storage = fakeCaches(async (r) => (r.url === url('a') ? new Response('', { status: 404 }) : new Response('img')));
    const result = await syncOwnedImages(['h1', 'h2'], lists({ h1: [img('a')], h2: [img('b')] }), { storage, concurrency: 1 });
    expect(await owned(storage)).toEqual([url('b')]);
    expect(result).toMatchObject({ added: 1, failed: 1 });
  });

  it('does nothing where the browser has no Cache API', async () => {
    const fetchLists = lists({});
    expect(await syncOwnedImages(['h1'], fetchLists, { storage: undefined })).toEqual({ figures: 0, images: 0, added: 0, evicted: 0, failed: 0 });
    expect(fetchLists).not.toHaveBeenCalled();
  });
});

describe('fetchImageLists', () => {
  it('asks in batches of 200 heads, follows every page, and joins a figure\'s rows across pages', async () => {
    const heads = Array.from({ length: 201 }, (_, i) => `h${i}`);
    const getProductImages = vi.fn(async (req: { headIds: string[]; pageToken?: string }) => {
      if (req.headIds.length === 1) return { products: [{ headId: 'h200', images: [img('z')] }], nextPageToken: '' };
      if (!req.pageToken) return { products: [{ headId: 'h0', images: [img('a', { primary: true })] }], nextPageToken: 't2' };
      return { products: [{ headId: 'h0', images: [img('b')] }, { headId: 'h1', images: [img('c')] }], nextPageToken: '' };
    });
    const got = await fetchImageLists({ getProductImages } as never, heads);
    expect(getProductImages.mock.calls.map(([r]) => [r.headIds.length, r.pageToken ?? ''])).toEqual([[200, ''], [200, 't2'], [1, '']]);
    expect([...got.keys()]).toEqual(['h0', 'h1', 'h200']);
    expect(got.get('h0')?.map((i) => i.derivativeId)).toEqual([hex('a'), hex('b')]);
  });

  it('refuses to follow a spine that never ends', async () => {
    const getProductImages = vi.fn(async () => ({ products: [], nextPageToken: 'again' }));
    await expect(fetchImageLists({ getProductImages } as never, ['h1'])).rejects.toThrow(/pages/);
  });
});

// ADDR-1: the image, mask and grounding of OWNED figures, kept for the offline case view: one list
// record per figure (the fresh GetProductImages list replaces it, so an image or mask a restriction
// now withholds is dropped), the primary image and its mask in a bounded cache the service worker
// reads first, both evicted with the collection.
import { create, type MessageInitShape } from '@bufbuild/protobuf';
import { ProductImageSchema, type ProductImage } from '@figurecollecting/fc-api-contract';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeCaches } from '../../test/fakeCaches';
import { fakeLocks, installFakeLocks } from '../../test/fakeLocks';
import {
  BROWSED_MEDIA_CACHE,
  IMAGE_LISTS_CACHE,
  MAX_IMAGE_PAGES,
  MAX_OWNED_FIGURES,
  MAX_WITHHELD,
  OWNED_MEDIA_CACHE,
  OWNED_SYNC_WAIT_MS,
  WITHHELD_CACHE,
  fetchImageLists,
  keptImage,
  keptImages,
  primaryImage,
  recallImages,
  rememberImages,
  syncOwnedImages,
  toCachedImages,
  withheldAmong,
  type CachedImage,
} from '../ownedImages';

const D = 'https://images.figurecollecting.com/d';
const hex = (c: string) => c.repeat(64);
const url = (c: string) => `${D}/${hex(c)}`;
const img = (c: string, over: MessageInitShape<typeof ProductImageSchema> = {}): ProductImage =>
  create(ProductImageSchema, { derivativeId: hex(c), role: 'gallery', primary: false, url: url(c), width: 600, height: 800, ...over });

describe('toCachedImages', () => {
  it('keeps the address, size, role and primary of every image on the public address, with its mask and grounding', () => {
    const list = toCachedImages([
      img('a', { primary: true, mask: { maskId: hex('f'), contentType: 'image/png', url: url('f') }, bottomMarginFrac: 0.08, contactBand: { centerXFrac: 0.5, widthFrac: 0.3 } }),
      img('b', { role: 'other' }),
    ]);
    expect(list).toEqual([
      { url: url('a'), width: 600, height: 800, role: 'gallery', primary: true, maskUrl: url('f'), bottomMarginFrac: 0.08, contactBand: { centerXFrac: 0.5, widthFrac: 0.3 } },
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
      img('c', { mask: { maskId: hex('f'), contentType: '', url: 'https://elsewhere.example/m.png' } }),
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

  it('caches the primary image and its mask of every owned figure, by a CORS request without credentials or the HTTP cache', async () => {
    const storage = fakeCaches();
    const fetchLists = lists({
      h1: [img('a', { primary: true, mask: { maskId: hex('f'), contentType: 'image/png', url: url('f') } }), img('b')],
      h2: [img('c')],
    });
    const result = await syncOwnedImages(['h1', 'h2', 'h3'], fetchLists, { storage });
    expect(fetchLists).toHaveBeenCalledWith(['h1', 'h2', 'h3']);
    expect(await owned(storage)).toEqual([url('a'), url('c'), url('f')].sort());
    expect(storage.added.every((r) => r.mode === 'cors' && r.credentials === 'omit')).toBe(true);
    // The origin answers immutable: a byte the HTTP cache kept would outlive its eviction from the owned cache.
    expect(storage.added.map((r) => r.cache)).toEqual(['no-store', 'no-store', 'no-store']);
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
    await syncOwnedImages(['h1'], lists({ h1: [img('a', { primary: true, mask: { maskId: hex('f'), contentType: '', url: url('f') } })] }), { storage });
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
  it('asks in batches of 200 heads for pages of 200 rows, follows every page, and joins a figure\'s rows across pages', async () => {
    const heads = Array.from({ length: 201 }, (_, i) => `h${i}`);
    const getProductImages = vi.fn(async (req: { headIds: string[]; pageSize?: number; pageToken?: string }) => {
      if (req.headIds.length === 1) return { products: [{ headId: 'h200', images: [img('z')] }], nextPageToken: '' };
      if (!req.pageToken) return { products: [{ headId: 'h0', images: [img('a', { primary: true })] }], nextPageToken: 't2' };
      return { products: [{ headId: 'h0', images: [img('b')] }, { headId: 'h1', images: [img('c')] }], nextPageToken: '' };
    });
    const got = await fetchImageLists({ getProductImages } as never, heads);
    expect(getProductImages.mock.calls.map(([r]) => [r.headIds.length, r.pageSize, r.pageToken ?? ''])).toEqual([[200, 200, ''], [200, 200, 't2'], [1, 200, '']]);
    expect([...got.keys()]).toEqual(['h0', 'h1', 'h200']);
    expect(got.get('h0')?.map((i) => i.derivativeId)).toEqual([hex('a'), hex('b')]);
  });

  it('fits 200 figures of 50 images each in the page budget, as the coordinator pages them (0 = 50 rows, at most 200)', async () => {
    const heads = Array.from({ length: 200 }, (_, i) => `h${i}`);
    const getProductImages = vi.fn(async (req: { headIds: string[]; pageSize?: number; pageToken?: string }) => {
      const rows = req.headIds.flatMap((h) => Array.from({ length: 50 }, (_, n) => ({ h, n })));
      const size = Math.min(req.pageSize || 50, 200);
      const start = Number(req.pageToken ?? '0');
      const products: { headId: string; images: ProductImage[] }[] = [];
      for (const r of rows.slice(start, start + size)) {
        const last = products[products.length - 1];
        const image = img(r.n.toString(16), { primary: r.n === 0 });
        if (last?.headId === r.h) last.images.push(image);
        else products.push({ headId: r.h, images: [image] });
      }
      return { products, nextPageToken: start + size < rows.length ? String(start + size) : '' };
    });
    const got = await fetchImageLists({ getProductImages } as never, heads);
    expect(getProductImages).toHaveBeenCalledTimes(MAX_IMAGE_PAGES);
    expect(got.size).toBe(200);
    expect(got.get('h199')).toHaveLength(50);
  });

  it('refuses to follow a spine that never ends, having read exactly MAX_IMAGE_PAGES pages', async () => {
    const getProductImages = vi.fn(async () => ({ products: [], nextPageToken: 'again' }));
    await expect(fetchImageLists({ getProductImages } as never, ['h1'])).rejects.toThrow(/pages/);
    expect(getProductImages).toHaveBeenCalledTimes(MAX_IMAGE_PAGES);
  });

  it('fails a sync whose lists run past the page budget before it touches any cache: nothing is evicted, what was kept stays', async () => {
    const storage = fakeCaches();
    await syncOwnedImages(['h1'], async () => new Map([['h1', [img('a', { primary: true })]]]), { storage });
    const calls = countCalls(storage);
    const getProductImages = vi.fn(async () => ({ products: [], nextPageToken: 'again' }));
    await expect(syncOwnedImages(['h1'], (heads) => fetchImageLists({ getProductImages } as never, heads), { storage })).rejects.toThrow(/pages/);
    expect(calls).toEqual([]);
    expect([...(storage.stores.get(OWNED_MEDIA_CACHE)?.keys() ?? [])]).toEqual([url('a')]);
    expect((await keptImage('h1', storage))?.url).toBe(url('a'));
  });

  it('reads a spine that ends on the last page it may read', async () => {
    let read = 0;
    const getProductImages = vi.fn(async () => {
      read += 1;
      const last = read === MAX_IMAGE_PAGES;
      return { products: last ? [{ headId: 'h1', images: [img('a')] }] : [], nextPageToken: last ? '' : `p${read}` };
    });
    const got = await fetchImageLists({ getProductImages } as never, ['h1']);
    expect(getProductImages).toHaveBeenCalledTimes(MAX_IMAGE_PAGES);
    expect(got.get('h1')?.map((i) => i.derivativeId)).toEqual([hex('a')]);
  });
});

describe('syncOwnedImages and the worker\'s browsed cache (src/sw.ts)', () => {
  const lists = (m: Record<string, ProductImage[]>) => async (heads: readonly string[]) => new Map(heads.filter((h) => h in m).map((h) => [h, m[h]!]));
  // What an <img crossorigin> leaves there: its request carried an Origin and the origin answers
  // Vary: Origin, so a bare url finds it only with { ignoreVary: true } (as in Chromium).
  const shown = async (storage: ReturnType<typeof fakeCaches>, u: string) =>
    (await storage.open(BROWSED_MEDIA_CACHE)).put(new Request(u, { headers: { Origin: 'http://localhost:3000' } }), new Response('img', { headers: { Vary: 'Origin' } }));
  const browsed = (storage: ReturnType<typeof fakeCaches>) => [...(storage.stores.get(BROWSED_MEDIA_CACHE)?.keys() ?? [])].sort();
  const mask = (c: string) => ({ maskId: hex(c), contentType: 'image/png', url: url(c) });

  it('is the cache the worker keeps every other image in', () => {
    expect(BROWSED_MEDIA_CACHE).toBe('fc-derivatives-v2');
  });

  it('deletes there too an image or a mask a fresh list no longer carries, so a withheld one leaves the device', async () => {
    const storage = fakeCaches();
    await syncOwnedImages(['h1'], lists({ h1: [img('a', { primary: true, mask: mask('f') }), img('b')] }), { storage });
    await shown(storage, url('a'));
    await shown(storage, url('f'));
    await shown(storage, url('b'));
    await syncOwnedImages(['h1'], lists({ h1: [img('c', { primary: true })] }), { storage });
    expect(browsed(storage)).toEqual([]);
    expect([...(storage.stores.get(OWNED_MEDIA_CACHE)?.keys() ?? [])]).toEqual([url('c')]);
  });

  it('deletes there too the images of a figure that left the collection', async () => {
    const storage = fakeCaches();
    await syncOwnedImages(['h1', 'h2'], lists({ h1: [img('a', { primary: true })], h2: [img('c', { primary: true })] }), { storage });
    await shown(storage, url('c'));
    await syncOwnedImages(['h1'], lists({ h1: [img('a', { primary: true })] }), { storage });
    expect(browsed(storage)).toEqual([]);
  });

  it('leaves there what a fresh list still carries, primary or not, and every image no kept list ever named', async () => {
    const storage = fakeCaches();
    await syncOwnedImages(['h1', 'h2'], lists({ h1: [img('a', { primary: true }), img('b'), img('c')], h2: [img('d', { primary: true }), img('e')] }), { storage });
    for (const c of ['b', 'c', 'e', 'z']) await shown(storage, url(c));
    await syncOwnedImages(['h1', 'h2'], lists({ h1: [img('b', { primary: true })], h2: [img('d', { primary: true }), img('e')] }), { storage });
    expect(browsed(storage)).toEqual([url('b'), url('e'), url('z')].sort());
  });

  it('deletes there a withheld mask whose bytes were never kept', async () => {
    const storage = fakeCaches(async (r) => (r.url === url('f') ? new Response('', { status: 404 }) : new Response('img')));
    await syncOwnedImages(['h1'], lists({ h1: [img('a', { primary: true, mask: mask('f') })] }), { storage });
    expect([...(storage.stores.get(OWNED_MEDIA_CACHE)?.keys() ?? [])]).toEqual([url('a')]);
    await shown(storage, url('f'));
    await syncOwnedImages(['h1'], lists({ h1: [img('a', { primary: true })] }), { storage });
    expect(browsed(storage)).toEqual([]);
  });

  it('deletes there an address only the owned cache still held (the residue of an interrupted sync)', async () => {
    const storage = fakeCaches();
    await (await storage.open(OWNED_MEDIA_CACHE)).put(url('r'), new Response('img'));
    await shown(storage, url('r'));
    const result = await syncOwnedImages(['h1'], lists({ h1: [img('a', { primary: true })] }), { storage });
    expect(browsed(storage)).toEqual([]);
    expect(result).toMatchObject({ evicted: 1, added: 1 });
  });
});

describe('keptImage', () => {
  it('answers a figure\'s primary only while its bytes are on the device', async () => {
    const storage = fakeCaches();
    await rememberImages('h1', toCachedImages([img('b'), img('a', { primary: true })]), storage);
    expect(await keptImage('h1', storage)).toBeUndefined();
    // Stored as Cache.add stores it, with the origin's Vary: Origin.
    await (await storage.open(OWNED_MEDIA_CACHE)).put(new Request(url('a'), { headers: { Origin: 'http://localhost:3000' } }), new Response('img', { headers: { Vary: 'Origin' } }));
    expect((await keptImage('h1', storage))?.url).toBe(url('a'));
  });

  it('answers nothing without a kept list, or without the Cache API', async () => {
    const storage = fakeCaches();
    expect(await keptImage('h1', storage)).toBeUndefined();
    expect(await keptImage('h1', undefined)).toBeUndefined();
  });
});

/** Every Cache Storage call the code makes: an open, or a method on an opened cache. */
function countCalls(storage: ReturnType<typeof fakeCaches>): string[] {
  const calls: string[] = [];
  const open = storage.open.bind(storage);
  (storage as unknown as { open: (name: string) => Promise<Cache> }).open = async (name: string) => {
    calls.push(`open ${name}`);
    const cache = await open(name);
    return new Proxy(cache, {
      get: (target, prop) => {
        const value = (target as unknown as Record<string | symbol, unknown>)[prop];
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          calls.push(`${String(prop)} ${name}`);
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
  };
  return calls;
}

describe('a large collection with no image yet costs a few cache calls, not a few per figure', () => {
  const heads = Array.from({ length: 1200 }, (_, i) => `h${i}`);

  it('syncOwnedImages: nothing per figure when every list is empty and nothing was kept', async () => {
    const storage = fakeCaches();
    const calls = countCalls(storage);
    const result = await syncOwnedImages(heads, async () => new Map(), { storage });
    expect(result).toEqual({ figures: 0, images: 0, added: 0, evicted: 0, failed: 0 });
    expect(calls.length).toBeLessThanOrEqual(6);
  });

  it('keptImages: nothing per figure when no list was kept, and only the kept ones otherwise', async () => {
    const storage = fakeCaches();
    await rememberImages('h7', toCachedImages([img('a', { primary: true })]), storage);
    await (await storage.open(OWNED_MEDIA_CACHE)).put(url('a'), new Response('img'));
    const calls = countCalls(storage);
    const got = await keptImages(heads, storage);
    expect([...got.keys()]).toEqual(['h7']);
    expect(got.get('h7')?.url).toBe(url('a'));
    expect(calls.length).toBeLessThanOrEqual(6);
    const empty = fakeCaches();
    const emptyCalls = countCalls(empty);
    expect((await keptImages(heads, empty)).size).toBe(0);
    expect(emptyCalls).toEqual([`open ${IMAGE_LISTS_CACHE}`, `keys ${IMAGE_LISTS_CACHE}`]);
  });
});

describe('cancelling a sync', () => {
  it('fetchImageLists hands the signal to each call and asks nothing more once it is aborted', async () => {
    const abort = new AbortController();
    const getProductImages = vi.fn(async (_req: { headIds: string[] }, _opts?: { signal?: AbortSignal }) => {
      abort.abort();
      return { products: [], nextPageToken: '' };
    });
    const heads = Array.from({ length: 401 }, (_, i) => `h${i}`);
    await expect(fetchImageLists({ getProductImages } as never, heads, abort.signal)).rejects.toThrow();
    expect(getProductImages).toHaveBeenCalledTimes(1);
    expect(getProductImages.mock.calls[0]![1]).toEqual({ signal: abort.signal });
  });

  it('syncOwnedImages fetches no more bytes once its signal is aborted', async () => {
    const abort = new AbortController();
    const storage = fakeCaches(async () => {
      abort.abort();
      return new Response('img');
    });
    const lists = async () => new Map([['h1', [img('a', { primary: true })]], ['h2', [img('b', { primary: true })]], ['h3', [img('c', { primary: true })]]]);
    const result = await syncOwnedImages(['h1', 'h2', 'h3'], lists, { storage, concurrency: 1, signal: abort.signal });
    expect(storage.added).toHaveLength(1);
    expect(result).toMatchObject({ added: 1, failed: 0 });
  });

  it('syncOwnedImages touches no cache once its signal is aborted', async () => {
    const storage = fakeCaches();
    const calls = countCalls(storage);
    const abort = new AbortController();
    const fetchLists = async () => {
      abort.abort();
      return new Map([['h1', [img('a', { primary: true })]]]);
    };
    await expect(syncOwnedImages(['h1'], fetchLists, { storage, signal: abort.signal })).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});

describe('the addresses a sync withheld (the tombstone the worker reads)', () => {
  const lists = (m: Record<string, ProductImage[]>) => async (heads: readonly string[]) => new Map(heads.filter((h) => h in m).map((h) => [h, m[h]!]));
  const mask = (c: string) => ({ maskId: hex(c), contentType: 'image/png', url: url(c) });
  const shown = async (storage: ReturnType<typeof fakeCaches>, u: string) =>
    (await storage.open(BROWSED_MEDIA_CACHE)).put(new Request(u, { headers: { Origin: 'http://localhost:3000' } }), new Response('img', { headers: { Vary: 'Origin' } }));
  const browsed = (storage: ReturnType<typeof fakeCaches>) => [...(storage.stores.get(BROWSED_MEDIA_CACHE)?.keys() ?? [])].sort();
  const withheld = async (storage: ReturnType<typeof fakeCaches>, cs: string[]) => [...(await withheldAmong(cs.map(url), storage))].sort();

  it('remembers each image and mask a fresh list withholds from a figure still owned, not those of a figure that left the collection', async () => {
    const storage = fakeCaches();
    await syncOwnedImages(['h1', 'h2'], lists({ h1: [img('a', { primary: true, mask: mask('f') }), img('b')], h2: [img('c', { primary: true })] }), { storage });
    expect(await withheld(storage, ['a', 'b', 'c', 'f'])).toEqual([]);
    await syncOwnedImages(['h1'], lists({ h1: [img('d', { primary: true })] }), { storage });
    expect(await withheld(storage, ['a', 'b', 'c', 'd', 'f'])).toEqual([url('a'), url('b'), url('f')].sort());
  });

  it('remembers every kept address of a figure still owned whose fresh list is empty, or that the coordinator left out', async () => {
    const storage = fakeCaches();
    await syncOwnedImages(['h1', 'h2'], lists({ h1: [img('a', { primary: true })], h2: [img('c', { primary: true })] }), { storage });
    await syncOwnedImages(['h1', 'h2'], lists({ h1: [] }), { storage });
    expect(await withheld(storage, ['a', 'c'])).toEqual([url('a'), url('c')].sort());
  });

  it('never remembers an address no kept list named (the residue of an interrupted sync), nor one another fresh list still carries', async () => {
    const storage = fakeCaches();
    await (await storage.open(OWNED_MEDIA_CACHE)).put(url('r'), new Response('img'));
    await syncOwnedImages(['h1', 'h2'], lists({ h1: [img('a', { primary: true })], h2: [img('b', { primary: true })] }), { storage });
    await syncOwnedImages(['h1', 'h2'], lists({ h1: [img('c', { primary: true })], h2: [img('b', { primary: true }), img('a')] }), { storage });
    expect(await withheld(storage, ['a', 'b', 'c', 'r'])).toEqual([]);
  });

  it('reads a kept list it cannot parse as naming nothing: nothing withheld, and the fresh list replaces it', async () => {
    const storage = fakeCaches();
    await (await storage.open(IMAGE_LISTS_CACHE)).put(new Request('http://localhost:3000/__fc/image-list/h1'), new Response('{'));
    await syncOwnedImages(['h1'], lists({ h1: [img('a', { primary: true })] }), { storage });
    expect([...(storage.stores.get(WITHHELD_CACHE)?.keys() ?? [])]).toEqual([]);
    expect((await recallImages('h1', storage))?.map((i) => i.url)).toEqual([url('a')]);
  });

  it('keeps no image there: each record is on the app\'s origin, not the image address, and has no body', async () => {
    const storage = fakeCaches();
    await syncOwnedImages(['h1'], lists({ h1: [img('a', { primary: true })] }), { storage });
    await syncOwnedImages(['h1'], lists({ h1: [] }), { storage });
    const records = [...(storage.stores.get(WITHHELD_CACHE)?.entries() ?? [])];
    expect(records.map(([k]) => new URL(k).origin)).toEqual(['http://localhost:3000']);
    expect(await Promise.all(records.map(([, r]) => r.clone().text()))).toEqual(['']);
    for (const name of [OWNED_MEDIA_CACHE, BROWSED_MEDIA_CACHE, IMAGE_LISTS_CACHE, WITHHELD_CACHE]) expect([...(storage.stores.get(name)?.keys() ?? [])]).not.toContain(url('a'));
  });

  it('remembers an address before it evicts its bytes or its shown copy, so the worker never serves it in between', async () => {
    const storage = fakeCaches();
    await syncOwnedImages(['h1'], lists({ h1: [img('a', { primary: true })] }), { storage });
    await shown(storage, url('a'));
    const atDelete: string[] = [];
    const open = storage.open.bind(storage);
    (storage as unknown as { open: (name: string) => Promise<Cache> }).open = async (name: string) => {
      const cache = await open(name);
      if (name !== OWNED_MEDIA_CACHE && name !== BROWSED_MEDIA_CACHE) return cache;
      const del = cache.delete.bind(cache);
      return Object.assign(Object.create(cache) as Cache, {
        delete: async (r: RequestInfo | URL, o?: CacheQueryOptions) => {
          const u = typeof r === 'string' ? r : r instanceof URL ? r.href : r.url;
          atDelete.push(`${name} ${[...(await withheldAmong([u], storage))].length === 1 ? 'remembered' : 'NOT remembered'}`);
          return del(r, o);
        },
      });
    };
    await syncOwnedImages(['h1'], lists({ h1: [img('b', { primary: true })] }), { storage });
    expect(atDelete).toEqual([`${OWNED_MEDIA_CACHE} remembered`, `${BROWSED_MEDIA_CACHE} remembered`]);
  });

  /** The kept lists' cache, whose `n`th write (a put or a delete) of the next sync runs `atWrite` first. */
  const onListWrite = (storage: ReturnType<typeof fakeCaches>, atWrite: (n: number) => Promise<void>) => {
    const open = storage.open.bind(storage);
    let writes = 0;
    (storage as unknown as { open: (name: string) => Promise<Cache> }).open = async (name: string) => {
      const cache = await open(name);
      if (name !== IMAGE_LISTS_CACHE) return cache;
      const write =
        <A extends unknown[]>(f: (...a: A) => Promise<unknown>) =>
        async (...a: A) => {
          writes += 1;
          await atWrite(writes);
          return f(...a);
        };
      return Object.assign(Object.create(cache) as Cache, { put: write(cache.put.bind(cache)), delete: write(cache.delete.bind(cache)) });
    };
    return () => {
      (storage as unknown as { open: unknown }).open = open;
    };
  };

  it('remembers what it withholds before it replaces or deletes any kept list', async () => {
    const storage = fakeCaches();
    await syncOwnedImages(['h1', 'h2', 'h3'], lists({ h1: [img('a', { primary: true })], h2: [img('c', { primary: true })], h3: [img('e', { primary: true })] }), { storage });
    const atWrite: string[][] = [];
    onListWrite(storage, async () => {
      atWrite.push(await withheld(storage, ['a', 'c']));
    });
    await syncOwnedImages(['h1', 'h2'], lists({ h1: [img('b', { primary: true })], h2: [img('d', { primary: true })] }), { storage });
    // Two lists replaced, the record of the figure that left deleted: each write found both recorded.
    expect(atWrite).toEqual(Array(3).fill([url('a'), url('c')].sort()));
  });

  it('a sync that stops after replacing a kept list (a quota error, the page killed) leaves what it withheld recorded, so a later sync deletes a refill', async () => {
    const storage = fakeCaches();
    await syncOwnedImages(['h1', 'h2'], lists({ h1: [img('a', { primary: true })], h2: [img('c', { primary: true })] }), { storage });
    const restore = onListWrite(storage, async (n) => {
      if (n === 2) throw new DOMException('quota', 'QuotaExceededError');
    });
    const fresh = lists({ h1: [img('b', { primary: true })], h2: [img('d', { primary: true })] });
    await expect(syncOwnedImages(['h1', 'h2'], fresh, { storage })).rejects.toThrow('quota');
    restore();
    expect(await withheld(storage, ['a', 'c'])).toEqual([url('a'), url('c')].sort());
    // The next sync completes on the same lists; then an <img> elsewhere refills the browsed cache with one.
    await syncOwnedImages(['h1', 'h2'], fresh, { storage });
    expect(await withheld(storage, ['a', 'c'])).toEqual([url('a'), url('c')].sort());
    await shown(storage, url('a'));
    await syncOwnedImages(['h1', 'h2'], fresh, { storage });
    expect(browsed(storage)).toEqual([]);
    expect([...(storage.stores.get(OWNED_MEDIA_CACHE)?.keys() ?? [])].sort()).toEqual([url('b'), url('d')].sort());
  });

  it('replaces no kept list and evicts nothing when it cannot record what it withholds', async () => {
    const storage = fakeCaches();
    await syncOwnedImages(['h1'], lists({ h1: [img('a', { primary: true })] }), { storage });
    const open = storage.open.bind(storage);
    (storage as unknown as { open: (name: string) => Promise<Cache> }).open = async (name: string) => {
      const cache = await open(name);
      if (name !== WITHHELD_CACHE) return cache;
      return Object.assign(Object.create(cache) as Cache, {
        put: async () => {
          throw new DOMException('quota', 'QuotaExceededError');
        },
      });
    };
    const fresh = lists({ h1: [img('b', { primary: true })] });
    await expect(syncOwnedImages(['h1'], fresh, { storage })).rejects.toThrow('quota');
    expect((await recallImages('h1', storage))?.map((i) => i.url)).toEqual([url('a')]);
    expect([...(storage.stores.get(OWNED_MEDIA_CACHE)?.keys() ?? [])]).toEqual([url('a')]);
    (storage as unknown as { open: unknown }).open = open;
    await syncOwnedImages(['h1'], fresh, { storage });
    expect(await withheld(storage, ['a'])).toEqual([url('a')]);
    expect([...(storage.stores.get(OWNED_MEDIA_CACHE)?.keys() ?? [])]).toEqual([url('b')]);
  });

  it('deletes a refill of a withheld address from the browsed cache at every later sync', async () => {
    const storage = fakeCaches();
    await syncOwnedImages(['h1'], lists({ h1: [img('a', { primary: true, mask: mask('f') })] }), { storage });
    await syncOwnedImages(['h1'], lists({ h1: [img('b', { primary: true })] }), { storage });
    // Refilled after the sync that withheld them (a document still drawing them, an older worker).
    await shown(storage, url('a'));
    await shown(storage, url('f'));
    await shown(storage, url('z'));
    const result = await syncOwnedImages(['h1'], lists({ h1: [img('b', { primary: true })] }), { storage });
    expect(browsed(storage)).toEqual([url('z')]);
    expect(result).toMatchObject({ added: 0, evicted: 0 });
    await shown(storage, url('a'));
    await syncOwnedImages(['h1'], lists({ h1: [img('b', { primary: true })] }), { storage });
    expect(browsed(storage)).toEqual([url('z')]);
  });

  it('forgets an address once a fresh list carries it again, before it fetches it, and leaves its shown copy', async () => {
    const atFetch: string[][] = [];
    const storage: ReturnType<typeof fakeCaches> = fakeCaches(async (r) => {
      atFetch.push([...(await withheldAmong([r.url], storage))]);
      return new Response('img');
    });
    await syncOwnedImages(['h1'], lists({ h1: [img('a', { primary: true }), img('c')] }), { storage });
    await syncOwnedImages(['h1'], lists({ h1: [img('b', { primary: true })] }), { storage });
    expect(await withheld(storage, ['a', 'c'])).toEqual([url('a'), url('c')].sort());
    atFetch.length = 0;
    await syncOwnedImages(['h1'], lists({ h1: [img('a', { primary: true })] }), { storage });
    expect(atFetch).toEqual([[]]);
    expect(await withheld(storage, ['a', 'b', 'c'])).toEqual([url('b'), url('c')].sort());
    expect([...(storage.stores.get(OWNED_MEDIA_CACHE)?.keys() ?? [])]).toEqual([url('a')]);
    // Shown again once a fresh list carries it: a later sync leaves that copy where it is.
    await shown(storage, url('c'));
    await syncOwnedImages(['h1'], lists({ h1: [img('a', { primary: true }), img('c')] }), { storage });
    await shown(storage, url('a'));
    await syncOwnedImages(['h1'], lists({ h1: [img('a', { primary: true }), img('c')] }), { storage });
    expect(browsed(storage)).toEqual([url('a'), url('c')].sort());
  });

  it(`keeps at most MAX_WITHHELD (${MAX_WITHHELD}) addresses, the oldest dropped first`, async () => {
    const storage = fakeCaches();
    const many = Array.from({ length: MAX_WITHHELD + 1 }, (_, i) => `${D}/${i.toString(16).padStart(64, '0')}`);
    const asImg = (u: string, primary = false) => create(ProductImageSchema, { derivativeId: u.slice(-64), role: 'gallery', primary, url: u, width: 1, height: 1 });
    await syncOwnedImages(['h1'], lists({ h1: many.map((u, i) => asImg(u, i === 0)) }), { storage });
    await syncOwnedImages(['h1'], lists({ h1: [img('a', { primary: true })] }), { storage });
    expect(storage.stores.get(WITHHELD_CACHE)?.size).toBe(MAX_WITHHELD);
    expect([...(await withheldAmong([many[0]!, many[1]!, many.at(-1)!], storage))]).toEqual([many[1], many.at(-1)]);
    await syncOwnedImages(['h1'], lists({ h1: [img('b', { primary: true })] }), { storage });
    expect(storage.stores.get(WITHHELD_CACHE)?.size).toBe(MAX_WITHHELD);
    expect([...(await withheldAmong([many[1]!, many[2]!, url('a')], storage))]).toEqual([many[2], url('a')]);
  });

  it('remembers at most 3000 addresses: two for each of the 1500 figures kept, an image and its mask', () => {
    expect(MAX_OWNED_FIGURES).toBe(1500);
    expect(MAX_WITHHELD).toBe(3000);
  });

  it('reads the remembered addresses in a few cache calls, not one per address', async () => {
    const storage = fakeCaches();
    const many = Array.from({ length: 500 }, (_, i) => `${D}/${i.toString(16).padStart(64, '0')}`);
    await syncOwnedImages(['h1'], lists({ h1: many.map((u, i) => create(ProductImageSchema, { derivativeId: u.slice(-64), role: 'gallery', primary: i === 0, url: u, width: 1, height: 1 })) }), { storage });
    await syncOwnedImages(['h1'], lists({ h1: [] }), { storage });
    const calls = countCalls(storage);
    await syncOwnedImages(['h1'], lists({ h1: [] }), { storage });
    expect(calls.length).toBeLessThanOrEqual(8);
  });

  it('answers nothing withheld where the browser has no Cache API', async () => {
    expect((await withheldAmong([url('a')], undefined)).size).toBe(0);
  });
});

describe('syncs in different documents of the app (a tab, the installed window): one at a time, under a Web Lock', () => {
  const lists = (m: Record<string, ProductImage[]>) => async (heads: readonly string[]) => new Map(heads.filter((h) => h in m).map((h) => [h, m[h]!]));
  const owned = (storage: ReturnType<typeof fakeCaches>) => [...(storage.stores.get(OWNED_MEDIA_CACHE)?.keys() ?? [])].sort();
  const withheld = async (storage: ReturnType<typeof fakeCaches>, cs: string[]) => [...(await withheldAmong(cs.map(url), storage))].sort();
  const settle = () => new Promise((res) => setTimeout(res, 20));
  let uninstall: () => void = () => {};
  afterEach(() => uninstall());

  /** Another document's CacheStorage over the same caches (one origin), its next open held until released. */
  function otherDocument(storage: ReturnType<typeof fakeCaches>): { storage: CacheStorage; holdNextOpen: () => void; release: () => void } {
    let hold = false;
    let release!: () => void;
    const held = new Promise<void>((res) => (release = res));
    const open = async (name: string) => {
      if (hold) {
        hold = false;
        await held;
      }
      return storage.open(name);
    };
    return { storage: Object.assign(Object.create(storage) as CacheStorage, { open }), holdNextOpen: () => (hold = true), release };
  }

  it('asks for the one lock every document syncs under, by a name that holds across builds', async () => {
    const locks = fakeLocks();
    uninstall = installFakeLocks(locks);
    await syncOwnedImages(['h1'], lists({ h1: [img('a', { primary: true })] }), { storage: fakeCaches() });
    expect(locks.asked).toEqual(['fc-owned-sync']);
  });

  it('a sync that read the lists later writes later: one that read older lists, finishing last, never undoes what the later one withheld', async () => {
    uninstall = installFakeLocks();
    const storage = fakeCaches();
    await syncOwnedImages(['h1'], lists({ h1: [img('a', { primary: true })] }), { storage });
    const events: string[] = [];
    // Document B reads the lists before a display restriction withholds a (it still lists a); its read
    // answers late, and its first cache call after it is slow too.
    const b = otherDocument(storage);
    let answerB!: () => void;
    const bAnswers = new Promise<void>((res) => (answerB = res));
    const syncB = syncOwnedImages(['h1'], async () => {
      events.push('B reads');
      await bAnswers;
      b.holdNextOpen();
      return new Map([['h1', [img('a', { primary: true })]]]);
    }, { storage: b.storage }).then(() => events.push('B done'));
    await settle();
    // Document A reads them after: a is withheld, c is the figure's image now.
    const syncA = syncOwnedImages(['h1'], async () => {
      events.push('A reads');
      return new Map([['h1', [img('c', { primary: true })]]]);
    }, { storage }).then(() => events.push('A done'));
    await settle();
    answerB();
    await settle();
    b.release();
    await Promise.all([syncA, syncB]);
    expect(events).toEqual(['B reads', 'B done', 'A reads', 'A done']);
    expect(await withheld(storage, ['a', 'c'])).toEqual([url('a')]);
    expect((await recallImages('h1', storage))?.map((i) => i.url)).toEqual([url('c')]);
    expect(owned(storage)).toEqual([url('c')]);
    expect(storage.added.filter((r) => r.url === url('a'))).toHaveLength(1);
  });

  it('a sync waiting for another document\'s stops when its signal aborts: it asks nothing and touches no cache', async () => {
    uninstall = installFakeLocks();
    const storage = fakeCaches();
    let answerB!: () => void;
    const syncB = syncOwnedImages(['h1'], async () => {
      await new Promise<void>((res) => (answerB = res));
      return new Map([['h1', [img('a', { primary: true })]]]);
    }, { storage });
    await settle();
    const abort = new AbortController();
    const fetchA = vi.fn(lists({ h1: [img('c', { primary: true })] }));
    const syncA = syncOwnedImages(['h1'], fetchA, { storage, signal: abort.signal });
    const outcome = syncA.then(() => 'synced', (e: unknown) => (e as { name?: string }).name);
    await settle();
    abort.abort();
    // It stops while the other document's sync still holds the lock.
    expect(await Promise.race([outcome, settle().then(() => 'still waiting')])).toBe('AbortError');
    answerB();
    await syncB;
    expect(fetchA).not.toHaveBeenCalled();
    expect(owned(storage)).toEqual([url('a')]);
  });

  it('a sync waits at most 10 s (OWNED_SYNC_WAIT_MS) for another document\'s: then it fails, having asked nothing and touched no cache', async () => {
    expect(OWNED_SYNC_WAIT_MS).toBe(10_000);
    uninstall = installFakeLocks();
    const storage = fakeCaches();
    let answerB!: () => void;
    const syncB = syncOwnedImages(['h1'], async () => {
      await new Promise<void>((res) => (answerB = res));
      return new Map([['h1', [img('a', { primary: true })]]]);
    }, { storage });
    await settle();
    const fetchA = vi.fn(lists({ h1: [img('c', { primary: true })] }));
    const outcome = syncOwnedImages(['h1'], fetchA, { storage, lockWaitMs: 30 }).then(() => 'synced', (e: unknown) => (e as { name?: string }).name);
    expect(await Promise.race([outcome, new Promise((res) => setTimeout(() => res('still waiting'), 300))])).toBe('TimeoutError');
    answerB();
    await syncB;
    expect(fetchA).not.toHaveBeenCalled();
    expect(owned(storage)).toEqual([url('a')]);
  });

  it('where the browser has no Web Locks, a sync runs at once: syncs in two documents are not serialised', async () => {
    expect((navigator as unknown as { locks?: unknown }).locks).toBeUndefined();
    const storage = fakeCaches();
    const events: string[] = [];
    let answerB!: () => void;
    const syncB = syncOwnedImages(['h1'], async () => {
      await new Promise<void>((res) => (answerB = res));
      return new Map();
    }, { storage }).then(() => events.push('B done'));
    await settle();
    await syncOwnedImages(['h1'], lists({ h1: [img('c', { primary: true })] }), { storage }).then(() => events.push('A done'));
    answerB();
    await syncB;
    expect(events).toEqual(['A done', 'B done']);
  });
});

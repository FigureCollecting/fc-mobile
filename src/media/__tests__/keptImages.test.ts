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
  MAX_KEPT_FIGURES,
  MAX_WITHHELD,
  OWNED_MEDIA_CACHE,
  KEPT_SYNC_STEP_MS,
  KEPT_SYNC_WAIT_MS,
  WITHHELD_CACHE,
  fetchImageLists,
  keepChosenPhotos,
  keptImage,
  keptImages,
  primaryImage,
  recallImages,
  shownImage,
  rememberImages,
  syncKeptImages,
  toCachedImages,
  withheldAmong,
  withheldKey,
  type CachedImage,
} from '../keptImages';

const D = 'https://images.figurecollecting.com/d';
const hex = (c: string) => c.repeat(64);
const url = (c: string) => `${D}/${hex(c)}`;
const img = (c: string, over: MessageInitShape<typeof ProductImageSchema> = {}): ProductImage =>
  create(ProductImageSchema, { derivativeId: hex(c), role: 'gallery', primary: false, url: url(c), width: 600, height: 800, ...over });
/** The device's caches, and the network a sync fetches the images from (each request recorded in `added`). */
function device(fetcher?: (request: Request) => Promise<Response>): ReturnType<typeof fakeCaches> {
  const storage = fakeCaches(fetcher);
  vi.stubGlobal('fetch', storage.fetch);
  return storage;
}
afterEach(() => {
  vi.unstubAllGlobals();
});

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

// GALLERY-1 (Ross 10-18): the photo a user chose to display for a figure. One address a figure; the rest of this module
// keeps and answers "the image to show", so the choice changes nothing but which image that is.
describe('shownImage', () => {
  const a = { url: url('a'), width: 1, height: 1, role: 'gallery', primary: false } satisfies CachedImage;
  const b = { ...a, url: url('b'), primary: true };
  const c = { ...a, url: url('c') };

  it('is the chosen image when the list has it, the primary otherwise: a choice the list no longer names is no choice', () => {
    expect(shownImage([a, b, c], url('c'))).toBe(c);
    expect(shownImage([a, b, c], url('d'))).toBe(b);
    expect(shownImage([a, b, c], undefined)).toBe(b);
    expect(shownImage([a], url('z'))).toBe(a);
    expect(shownImage([], url('a'))).toBeUndefined();
  });
});

describe('a chosen photo', () => {
  const lists = (m: Record<string, ProductImage[]>) => vi.fn(async (heads: readonly string[]) => new Map(heads.filter((h) => h in m).map((h) => [h, m[h]!])));
  const owned = async (storage: ReturnType<typeof fakeCaches>) => [...(storage.stores.get(OWNED_MEDIA_CACHE)?.keys() ?? [])].sort();
  const mask = (c: string) => ({ maskId: hex(c), contentType: 'image/png', url: url(c) });
  const choose = (head: string, c: string) => new Map([[head, url(c)]]);

  it('is kept with its mask beside the primary and its mask, and the third image is not', async () => {
    const storage = device();
    const fetchLists = lists({ h1: [img('a', { primary: true, mask: mask('e') }), img('b', { mask: mask('f') }), img('c')] });
    await syncKeptImages(['h1'], fetchLists, { storage, choices: choose('h1', 'b') });
    // the primary stays so the figure keeps its photo until the chosen one is here, and the chosen one comes with its mask
    expect(await owned(storage)).toEqual([url('a'), url('b'), url('e'), url('f')].sort());
  });

  it('is what keptImages answers once its bytes are here; the primary till then', async () => {
    const storage = device();
    const fetchLists = lists({ h1: [img('a', { primary: true, mask: mask('e') }), img('b', { mask: mask('f') })] });
    await syncKeptImages(['h1'], fetchLists, { storage });
    expect((await keptImages(['h1'], storage, choose('h1', 'b'))).get('h1')?.url).toBe(url('a'));
    await syncKeptImages(['h1'], fetchLists, { storage, choices: choose('h1', 'b') });
    expect(await keptImages(['h1'], storage, choose('h1', 'b'))).toEqual(new Map([['h1', expect.objectContaining({ url: url('b'), maskUrl: url('f') })]]));
    // forgotten, the default photo again
    expect((await keptImages(['h1'], storage)).get('h1')?.url).toBe(url('a'));
    expect((await keptImage('h1', storage, choose('h1', 'b')))?.url).toBe(url('b'));
  });

  it('is told to onKept as the photo the figure shows: the primary until the chosen bytes land, then the chosen one', async () => {
    let release!: () => void;
    const released = new Promise<void>((res) => (release = res));
    const storage = device(async (r) => {
      if (r.url === url('b')) await released;
      return new Response('img');
    });
    const fetchLists = lists({ h1: [img('a', { primary: true }), img('b')] });
    await syncKeptImages(['h1'], fetchLists, { storage });
    const told: string[] = [];
    const onKept = (kept: ReadonlyMap<string, CachedImage>) => told.push([...kept].map(([h, i]) => `${h} ${i.url.slice(-1)}`).join(','));
    await (await storage.open(OWNED_MEDIA_CACHE)).delete(url('b'));
    const sync = syncKeptImages(['h1'], fetchLists, { storage, concurrency: 1, onKept, choices: choose('h1', 'b') });
    await vi.waitFor(() => expect(told).toEqual(['h1 a']));
    release();
    await sync;
    expect(told.at(-1)).toBe('h1 b');
  });

  it('is ignored when the fresh list no longer names it (taken down, or never there): the figure shows its primary', async () => {
    const storage = device();
    const fetchLists = lists({ h1: [img('a', { primary: true })] });
    await syncKeptImages(['h1'], fetchLists, { storage, choices: choose('h1', 'z') });
    expect(await owned(storage)).toEqual([url('a')]);
    expect((await keptImages(['h1'], storage, choose('h1', 'z'))).get('h1')?.url).toBe(url('a'));
  });

  it('a withheld chosen photo is never answered: the figure shows its primary', async () => {
    const storage = device();
    await syncKeptImages(['h1'], lists({ h1: [img('a', { primary: true }), img('b')] }), { storage, choices: choose('h1', 'b') });
    expect((await keptImages(['h1'], storage, choose('h1', 'b'))).get('h1')?.url).toBe(url('b'));
    // a later fresh list withholds the chosen photo
    await syncKeptImages(['h1'], lists({ h1: [img('a', { primary: true })] }), { storage, choices: choose('h1', 'b') });
    expect((await keptImages(['h1'], storage, choose('h1', 'b'))).get('h1')?.url).toBe(url('a'));
  });

  it('is a choice for another figure, or none: nothing about the others changes', async () => {
    const storage = device();
    const fetchLists = lists({ h1: [img('a', { primary: true }), img('b')], h2: [img('c', { primary: true }), img('d')] });
    await syncKeptImages(['h1', 'h2'], fetchLists, { storage, choices: choose('h1', 'b') });
    expect(await owned(storage)).toEqual([url('a'), url('b'), url('c')].sort());
  });
});

describe('keepChosenPhotos (PICK-CASE-1)', () => {
  const lists = (m: Record<string, ProductImage[]>) => vi.fn(async (heads: readonly string[]) => new Map(heads.filter((h) => h in m).map((h) => [h, m[h]!])));
  const owned = (storage: ReturnType<typeof fakeCaches>) => [...(storage.stores.get(OWNED_MEDIA_CACHE)?.keys() ?? [])].sort();
  const mask = (c: string) => ({ maskId: hex(c), contentType: 'image/png', url: url(c) });
  const choose = (head: string, c: string) => new Map([[head, url(c)]]);
  /** A device whose last sync kept h1's list (a: the primary with mask e; b: plain; c: with mask f) and the primary's bytes. */
  const synced = async (fetcher?: (request: Request) => Promise<Response>) => {
    const storage = device(fetcher);
    await syncKeptImages(['h1'], lists({ h1: [img('a', { primary: true, mask: mask('e') }), img('b'), img('c', { mask: mask('f') })] }), { storage });
    storage.added.length = 0;
    return storage;
  };

  it('fetches a chosen photo with no cut-out from the kept list, as the sync fetches, without reading any list: keptImages then answers it', async () => {
    const storage = await synced();
    expect(await keepChosenPhotos(['h1'], choose('h1', 'b'), { storage })).toBe(1);
    expect(storage.added.map((r) => [r.url, r.mode, r.credentials, r.cache])).toEqual([[url('b'), 'cors', 'omit', 'no-store']]);
    expect(await keptImages(['h1'], storage, choose('h1', 'b'))).toEqual(new Map([['h1', expect.objectContaining({ url: url('b') })]]));
    expect((await keptImages(['h1'], storage, choose('h1', 'b'))).get('h1')?.maskUrl).toBeUndefined();
  });

  it('fetches a chosen photo\'s mask with it, and the next sync keeps both without fetching them again', async () => {
    const storage = await synced();
    expect(await keepChosenPhotos(['h1'], choose('h1', 'c'), { storage })).toBe(2);
    expect((await keptImages(['h1'], storage, choose('h1', 'c'))).get('h1')).toMatchObject({ url: url('c'), maskUrl: url('f') });
    storage.added.length = 0;
    const fetchLists = lists({ h1: [img('a', { primary: true, mask: mask('e') }), img('b'), img('c', { mask: mask('f') })] });
    expect(await syncKeptImages(['h1'], fetchLists, { storage, choices: choose('h1', 'c') })).toMatchObject({ added: 0, failed: 0 });
    expect(owned(storage)).toEqual([url('a'), url('c'), url('e'), url('f')].sort());
  });

  it('fetches nothing already on the device, nothing for no choice, and nothing for a figure not asked about', async () => {
    const storage = await synced();
    expect(await keepChosenPhotos(['h1'], choose('h1', 'a'), { storage })).toBe(0);
    expect(await keepChosenPhotos(['h1'], new Map(), { storage })).toBe(0);
    expect(await keepChosenPhotos(['h2'], choose('h1', 'b'), { storage })).toBe(0);
    expect(storage.added).toEqual([]);
  });

  it('leaves to the sync a figure with no kept list and a choice its kept list does not name', async () => {
    const storage = await synced();
    expect(await keepChosenPhotos(['h2'], choose('h2', 'b'), { storage })).toBe(0);
    expect(await keepChosenPhotos(['h1'], choose('h1', 'z'), { storage })).toBe(0);
    expect(storage.added).toEqual([]);
  });

  it('never fetches a withheld photo or its mask, and fetches a photo whose mask is withheld without it', async () => {
    const storage = await synced();
    const tomb = await storage.open(WITHHELD_CACHE);
    await tomb.put(withheldKey(url('c')), new Response(null));
    expect(await keepChosenPhotos(['h1'], choose('h1', 'c'), { storage })).toBe(0);
    await tomb.delete(withheldKey(url('c')));
    await tomb.put(withheldKey(url('f')), new Response(null));
    expect(await keepChosenPhotos(['h1'], choose('h1', 'c'), { storage })).toBe(1);
    expect(storage.added.map((r) => r.url)).toEqual([url('c')]);
  });

  it('counts a fetch that fails as not kept and goes on to the next, never throwing: the sync fetches it later', async () => {
    const storage = await synced(async (r) => (r.url === url('c') ? new Response('gone', { status: 404 }) : new Response('img')));
    const choices = new Map([['h1', url('c')]]);
    expect(await keepChosenPhotos(['h1'], choices, { storage })).toBe(1);
    expect(owned(storage)).toContain(url('f'));
    expect(owned(storage)).not.toContain(url('c'));
  });

  it('starts no fetch once its signal aborts, keeping what it fetched', async () => {
    const stop = new AbortController();
    // the case view goes away while the photo comes (this network answers it all the same); its mask is not asked
    const storage = await synced(async (r) => {
      if (r.url === url('c')) stop.abort();
      return new Response('img');
    });
    expect(await keepChosenPhotos(['h1'], choose('h1', 'c'), { storage, signal: stop.signal })).toBe(1);
    expect(storage.added.map((r) => r.url)).toEqual([url('c')]);
    expect(owned(storage)).not.toContain(url('f'));
  });

  it('does nothing where the browser has no Cache API, and reads the browser\'s caches when given none', async () => {
    expect(await keepChosenPhotos(['h1'], choose('h1', 'b'), { storage: undefined })).toBe(0);
    const storage = await synced();
    vi.stubGlobal('caches', storage);
    expect(await keepChosenPhotos(['h1'], choose('h1', 'b'))).toBe(1);
  });
});

describe('rememberImages / recallImages', () => {
  it('keeps a figure\'s list and gives it back, and forgets it when the fresh list is empty', async () => {
    const storage = device();
    const list = toCachedImages([img('a', { primary: true })]);
    await rememberImages('h1', list, storage);
    expect(await recallImages('h1', storage)).toEqual(list);
    expect(await recallImages('h2', storage)).toBeUndefined();
    await rememberImages('h1', [], storage);
    expect(await recallImages('h1', storage)).toBeUndefined();
  });

  it('reads nothing from a record it cannot parse', async () => {
    const storage = device();
    await (await storage.open(IMAGE_LISTS_CACHE)).put(new Request('http://localhost:3000/__fc/image-list/h1'), new Response('{'));
    expect(await recallImages('h1', storage)).toBeUndefined();
  });

  it('answers undefined where the browser has no Cache API', async () => {
    expect(await recallImages('h1', undefined)).toBeUndefined();
    await expect(rememberImages('h1', [], undefined)).resolves.toBeUndefined();
  });
});

describe('syncKeptImages', () => {
  const lists = (m: Record<string, ProductImage[]>) => vi.fn(async (heads: readonly string[]) => new Map(heads.filter((h) => h in m).map((h) => [h, m[h]!])));
  const owned = async (storage: ReturnType<typeof fakeCaches>) => [...(storage.stores.get(OWNED_MEDIA_CACHE)?.keys() ?? [])].sort();

  it('caches the primary image and its mask of every owned figure, by a CORS request without credentials or the HTTP cache', async () => {
    const storage = device();
    const fetchLists = lists({
      h1: [img('a', { primary: true, mask: { maskId: hex('f'), contentType: 'image/png', url: url('f') } }), img('b')],
      h2: [img('c')],
    });
    const result = await syncKeptImages(['h1', 'h2', 'h3'], fetchLists, { storage });
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
    const storage = device();
    await syncKeptImages(['h1', 'h2'], lists({ h1: [img('a', { primary: true })], h2: [img('c', { primary: true })] }), { storage });
    const result = await syncKeptImages(['h1'], lists({ h1: [img('a', { primary: true })] }), { storage });
    expect(await owned(storage)).toEqual([url('a')]);
    expect(await recallImages('h2', storage)).toBeUndefined();
    expect(result).toMatchObject({ added: 0, evicted: 1 });
  });

  it('replaces a figure\'s list with the fresh one: a withdrawn image or mask is dropped from the cache', async () => {
    const storage = device();
    await syncKeptImages(['h1'], lists({ h1: [img('a', { primary: true, mask: { maskId: hex('f'), contentType: '', url: url('f') } })] }), { storage });
    await syncKeptImages(['h1'], lists({ h1: [img('b', { primary: true })] }), { storage });
    expect(await owned(storage)).toEqual([url('b')]);
    expect((await recallImages('h1', storage))?.map((i) => i.url)).toEqual([url('b')]);
  });

  it('keeps at most `max` figures, the first in the order given', async () => {
    const storage = device();
    const fetchLists = lists({ h1: [img('a')], h2: [img('b')], h3: [img('c')] });
    await syncKeptImages(['h1', 'h1', 'h2', 'h3'], fetchLists, { storage, max: 2 });
    expect(fetchLists).toHaveBeenCalledWith(['h1', 'h2']);
    expect(await owned(storage)).toEqual([url('a'), url('b')]);
  });

  it('counts an image it could not fetch and carries on', async () => {
    const storage = device(async (r) => (r.url === url('a') ? new Response('', { status: 404 }) : new Response('img')));
    const result = await syncKeptImages(['h1', 'h2'], lists({ h1: [img('a')], h2: [img('b')] }), { storage, concurrency: 1 });
    expect(await owned(storage)).toEqual([url('b')]);
    expect(result).toMatchObject({ added: 1, failed: 1 });
  });

  it('keeps no image answered without a body (a 204): it counts as not fetched, and the figure is drawn as its plate', async () => {
    const storage = device(async (r) => (r.url === url('a') ? new Response(null, { status: 204 }) : new Response('img')));
    const result = await syncKeptImages(['h1', 'h2'], lists({ h1: [img('a', { primary: true })], h2: [img('b', { primary: true })] }), { storage });
    expect(result).toMatchObject({ added: 1, failed: 1 });
    expect(await owned(storage)).toEqual([url('b')]);
    expect(await keptImage('h1', storage)).toBeUndefined();
  });

  it('tells onKept what the device keeps once the kept lists are written and again as each image lands, while the rest still come (IMG-SHOW-1)', async () => {
    let release!: () => void;
    const released = new Promise<void>((res) => (release = res));
    const storage = device(async (r) => {
      if (r.url === url('f')) await released;
      return new Response('img');
    });
    await rememberImages('h1', [{ url: url('a'), width: 600, height: 800, role: 'gallery', primary: false }], storage);
    await (await storage.open(OWNED_MEDIA_CACHE)).put(url('a'), new Response('kept'));
    const told: string[][] = [];
    const onKept = (kept: ReadonlyMap<string, CachedImage>) => told.push([...kept].map(([head, i]) => `${head} ${i.url.slice(-1)}${i.maskUrl === undefined ? '' : `+${i.maskUrl.slice(-1)}`}`));
    const fetchLists = lists({ h1: [img('a')], h2: [img('b', { mask: { maskId: hex('f'), contentType: 'image/png', url: url('f') } })], h3: [img('c')] });
    const sync = syncKeptImages(['h1', 'h2', 'h3'], fetchLists, { storage, concurrency: 1, onKept });
    // the mask's link holds its answer: what was told so far stands while the sync waits on it
    await vi.waitFor(() => expect(told).toEqual([['h1 a'], ['h1 a', 'h2 b+f']]));
    release();
    await sync;
    expect(told).toEqual([['h1 a'], ['h1 a', 'h2 b+f'], ['h1 a', 'h2 b+f'], ['h1 a', 'h2 b+f', 'h3 c']]);
    expect(new Map(told.at(-1)!.map((t) => [t.split(' ')[0], t]))).toEqual(
      new Map([...(await keptImages(['h1', 'h2', 'h3'], storage))].map(([head, i]) => [head, `${head} ${i.url.slice(-1)}${i.maskUrl === undefined ? '' : `+${i.maskUrl.slice(-1)}`}`])),
    );
  });

  it('does nothing where the browser has no Cache API', async () => {
    const fetchLists = lists({});
    expect(await syncKeptImages(['h1'], fetchLists, { storage: undefined })).toEqual({ figures: 0, images: 0, added: 0, evicted: 0, failed: 0 });
    expect(fetchLists).not.toHaveBeenCalled();
  });
});

// FETCH-FIRST (10-31: on a slow link, the case arranged by series, its default, the first figure in view stood as its plate for
// about a minute: the sync fetched in head-id order, whatever the case showed)
describe('syncKeptImages: the figures the case view shows first (FETCH-FIRST)', () => {
  const lists = (m: Record<string, ProductImage[]>) => vi.fn(async (heads: readonly string[]) => new Map(heads.filter((h) => h in m).map((h) => [h, m[h]!])));
  const mask = (c: string) => ({ maskId: hex(c), contentType: 'image/png', url: url(c) });
  /** h1 to h4, each an image with its mask: a+e, b+f, c+8, d+9. */
  const four = () => lists({ h1: [img('a', { mask: mask('e') })], h2: [img('b', { mask: mask('f') })], h3: [img('c', { mask: mask('8') })], h4: [img('d', { mask: mask('9') })] });
  const KEPT = ['h1', 'h2', 'h3', 'h4'];
  /** The images the sync fetched, in the order it asked for them, by their last letter. */
  const asked = (storage: ReturnType<typeof fakeCaches>) => storage.added.map((r) => r.url.slice(-1)).join('');

  it('fetches the images of the heads `first` names in its order, each before its mask, then every other kept figure\'s in the order kept', async () => {
    const storage = device();
    const result = await syncKeptImages(KEPT, four(), { storage, concurrency: 1, first: () => ['h3', 'h9', 'h1', 'h3'] });
    expect(asked(storage)).toBe('c8aebfd9');
    expect(result).toEqual({ figures: 4, images: 8, added: 8, evicted: 0, failed: 0 });
  });

  it('fetches in the order kept without `first`, or with one that names no kept figure', async () => {
    for (const first of [undefined, () => [], () => ['h9']]) {
      const storage = device();
      await syncKeptImages(KEPT, four(), { storage, concurrency: 1, ...(first === undefined ? {} : { first }) });
      expect(asked(storage)).toBe('aebfc8d9');
    }
  });

  it('asks `first` as each fetch starts: the view moved part way, what it shows now comes next, and what it no longer names goes back to the order kept', async () => {
    let first: readonly string[] = ['h2', 'h3'];
    // the case view moves while the first image is on its way
    const storage = device(async (r) => {
      if (r.url === url('b')) first = ['h4'];
      return new Response('img');
    });
    const result = await syncKeptImages(KEPT, four(), { storage, concurrency: 1, first: () => first });
    expect(asked(storage)).toBe('bd9aefc8');
    expect(result).toMatchObject({ added: 8, failed: 0 });
  });

  it('fetches an image two figures share where the earlier of them in `first` comes', async () => {
    const storage = device();
    await syncKeptImages(['h1', 'h2', 'h3'], lists({ h1: [img('a')], h2: [img('b')], h3: [img('b')] }), { storage, concurrency: 1, first: () => ['h3'] });
    expect(asked(storage)).toBe('ba');
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
    const storage = device();
    await syncKeptImages(['h1'], async () => new Map([['h1', [img('a', { primary: true })]]]), { storage });
    const calls = countCalls(storage);
    const getProductImages = vi.fn(async () => ({ products: [], nextPageToken: 'again' }));
    await expect(syncKeptImages(['h1'], (heads) => fetchImageLists({ getProductImages } as never, heads), { storage })).rejects.toThrow(/pages/);
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

describe('syncKeptImages and the worker\'s browsed cache (src/sw.ts)', () => {
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
    const storage = device();
    await syncKeptImages(['h1'], lists({ h1: [img('a', { primary: true, mask: mask('f') }), img('b')] }), { storage });
    await shown(storage, url('a'));
    await shown(storage, url('f'));
    await shown(storage, url('b'));
    await syncKeptImages(['h1'], lists({ h1: [img('c', { primary: true })] }), { storage });
    expect(browsed(storage)).toEqual([]);
    expect([...(storage.stores.get(OWNED_MEDIA_CACHE)?.keys() ?? [])]).toEqual([url('c')]);
  });

  it('deletes there too the images of a figure that left the collection', async () => {
    const storage = device();
    await syncKeptImages(['h1', 'h2'], lists({ h1: [img('a', { primary: true })], h2: [img('c', { primary: true })] }), { storage });
    await shown(storage, url('c'));
    await syncKeptImages(['h1'], lists({ h1: [img('a', { primary: true })] }), { storage });
    expect(browsed(storage)).toEqual([]);
  });

  it('leaves there what a fresh list still carries, primary or not, and every image no kept list ever named', async () => {
    const storage = device();
    await syncKeptImages(['h1', 'h2'], lists({ h1: [img('a', { primary: true }), img('b'), img('c')], h2: [img('d', { primary: true }), img('e')] }), { storage });
    for (const c of ['b', 'c', 'e', 'z']) await shown(storage, url(c));
    await syncKeptImages(['h1', 'h2'], lists({ h1: [img('b', { primary: true })], h2: [img('d', { primary: true }), img('e')] }), { storage });
    expect(browsed(storage)).toEqual([url('b'), url('e'), url('z')].sort());
  });

  it('deletes there a withheld mask whose bytes were never kept', async () => {
    const storage = device(async (r) => (r.url === url('f') ? new Response('', { status: 404 }) : new Response('img')));
    await syncKeptImages(['h1'], lists({ h1: [img('a', { primary: true, mask: mask('f') })] }), { storage });
    expect([...(storage.stores.get(OWNED_MEDIA_CACHE)?.keys() ?? [])]).toEqual([url('a')]);
    await shown(storage, url('f'));
    await syncKeptImages(['h1'], lists({ h1: [img('a', { primary: true })] }), { storage });
    expect(browsed(storage)).toEqual([]);
  });

  it('deletes there an address only the owned cache still held (the residue of an interrupted sync)', async () => {
    const storage = device();
    await (await storage.open(OWNED_MEDIA_CACHE)).put(url('r'), new Response('img'));
    await shown(storage, url('r'));
    const result = await syncKeptImages(['h1'], lists({ h1: [img('a', { primary: true })] }), { storage });
    expect(browsed(storage)).toEqual([]);
    expect(result).toMatchObject({ evicted: 1, added: 1 });
  });
});

describe('keptImage', () => {
  it('answers a figure\'s primary only while its bytes are on the device', async () => {
    const storage = device();
    await rememberImages('h1', toCachedImages([img('b'), img('a', { primary: true })]), storage);
    expect(await keptImage('h1', storage)).toBeUndefined();
    // Stored as Cache.add stores it, with the origin's Vary: Origin.
    await (await storage.open(OWNED_MEDIA_CACHE)).put(new Request(url('a'), { headers: { Origin: 'http://localhost:3000' } }), new Response('img', { headers: { Vary: 'Origin' } }));
    expect((await keptImage('h1', storage))?.url).toBe(url('a'));
  });

  it('answers nothing without a kept list, or without the Cache API', async () => {
    const storage = device();
    expect(await keptImage('h1', storage)).toBeUndefined();
    expect(await keptImage('h1', undefined)).toBeUndefined();
  });

  it('read while a sync runs, after it recorded what it withholds and before it replaces the kept lists: never answers a recorded address', async () => {
    const base = device();
    await syncKeptImages(['h1'], async () => new Map([['h1', [img('a', { primary: true })]]]), { storage: base });
    expect((await keptImage('h1', base))?.url).toBe(url('a'));
    // The next sync (a display restriction now withholds a) is held at its first kept-list write.
    let release!: () => void;
    const held = new Promise<void>((res) => (release = res));
    let reached = false;
    const open = base.open.bind(base);
    const storage = Object.assign(Object.create(base) as CacheStorage, {
      open: async (name: string) => {
        const cache = await open(name);
        if (name !== IMAGE_LISTS_CACHE) return cache;
        return Object.assign(Object.create(cache) as Cache, {
          put: async (r: RequestInfo, res: Response) => {
            reached = true;
            await held;
            return cache.put(r, res);
          },
        });
      },
    });
    const sync = syncKeptImages(['h1'], async () => new Map([['h1', [img('c', { primary: true })]]]), { storage });
    while (!reached) await new Promise((res) => setTimeout(res, 5));
    expect([...(await withheldAmong([url('a')], base))]).toEqual([url('a')]);
    expect((await recallImages('h1', base))?.map((i) => i.url)).toEqual([url('a')]);
    expect(await keptImage('h1', base)).toBeUndefined();
    expect((await keptImages(['h1'], base)).size).toBe(0);
    release();
    await sync;
    expect((await keptImage('h1', base))?.url).toBe(url('c'));
  });

  it('answers a figure whose kept mask is recorded withheld without that mask, and every other figure as kept', async () => {
    const storage = device();
    const mask = (c: string) => ({ maskId: hex(c), contentType: 'image/png', url: url(c) });
    await syncKeptImages(['h1', 'h2', 'h3'], async () => new Map([
      ['h1', [img('a', { primary: true, mask: mask('f') })]],
      ['h2', [img('b', { primary: true, mask: mask('e') })]],
      ['h3', [img('d', { primary: true })]],
    ]), { storage });
    const tomb = await storage.open(WITHHELD_CACHE);
    await tomb.put(withheldKey(url('a')), new Response(null));
    await tomb.put(withheldKey(url('e')), new Response(null));
    const got = await keptImages(['h1', 'h2', 'h3'], storage);
    expect([...got.keys()]).toEqual(['h2', 'h3']);
    expect(got.get('h2')).toEqual({ url: url('b'), width: 600, height: 800, role: 'gallery', primary: true });
    expect(got.get('h3')?.url).toBe(url('d'));
    expect(await keptImage('h1', storage)).toBeUndefined();
    expect((await keptImage('h2', storage))?.maskUrl).toBeUndefined();
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

  it('syncKeptImages: nothing per figure when every list is empty and nothing was kept', async () => {
    const storage = device();
    const calls = countCalls(storage);
    const result = await syncKeptImages(heads, async () => new Map(), { storage });
    expect(result).toEqual({ figures: 0, images: 0, added: 0, evicted: 0, failed: 0 });
    expect(calls.length).toBeLessThanOrEqual(6);
  });

  it('keptImages: nothing per figure when no list was kept, and only the kept ones otherwise', async () => {
    const storage = device();
    await rememberImages('h7', toCachedImages([img('a', { primary: true })]), storage);
    await (await storage.open(OWNED_MEDIA_CACHE)).put(url('a'), new Response('img'));
    const calls = countCalls(storage);
    const got = await keptImages(heads, storage);
    expect([...got.keys()]).toEqual(['h7']);
    expect(got.get('h7')?.url).toBe(url('a'));
    expect(calls.length).toBeLessThanOrEqual(7);
    const empty = device();
    const emptyCalls = countCalls(empty);
    expect((await keptImages(heads, empty)).size).toBe(0);
    expect(emptyCalls).toEqual([`open ${IMAGE_LISTS_CACHE}`, `keys ${IMAGE_LISTS_CACHE}`]);
  });

  it('keptImages reads what syncs withheld in two cache calls, however many figures it answers', async () => {
    const storage = device();
    const many = heads.slice(0, 300);
    await syncKeptImages(many, async (hs) => new Map(hs.map((h, i) => [h, [img('a', { primary: true, url: `${D}/${i.toString(16).padStart(64, '0')}` })]])), { storage });
    const calls = countCalls(storage);
    expect((await keptImages(heads, storage)).size).toBe(300);
    expect(calls.filter((c) => c.endsWith(WITHHELD_CACHE))).toEqual([`open ${WITHHELD_CACHE}`, `keys ${WITHHELD_CACHE}`]);
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
    expect(getProductImages.mock.calls[0]![1]).toEqual({ signal: abort.signal, timeoutMs: 20_000 });
  });

  it('fetchImageLists gives every call a deadline of 20 s (KEPT_SYNC_STEP_MS), signal or not, so a stalled list read fails the sync', async () => {
    const getProductImages = vi.fn(async (_req: { headIds: string[]; pageToken?: string }, _opts?: { signal?: AbortSignal; timeoutMs?: number }) => ({
      products: [],
      nextPageToken: _req.pageToken === undefined ? 'p2' : '',
    }));
    await fetchImageLists({ getProductImages } as never, ['h1']);
    expect(getProductImages.mock.calls.map((c) => c[1])).toEqual([{ timeoutMs: 20_000 }, { timeoutMs: 20_000 }]);
    expect(KEPT_SYNC_STEP_MS).toBe(20_000);
  });

  it('syncKeptImages fetches no more bytes once its signal is aborted', async () => {
    const abort = new AbortController();
    const storage = device(async () => {
      abort.abort();
      return new Response('img');
    });
    const lists = async () => new Map([['h1', [img('a', { primary: true })]], ['h2', [img('b', { primary: true })]], ['h3', [img('c', { primary: true })]]]);
    const result = await syncKeptImages(['h1', 'h2', 'h3'], lists, { storage, concurrency: 1, signal: abort.signal });
    expect(storage.added).toHaveLength(1);
    expect(result).toMatchObject({ added: 1, failed: 0 });
  });

  it('syncKeptImages touches no cache once its signal is aborted', async () => {
    const storage = device();
    const calls = countCalls(storage);
    const abort = new AbortController();
    const fetchLists = async () => {
      abort.abort();
      return new Map([['h1', [img('a', { primary: true })]]]);
    };
    await expect(syncKeptImages(['h1'], fetchLists, { storage, signal: abort.signal })).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it('syncKeptImages tells onListsRead once it has read the lists, its signal not aborted, before it touches any cache; never when the read fails or is aborted', async () => {
    const storage = device();
    const calls = countCalls(storage);
    const at: string[][] = [];
    const onListsRead = () => at.push([...calls]);
    const options = { storage, onListsRead };
    await syncKeptImages(['h1'], async () => new Map([['h1', [img('a', { primary: true })]]]), options);
    expect(at).toEqual([[]]);
    // The coordinator did not answer.
    await expect(
      syncKeptImages(['h1'], async () => {
        throw new Error('unavailable');
      }, options),
    ).rejects.toThrow('unavailable');
    // The case view went away while the lists were read, and they arrived anyway.
    const abort = new AbortController();
    const aborted = { storage, onListsRead, signal: abort.signal };
    const fetchLists = async () => {
      abort.abort();
      return new Map([['h1', [img('b', { primary: true })]]]);
    };
    await expect(syncKeptImages(['h1'], fetchLists, aborted)).rejects.toThrow();
    expect(at).toEqual([[]]);
  });

  it('syncKeptImages, aborted while it writes the kept lists, writes no more of them and fails, having recorded and deleted what it withholds, and fetches nothing', async () => {
    const storage = device();
    await syncKeptImages(['h0'], async () => new Map([['h0', [img('f', { primary: true })]]]), { storage });
    const abort = new AbortController();
    let puts = 0;
    const open = storage.open.bind(storage);
    (storage as unknown as { open: (name: string) => Promise<Cache> }).open = async (name: string) => {
      const cache = await open(name);
      if (name !== IMAGE_LISTS_CACHE) return cache;
      return Object.assign(Object.create(cache) as Cache, {
        put: async (req: RequestInfo | URL, res: Response) => {
          puts += 1;
          // The case view goes away while the first kept list is written.
          abort.abort();
          return cache.put(req, res);
        },
      });
    };
    const fetched = storage.added.length;
    // f is withheld from h0 now; five other figures each list one image.
    const heads = ['h1', 'h2', 'h3', 'h4', 'h5'];
    const fetchLists = async () => new Map([['h0', []], ...heads.map((h, i) => [h, [img('abcde'[i]!, { primary: true })]] as [string, ProductImage[]])]);
    await expect(syncKeptImages(['h0', ...heads], fetchLists, { storage, signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(puts).toBe(1);
    expect([...(await withheldAmong([url('f')], storage))]).toEqual([url('f')]);
    expect([...(storage.stores.get(OWNED_MEDIA_CACHE)?.keys() ?? [])]).toEqual([]);
    expect(await recallImages('h0', storage)).toBeUndefined();
    expect(storage.added).toHaveLength(fetched);
  });

  it.each([['records c'], ['deletes c\'s shown copy']])(
    'syncKeptImages, aborted while it %s: still records c, deletes it and replaces the kept list that named it, so that figure keeps its image offline, then writes no other kept list and fetches nothing',
    async (when) => {
      const storage = device();
      // h1's image a stays; c, which is not its primary, is withheld at the next sync.
      await syncKeptImages(['h1'], async () => new Map([['h1', [img('a', { primary: true }), img('c')]]]), { storage });
      await (await storage.open(BROWSED_MEDIA_CACHE)).put(url('c'), new Response('img'));
      const abort = new AbortController();
      const puts: string[] = [];
      const open = storage.open.bind(storage);
      (storage as unknown as { open: (name: string) => Promise<Cache> }).open = async (name: string) => {
        const cache = await open(name);
        // The case view goes away while the sync records c, or while it deletes c's shown copy.
        if (name === (when === 'records c' ? WITHHELD_CACHE : BROWSED_MEDIA_CACHE)) {
          const write =
            <A extends unknown[]>(f: (...a: A) => Promise<unknown>) =>
            async (...a: A) => {
              abort.abort();
              return f(...a);
            };
          return Object.assign(Object.create(cache) as Cache, { put: write(cache.put.bind(cache)), delete: write(cache.delete.bind(cache)) });
        }
        if (name !== IMAGE_LISTS_CACHE) return cache;
        return Object.assign(Object.create(cache) as Cache, {
          put: async (req: RequestInfo | URL, res: Response) => {
            puts.push(new URL(req instanceof Request ? req.url : String(req)).pathname);
            return cache.put(req, res);
          },
        });
      };
      const fetched = storage.added.length;
      const fetchLists = async () => new Map([['h1', [img('a', { primary: true })]], ['h2', [img('b', { primary: true })]], ['h3', [img('d', { primary: true })]]]);
      await expect(syncKeptImages(['h1', 'h2', 'h3'], fetchLists, { storage, signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' });
      (storage as unknown as { open: unknown }).open = open;
      expect(puts).toEqual(['/__fc/image-list/h1']);
      expect((await recallImages('h1', storage))?.map((i) => i.url)).toEqual([url('a')]);
      expect((await keptImage('h1', storage))?.url).toBe(url('a'));
      expect(await recallImages('h2', storage)).toBeUndefined();
      expect([...(await withheldAmong([url('c')], storage))]).toEqual([url('c')]);
      expect([...(storage.stores.get(BROWSED_MEDIA_CACHE)?.keys() ?? [])]).toEqual([]);
      expect(storage.added).toHaveLength(fetched);
    },
  );
});

describe('the addresses a sync withheld (the tombstone the worker reads)', () => {
  const lists = (m: Record<string, ProductImage[]>) => async (heads: readonly string[]) => new Map(heads.filter((h) => h in m).map((h) => [h, m[h]!]));
  const mask = (c: string) => ({ maskId: hex(c), contentType: 'image/png', url: url(c) });
  const shown = async (storage: ReturnType<typeof fakeCaches>, u: string) =>
    (await storage.open(BROWSED_MEDIA_CACHE)).put(new Request(u, { headers: { Origin: 'http://localhost:3000' } }), new Response('img', { headers: { Vary: 'Origin' } }));
  const browsed = (storage: ReturnType<typeof fakeCaches>) => [...(storage.stores.get(BROWSED_MEDIA_CACHE)?.keys() ?? [])].sort();
  const withheld = async (storage: ReturnType<typeof fakeCaches>, cs: string[]) => [...(await withheldAmong(cs.map(url), storage))].sort();

  it('remembers each image and mask a fresh list withholds from a figure still owned, not those of a figure that left the collection', async () => {
    const storage = device();
    await syncKeptImages(['h1', 'h2'], lists({ h1: [img('a', { primary: true, mask: mask('f') }), img('b')], h2: [img('c', { primary: true })] }), { storage });
    expect(await withheld(storage, ['a', 'b', 'c', 'f'])).toEqual([]);
    await syncKeptImages(['h1'], lists({ h1: [img('d', { primary: true })] }), { storage });
    expect(await withheld(storage, ['a', 'b', 'c', 'd', 'f'])).toEqual([url('a'), url('b'), url('f')].sort());
  });

  it('remembers every kept address of a figure still owned whose fresh list is empty, or that the coordinator left out', async () => {
    const storage = device();
    await syncKeptImages(['h1', 'h2'], lists({ h1: [img('a', { primary: true })], h2: [img('c', { primary: true })] }), { storage });
    await syncKeptImages(['h1', 'h2'], lists({ h1: [] }), { storage });
    expect(await withheld(storage, ['a', 'c'])).toEqual([url('a'), url('c')].sort());
  });

  it('never remembers an address no kept list named (the residue of an interrupted sync), nor one another fresh list still carries', async () => {
    const storage = device();
    await (await storage.open(OWNED_MEDIA_CACHE)).put(url('r'), new Response('img'));
    await syncKeptImages(['h1', 'h2'], lists({ h1: [img('a', { primary: true })], h2: [img('b', { primary: true })] }), { storage });
    await syncKeptImages(['h1', 'h2'], lists({ h1: [img('c', { primary: true })], h2: [img('b', { primary: true }), img('a')] }), { storage });
    expect(await withheld(storage, ['a', 'b', 'c', 'r'])).toEqual([]);
  });

  it('reads a kept list it cannot parse as naming nothing: nothing withheld, and the fresh list replaces it', async () => {
    const storage = device();
    await (await storage.open(IMAGE_LISTS_CACHE)).put(new Request('http://localhost:3000/__fc/image-list/h1'), new Response('{'));
    await syncKeptImages(['h1'], lists({ h1: [img('a', { primary: true })] }), { storage });
    expect([...(storage.stores.get(WITHHELD_CACHE)?.keys() ?? [])]).toEqual([]);
    expect((await recallImages('h1', storage))?.map((i) => i.url)).toEqual([url('a')]);
  });

  it('keeps no image there: each record is on the app\'s origin, not the image address, and has no body', async () => {
    const storage = device();
    await syncKeptImages(['h1'], lists({ h1: [img('a', { primary: true })] }), { storage });
    await syncKeptImages(['h1'], lists({ h1: [] }), { storage });
    const records = [...(storage.stores.get(WITHHELD_CACHE)?.entries() ?? [])];
    expect(records.map(([k]) => new URL(k).origin)).toEqual(['http://localhost:3000']);
    expect(await Promise.all(records.map(([, r]) => r.clone().text()))).toEqual(['']);
    for (const name of [OWNED_MEDIA_CACHE, BROWSED_MEDIA_CACHE, IMAGE_LISTS_CACHE, WITHHELD_CACHE]) expect([...(storage.stores.get(name)?.keys() ?? [])]).not.toContain(url('a'));
  });

  it('remembers an address before it evicts its bytes or its shown copy, so the worker never serves it in between', async () => {
    const storage = device();
    await syncKeptImages(['h1'], lists({ h1: [img('a', { primary: true })] }), { storage });
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
    await syncKeptImages(['h1'], lists({ h1: [img('b', { primary: true })] }), { storage });
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
    const storage = device();
    await syncKeptImages(['h1', 'h2', 'h3'], lists({ h1: [img('a', { primary: true })], h2: [img('c', { primary: true })], h3: [img('e', { primary: true })] }), { storage });
    const atWrite: string[][] = [];
    onListWrite(storage, async () => {
      atWrite.push(await withheld(storage, ['a', 'c']));
    });
    await syncKeptImages(['h1', 'h2'], lists({ h1: [img('b', { primary: true })], h2: [img('d', { primary: true })] }), { storage });
    // Two lists replaced, the record of the figure that left deleted: each write found both recorded.
    expect(atWrite).toEqual(Array(3).fill([url('a'), url('c')].sort()));
  });

  it('a sync that stops after replacing a kept list (a quota error, the page killed) leaves what it withheld recorded, so a later sync deletes a refill', async () => {
    const storage = device();
    await syncKeptImages(['h1', 'h2'], lists({ h1: [img('a', { primary: true })], h2: [img('c', { primary: true })] }), { storage });
    const restore = onListWrite(storage, async (n) => {
      if (n === 2) throw new DOMException('quota', 'QuotaExceededError');
    });
    const fresh = lists({ h1: [img('b', { primary: true })], h2: [img('d', { primary: true })] });
    await expect(syncKeptImages(['h1', 'h2'], fresh, { storage })).rejects.toThrow('quota');
    restore();
    expect(await withheld(storage, ['a', 'c'])).toEqual([url('a'), url('c')].sort());
    // h1's list was replaced; h2's, whose write was refused, is deleted, so no kept list names c.
    expect((await recallImages('h1', storage))?.map((i) => i.url)).toEqual([url('b')]);
    expect(await recallImages('h2', storage)).toBeUndefined();
    // The next sync completes on the same lists; then an <img> elsewhere refills the browsed cache with one.
    await syncKeptImages(['h1', 'h2'], fresh, { storage });
    expect(await withheld(storage, ['a', 'c'])).toEqual([url('a'), url('c')].sort());
    await shown(storage, url('a'));
    await syncKeptImages(['h1', 'h2'], fresh, { storage });
    expect(browsed(storage)).toEqual([]);
    expect([...(storage.stores.get(OWNED_MEDIA_CACHE)?.keys() ?? [])].sort()).toEqual([url('b'), url('d')].sort());
  });

  /** The cache `name`, whose `n`th put from now on throws the device's quota error where `refuse(n)`. */
  const refusePuts = (storage: ReturnType<typeof fakeCaches>, name: string, refuse: (n: number) => boolean) => {
    const open = storage.open.bind(storage);
    let puts = 0;
    (storage as unknown as { open: (name: string) => Promise<Cache> }).open = async (n: string) => {
      const cache = await open(n);
      if (n !== name) return cache;
      return Object.assign(Object.create(cache) as Cache, {
        put: async (req: RequestInfo | URL, res: Response) => {
          puts += 1;
          if (refuse(puts)) throw new DOMException('quota', 'QuotaExceededError');
          return cache.put(req, res);
        },
      });
    };
    return () => {
      (storage as unknown as { open: unknown }).open = open;
    };
  };
  /** Every address a kept list names, and every address the owned cache holds bytes for. */
  const named = async (storage: ReturnType<typeof fakeCaches>) => {
    const out: string[] = [];
    for (const res of storage.stores.get(IMAGE_LISTS_CACHE)?.values() ?? []) {
      for (const i of JSON.parse(await res.clone().text()) as CachedImage[]) out.push(...(i.maskUrl === undefined ? [i.url] : [i.url, i.maskUrl]));
    }
    return out.sort();
  };
  const owned = (storage: ReturnType<typeof fakeCaches>) => [...(storage.stores.get(OWNED_MEDIA_CACHE)?.keys() ?? [])].sort();

  it('a kept-list write the device refuses (its quota) after the record: nothing it withholds or no longer keeps stays on the device, as bytes, a shown copy, or in a kept list', async () => {
    const storage = device();
    await syncKeptImages(['h1', 'h2', 'h3', 'h4'], lists({ h1: [img('a', { primary: true, mask: mask('f') })], h2: [img('c', { primary: true })], h3: [img('e', { primary: true })], h4: [img('1', { primary: true })] }), { storage });
    for (const c of ['a', 'c', 'e', 'f', '1']) await shown(storage, url(c));
    const restore = refusePuts(storage, IMAGE_LISTS_CACHE, () => true);
    // h1 shows b now (a and its mask f withheld), h2 lists nothing (c withheld), h3 left the collection, h4 is as it was.
    const fresh = lists({ h1: [img('b', { primary: true })], h2: [], h4: [img('1', { primary: true })] });
    await expect(syncKeptImages(['h1', 'h2', 'h4'], fresh, { storage })).rejects.toThrow('quota');
    restore();
    expect(await withheld(storage, ['a', 'c', 'e', 'f'])).toEqual([url('a'), url('c'), url('f')].sort());
    expect(owned(storage)).toEqual([url('1')]);
    expect(browsed(storage)).toEqual([url('1')]);
    expect(await named(storage)).toEqual([url('1')]);
  });

  it('a first record the device refuses (its quota): the sync still deletes what it withholds and no longer keeps, as bytes and shown copies, keeps the kept list naming what it could not record and every other kept figure\'s, writes no kept list, fails, and the next sync records it', async () => {
    const storage = device();
    await syncKeptImages(['h1', 'h3', 'h4'], lists({ h1: [img('a', { primary: true })], h3: [img('e', { primary: true })], h4: [img('4', { primary: true })] }), { storage });
    for (const c of ['a', 'e', '4']) await shown(storage, url(c));
    const restore = refusePuts(storage, WITHHELD_CACHE, () => true);
    // a withheld (h1 shows b now), h3 left the collection, h4 is as it was.
    const fresh = lists({ h1: [img('b', { primary: true })], h4: [img('4', { primary: true })] });
    await expect(syncKeptImages(['h1', 'h4'], fresh, { storage })).rejects.toThrow('quota');
    restore();
    expect(await withheld(storage, ['a', 'e'])).toEqual([]);
    expect(owned(storage)).toEqual([url('4')]);
    expect(browsed(storage)).toEqual([url('4')]);
    expect((await recallImages('h1', storage))?.map((i) => i.url)).toEqual([url('a')]);
    expect(await keptImage('h1', storage)).toBeUndefined();
    expect(await recallImages('h3', storage)).toBeUndefined();
    expect((await recallImages('h4', storage))?.map((i) => i.url)).toEqual([url('4')]);
    await syncKeptImages(['h1', 'h4'], fresh, { storage });
    expect(await withheld(storage, ['a', 'e'])).toEqual([url('a')]);
    expect(await named(storage)).toEqual([url('b'), url('4')].sort());
    expect(owned(storage)).toEqual([url('b'), url('4')].sort());
  });

  it('a record the device refuses after another was written (its quota on the second): the sync deletes as it would, but keeps the kept list naming what it could not record, writes no kept list, fails, and the next sync records it', async () => {
    const storage = device();
    // h2 names a too, and c, which is not its primary; h4 names neither.
    await syncKeptImages(['h1', 'h2', 'h3', 'h4'], lists({ h1: [img('a', { primary: true })], h2: [img('2', { primary: true }), img('c'), img('a')], h3: [img('e', { primary: true })], h4: [img('4', { primary: true })] }), { storage });
    for (const c of ['a', 'c', 'e', '2']) await shown(storage, url(c));
    const restore = refusePuts(storage, WITHHELD_CACHE, (n) => n === 2);
    // a and c withheld (a recorded first), h3 left the collection, h4 is as it was.
    const fresh = lists({ h1: [img('b', { primary: true })], h2: [img('2', { primary: true })], h4: [img('4', { primary: true })] });
    await expect(syncKeptImages(['h1', 'h2', 'h4'], fresh, { storage })).rejects.toThrow('quota');
    restore();
    expect(await withheld(storage, ['a', 'c', 'e'])).toEqual([url('a')]);
    expect(owned(storage)).toEqual([url('2'), url('4')].sort());
    expect(browsed(storage)).toEqual([url('2')]);
    expect(await recallImages('h1', storage)).toBeUndefined();
    expect((await recallImages('h2', storage))?.map((i) => i.url)).toEqual([url('2'), url('c'), url('a')]);
    expect(await recallImages('h3', storage)).toBeUndefined();
    expect((await recallImages('h4', storage))?.map((i) => i.url)).toEqual([url('4')]);
    await syncKeptImages(['h1', 'h2', 'h4'], fresh, { storage });
    expect(await withheld(storage, ['a', 'c', 'e'])).toEqual([url('a'), url('c')].sort());
    expect(await named(storage)).toEqual([url('b'), url('2'), url('4')].sort());
    expect(owned(storage)).toEqual([url('b'), url('2'), url('4')].sort());
  });

  it('a kept-list replacement the device refuses part way: the lists replaced stay, and the refused one and every other list naming a withheld address go, so none names one', async () => {
    const storage = device();
    await syncKeptImages(['h1', 'h2', 'h3'], lists({ h1: [img('a', { primary: true })], h2: [img('c', { primary: true })], h3: [img('e', { primary: true })] }), { storage });
    const restore = refusePuts(storage, IMAGE_LISTS_CACHE, (n) => n === 2);
    const fresh = lists({ h1: [img('b', { primary: true })], h2: [img('d', { primary: true })], h3: [img('f', { primary: true })] });
    await expect(syncKeptImages(['h1', 'h2', 'h3'], fresh, { storage })).rejects.toThrow('quota');
    restore();
    expect(await withheld(storage, ['a', 'c', 'e'])).toEqual([url('a'), url('c'), url('e')].sort());
    expect((await recallImages('h1', storage))?.map((i) => i.url)).toEqual([url('b')]);
    expect(await recallImages('h2', storage)).toBeUndefined();
    expect(await recallImages('h3', storage)).toBeUndefined();
    expect(await named(storage)).toEqual([url('b')]);
  });

  it('deletes a refill of a withheld address from the browsed cache at every later sync', async () => {
    const storage = device();
    await syncKeptImages(['h1'], lists({ h1: [img('a', { primary: true, mask: mask('f') })] }), { storage });
    await syncKeptImages(['h1'], lists({ h1: [img('b', { primary: true })] }), { storage });
    // Refilled after the sync that withheld them (a document still drawing them, an older worker).
    await shown(storage, url('a'));
    await shown(storage, url('f'));
    await shown(storage, url('z'));
    const result = await syncKeptImages(['h1'], lists({ h1: [img('b', { primary: true })] }), { storage });
    expect(browsed(storage)).toEqual([url('z')]);
    expect(result).toMatchObject({ added: 0, evicted: 0 });
    await shown(storage, url('a'));
    await syncKeptImages(['h1'], lists({ h1: [img('b', { primary: true })] }), { storage });
    expect(browsed(storage)).toEqual([url('z')]);
  });

  it('forgets an address once a fresh list carries it again, before it fetches it, and leaves its shown copy', async () => {
    const atFetch: string[][] = [];
    const storage: ReturnType<typeof fakeCaches> = device(async (r) => {
      atFetch.push([...(await withheldAmong([r.url], storage))]);
      return new Response('img');
    });
    await syncKeptImages(['h1'], lists({ h1: [img('a', { primary: true }), img('c')] }), { storage });
    await syncKeptImages(['h1'], lists({ h1: [img('b', { primary: true })] }), { storage });
    expect(await withheld(storage, ['a', 'c'])).toEqual([url('a'), url('c')].sort());
    atFetch.length = 0;
    await syncKeptImages(['h1'], lists({ h1: [img('a', { primary: true })] }), { storage });
    expect(atFetch).toEqual([[]]);
    expect(await withheld(storage, ['a', 'b', 'c'])).toEqual([url('b'), url('c')].sort());
    expect([...(storage.stores.get(OWNED_MEDIA_CACHE)?.keys() ?? [])]).toEqual([url('a')]);
    // Shown again once a fresh list carries it: a later sync leaves that copy where it is.
    await shown(storage, url('c'));
    await syncKeptImages(['h1'], lists({ h1: [img('a', { primary: true }), img('c')] }), { storage });
    await shown(storage, url('a'));
    await syncKeptImages(['h1'], lists({ h1: [img('a', { primary: true }), img('c')] }), { storage });
    expect(browsed(storage)).toEqual([url('a'), url('c')].sort());
  });

  it(`keeps at most MAX_WITHHELD (${MAX_WITHHELD}) addresses, the oldest dropped first`, async () => {
    const storage = device();
    const many = Array.from({ length: MAX_WITHHELD + 1 }, (_, i) => `${D}/${i.toString(16).padStart(64, '0')}`);
    const asImg = (u: string, primary = false) => create(ProductImageSchema, { derivativeId: u.slice(-64), role: 'gallery', primary, url: u, width: 1, height: 1 });
    await syncKeptImages(['h1'], lists({ h1: many.map((u, i) => asImg(u, i === 0)) }), { storage });
    await syncKeptImages(['h1'], lists({ h1: [img('a', { primary: true })] }), { storage });
    expect(storage.stores.get(WITHHELD_CACHE)?.size).toBe(MAX_WITHHELD);
    expect([...(await withheldAmong([many[0]!, many[1]!, many.at(-1)!], storage))]).toEqual([many[1], many.at(-1)]);
    await syncKeptImages(['h1'], lists({ h1: [img('b', { primary: true })] }), { storage });
    expect(storage.stores.get(WITHHELD_CACHE)?.size).toBe(MAX_WITHHELD);
    expect([...(await withheldAmong([many[1]!, many[2]!, url('a')], storage))]).toEqual([many[2], url('a')]);
  });

  it('remembers at most 3000 addresses: two for each of the 1500 figures kept, an image and its mask', () => {
    expect(MAX_KEPT_FIGURES).toBe(1500);
    expect(MAX_WITHHELD).toBe(3000);
  });

  it('reads the remembered addresses in a few cache calls, not one per address', async () => {
    const storage = device();
    const many = Array.from({ length: 500 }, (_, i) => `${D}/${i.toString(16).padStart(64, '0')}`);
    await syncKeptImages(['h1'], lists({ h1: many.map((u, i) => create(ProductImageSchema, { derivativeId: u.slice(-64), role: 'gallery', primary: i === 0, url: u, width: 1, height: 1 })) }), { storage });
    await syncKeptImages(['h1'], lists({ h1: [] }), { storage });
    const calls = countCalls(storage);
    await syncKeptImages(['h1'], lists({ h1: [] }), { storage });
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
  afterEach(() => {
    uninstall();
    vi.useRealTimers();
  });
  /** An image link that never answers: only an abort of the request's own signal ends a fetch of these. */
  const stalling = (...cs: string[]) => (req: Request): Promise<Response> =>
    cs.some((c) => req.url === url(c))
      ? new Promise<Response>((_res, rej) => req.signal.addEventListener('abort', () => rej(req.signal.reason)))
      : Promise.resolve(new Response('img'));
  /** Where a sync is, read without waiting for it. */
  function track(p: Promise<unknown>): () => string {
    let state = 'running';
    p.then(() => (state = 'settled'), (e: unknown) => (state = (e as { name?: string }).name ?? 'threw'));
    return () => state;
  }

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
    await syncKeptImages(['h1'], lists({ h1: [img('a', { primary: true })] }), { storage: device() });
    expect(locks.asked).toEqual(['fc-owned-sync']);
  });

  it('a sync that read the lists later writes later: one that read older lists, finishing last, never undoes what the later one withheld', async () => {
    uninstall = installFakeLocks();
    const storage = device();
    await syncKeptImages(['h1'], lists({ h1: [img('a', { primary: true })] }), { storage });
    const events: string[] = [];
    // Document B reads the lists before a display restriction withholds a (it still lists a); its read
    // answers late, and its first cache call after it is slow too.
    const b = otherDocument(storage);
    let answerB!: () => void;
    const bAnswers = new Promise<void>((res) => (answerB = res));
    const syncB = syncKeptImages(['h1'], async () => {
      events.push('B reads');
      await bAnswers;
      b.holdNextOpen();
      return new Map([['h1', [img('a', { primary: true })]]]);
    }, { storage: b.storage }).then(() => events.push('B done'));
    await settle();
    // Document A reads them after: a is withheld, c is the figure's image now.
    const syncA = syncKeptImages(['h1'], async () => {
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
    const storage = device();
    let answerB!: () => void;
    const syncB = syncKeptImages(['h1'], async () => {
      await new Promise<void>((res) => (answerB = res));
      return new Map([['h1', [img('a', { primary: true })]]]);
    }, { storage });
    await settle();
    const abort = new AbortController();
    const fetchA = vi.fn(lists({ h1: [img('c', { primary: true })] }));
    const syncA = syncKeptImages(['h1'], fetchA, { storage, signal: abort.signal });
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

  it('a sync waits at most 10 s (KEPT_SYNC_WAIT_MS) for another document\'s: then it fails, having asked nothing and touched no cache', async () => {
    expect(KEPT_SYNC_WAIT_MS).toBe(10_000);
    uninstall = installFakeLocks();
    const storage = device();
    let answerB!: () => void;
    const syncB = syncKeptImages(['h1'], async () => {
      await new Promise<void>((res) => (answerB = res));
      return new Map([['h1', [img('a', { primary: true })]]]);
    }, { storage });
    await settle();
    const fetchA = vi.fn(lists({ h1: [img('c', { primary: true })] }));
    const outcome = syncKeptImages(['h1'], fetchA, { storage, lockWaitMs: 30 }).then(() => 'synced', (e: unknown) => (e as { name?: string }).name);
    expect(await Promise.race([outcome, new Promise((res) => setTimeout(() => res('still waiting'), 300))])).toBe('TimeoutError');
    answerB();
    await syncB;
    expect(fetchA).not.toHaveBeenCalled();
    expect(owned(storage)).toEqual([url('a')]);
  });

  it('a sync whose signal is already aborted does not wait for another document\'s: it stops at once, having asked nothing', async () => {
    uninstall = installFakeLocks();
    const storage = device();
    let answerB!: () => void;
    const syncB = syncKeptImages(['h1'], async () => {
      await new Promise<void>((res) => (answerB = res));
      return new Map([['h1', [img('a', { primary: true })]]]);
    }, { storage });
    await settle();
    const abort = new AbortController();
    abort.abort();
    const fetchA = vi.fn(lists({ h1: [img('c', { primary: true })] }));
    const outcome = syncKeptImages(['h1'], fetchA, { storage, signal: abort.signal }).then(() => 'synced', (e: unknown) => (e as { name?: string }).name);
    expect(await Promise.race([outcome, settle().then(() => 'still waiting')])).toBe('AbortError');
    answerB();
    await syncB;
    expect(fetchA).not.toHaveBeenCalled();
  });

  it('a sync waits 10 s (KEPT_SYNC_WAIT_MS) for another document\'s when no wait is given, as the case view syncs: then it fails, having asked nothing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    uninstall = installFakeLocks();
    const storage = device();
    let answerB!: () => void;
    const syncB = syncKeptImages(['h1'], async () => {
      await new Promise<void>((res) => (answerB = res));
      return new Map([['h1', [img('a', { primary: true })]]]);
    }, { storage });
    await vi.advanceTimersByTimeAsync(0);
    const fetchA = vi.fn(lists({ h1: [img('c', { primary: true })] }));
    const a = track(syncKeptImages(['h1'], fetchA, { storage }));
    await vi.advanceTimersByTimeAsync(9_999);
    expect(a()).toBe('running');
    await vi.advanceTimersByTimeAsync(1);
    expect(a()).toBe('TimeoutError');
    answerB();
    await vi.advanceTimersByTimeAsync(0);
    await syncB;
    expect(fetchA).not.toHaveBeenCalled();
  });

  it('a sync whose case view goes away aborts its image fetch in flight, so it lets go of the lock: the next sync runs and records what it withholds', async () => {
    uninstall = installFakeLocks();
    const storage = device(stalling('a'));
    const abort = new AbortController();
    const a = track(syncKeptImages(['h1'], lists({ h1: [img('a', { primary: true })] }), { storage, signal: abort.signal }));
    await settle();
    expect(storage.added.map((r) => r.url)).toEqual([url('a')]);
    expect(storage.added[0]!.signal.aborted).toBe(false);
    abort.abort();
    await settle();
    expect(storage.added[0]!.signal.aborted).toBe(true);
    expect(a()).toBe('settled');
    // A display restriction now withholds a: the next sync, in another document or a new case view here.
    const fetchB = vi.fn(lists({ h1: [img('c', { primary: true })] }));
    const b = await syncKeptImages(['h1'], fetchB, { storage, lockWaitMs: 300 }).then(() => 'synced', (e: unknown) => (e as { name?: string }).name);
    expect(b).toBe('synced');
    expect(fetchB).toHaveBeenCalledTimes(1);
    expect(await withheld(storage, ['a', 'c'])).toEqual([url('a')]);
    expect(owned(storage)).toEqual([url('c')]);
  });

  it('an image fetch that does not arrive within 20 s (KEPT_SYNC_STEP_MS) is abandoned and no other starts after it, so a sync on a stalled link lets go of the lock while its case view stays open', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    uninstall = installFakeLocks();
    const storage = device(stalling('a', 'b', 'd'));
    const a = track(syncKeptImages(['h1', 'h2', 'h3'], lists({ h1: [img('a', { primary: true })], h2: [img('b', { primary: true })], h3: [img('d', { primary: true })] }), { storage, concurrency: 1 }));
    await vi.advanceTimersByTimeAsync(15_000);
    // Another document's sync, the lists now withholding a; it waits KEPT_SYNC_WAIT_MS for this one.
    const fetchB = vi.fn(lists({ h1: [img('c', { primary: true })] }));
    const b = track(syncKeptImages(['h1'], fetchB, { storage }));
    await vi.advanceTimersByTimeAsync(4_999);
    expect([a(), b()]).toEqual(['running', 'running']);
    expect(storage.added.map((r) => r.url)).toEqual([url('a')]);
    await vi.advanceTimersByTimeAsync(1);
    expect([a(), b()]).toEqual(['settled', 'settled']);
    expect(storage.added.map((r) => r.url)).toEqual([url('a'), url('c')]);
    expect(storage.added[0]!.signal.aborted).toBe(true);
    expect(fetchB).toHaveBeenCalledTimes(1);
    expect(await withheld(storage, ['a', 'b', 'c', 'd'])).toEqual([url('a')]);
    expect(owned(storage)).toEqual([url('c')]);
    expect(KEPT_SYNC_STEP_MS).toBe(20_000);
  });

  it('once an image fetch is abandoned no other starts, so the sync lets go of the lock at most 20 s later, when the fetches already under way end', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    uninstall = installFakeLocks();
    const stalled = stalling('a', 'd', 'e');
    const storage = device((req) => (req.url === url('b') ? new Promise<Response>((res) => setTimeout(() => res(new Response('img')), 15_000)) : stalled(req)));
    const fetchLists = lists({ h1: [img('a', { primary: true })], h2: [img('b', { primary: true })], h3: [img('d', { primary: true })], h4: [img('e', { primary: true })] });
    const sync = syncKeptImages(['h1', 'h2', 'h3', 'h4'], fetchLists, { storage, concurrency: 2 });
    const a = track(sync);
    // a is abandoned at 20 s; d, started at 15 s when b arrived, at 35 s; e is never asked.
    await vi.advanceTimersByTimeAsync(34_999);
    expect(a()).toBe('running');
    expect(storage.added.map((r) => r.url)).toEqual([url('a'), url('b'), url('d')]);
    await vi.advanceTimersByTimeAsync(1);
    expect(a()).toBe('settled');
    expect(await sync).toMatchObject({ added: 1, failed: 2 });
    expect(storage.added.map((r) => r.url)).toEqual([url('a'), url('b'), url('d')]);
  });

  it('a slow link that brings each image within 20 s brings them all: the deadline is each fetch\'s, not the sync\'s', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    uninstall = installFakeLocks();
    const storage = device(() => new Promise<Response>((res) => setTimeout(() => res(new Response('img')), 15_000)));
    const sync = syncKeptImages(['h1', 'h2', 'h3'], lists({ h1: [img('a', { primary: true })], h2: [img('b', { primary: true })], h3: [img('d', { primary: true })] }), { storage, concurrency: 1 });
    await vi.advanceTimersByTimeAsync(45_000);
    expect(await sync).toMatchObject({ added: 3, failed: 0 });
    expect(owned(storage)).toEqual([url('a'), url('b'), url('d')]);
  });

  /**
   * A link that answers each image's headers after `headersMs`, then brings `bytes` bytes, one every
   * `everyMs`, and ends the body, or, when it `stalls`, sends nothing more. An abort of the request's
   * own signal ends the fetch, or errors the body, as the browser's does.
   */
  const link = ({ headersMs = 0, bytes = 0, everyMs = 0, stalls = false }) => (req: Request): Promise<Response> =>
    new Promise<Response>((answer, fail) => {
      const timers: ReturnType<typeof setTimeout>[] = [];
      let body: ReadableStreamDefaultController<Uint8Array> | undefined;
      req.signal.addEventListener('abort', () => {
        for (const t of timers) clearTimeout(t);
        fail(req.signal.reason);
        body?.error(req.signal.reason);
      });
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          body = c;
          for (let i = 1; i <= bytes; i += 1) {
            timers.push(setTimeout(() => {
              c.enqueue(new Uint8Array([i]));
              if (i === bytes && !stalls) c.close();
            }, headersMs + i * everyMs));
          }
          if (bytes === 0 && !stalls) c.close();
        },
      });
      timers.push(setTimeout(() => answer(new Response(stream, { headers: { 'Content-Type': 'image/webp' } })), headersMs));
    });

  it('a slow link whose bytes keep coming keeps every image, though each takes longer than 20 s, over successive syncs: the deadline is on the bytes stopping', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    uninstall = installFakeLocks();
    // Four fetches at a time share the link: each image's 5 bytes come one every 5 s, 25 s in all.
    const storage = device(link({ bytes: 5, everyMs: 5_000 }));
    const cs = ['a', 'b', 'c', 'd', 'e', 'f', '1', '2'];
    const heads = cs.map((c) => `h${c}`);
    const fetchLists = lists(Object.fromEntries(cs.map((c) => [`h${c}`, [img(c, { primary: true })]])));
    const sync = syncKeptImages(heads, fetchLists, { storage });
    await vi.advanceTimersByTimeAsync(50_000);
    expect(await sync).toMatchObject({ added: 8, failed: 0 });
    expect(owned(storage)).toEqual(cs.map(url).sort());
    const kept = await (await storage.open(OWNED_MEDIA_CACHE)).match(url('a'));
    expect(new Uint8Array(await kept!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    expect(kept!.headers.get('Content-Type')).toBe('image/webp');
    // The next sync over the same link keeps them all, fetching none again.
    const next = syncKeptImages(heads, fetchLists, { storage });
    await vi.advanceTimersByTimeAsync(0);
    expect(await next).toMatchObject({ added: 0, failed: 0, evicted: 0 });
    expect(owned(storage)).toEqual(cs.map(url).sort());
    expect(storage.added).toHaveLength(8);
  });

  it.each([
    ['answers the headers, then sends no byte', { stalls: true }, 20_000],
    ['answers the headers, sends a byte every 5 s for 15 s, then none', { bytes: 3, everyMs: 5_000, stalls: true }, 35_000],
    ['answers the headers only after 15 s, then sends no byte', { headersMs: 15_000, stalls: true }, 35_000],
  ])('an image fetch whose link %s is abandoned 20 s (KEPT_SYNC_STEP_MS) after the last thing it sent, and no other starts after it', async (_name, how, at) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    uninstall = installFakeLocks();
    const stalls = link(how);
    const storage = device((req) => (req.url === url('a') ? stalls(req) : Promise.resolve(new Response('img'))));
    const sync = syncKeptImages(['h1', 'h2'], lists({ h1: [img('a', { primary: true })], h2: [img('b', { primary: true })] }), { storage, concurrency: 1 });
    const a = track(sync);
    await vi.advanceTimersByTimeAsync(at - 1);
    expect(a()).toBe('running');
    await vi.advanceTimersByTimeAsync(1);
    expect(a()).toBe('settled');
    expect(await sync).toMatchObject({ added: 0, failed: 1 });
    expect(storage.added.map((r) => r.url)).toEqual([url('a')]);
    expect(storage.added[0]!.signal.aborted).toBe(true);
    expect(owned(storage)).toEqual([]);
  });

  it('an image the link refuses leaves no deadline behind: a slow image after it, its bytes coming, is kept, and the next is fetched', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    uninstall = installFakeLocks();
    const slow = link({ bytes: 5, everyMs: 5_000 });
    const storage = device((req) => (req.url === url('a') ? Promise.resolve(new Response('', { status: 404 })) : req.url === url('b') ? slow(req) : Promise.resolve(new Response('img'))));
    const sync = syncKeptImages(['h1', 'h2', 'h3'], lists({ h1: [img('a', { primary: true })], h2: [img('b', { primary: true })], h3: [img('c', { primary: true })] }), { storage, concurrency: 1 });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await sync).toMatchObject({ added: 2, failed: 1 });
    expect(owned(storage)).toEqual([url('b'), url('c')]);
  });

  it('a slow write to the owned cache is not a stalled link: the images after it are still fetched', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    uninstall = installFakeLocks();
    const storage = device();
    // Each write of an image's bytes takes 25 s (a device short of space).
    const open = storage.open.bind(storage);
    (storage as unknown as { open: (name: string) => Promise<Cache> }).open = async (name: string) => {
      const cache = await open(name);
      if (name !== OWNED_MEDIA_CACHE) return cache;
      return Object.assign(Object.create(cache) as Cache, {
        put: async (req: RequestInfo | URL, res: Response) => {
          await new Promise((done) => setTimeout(done, 25_000));
          return cache.put(req, res);
        },
      });
    };
    const sync = syncKeptImages(['h1', 'h2'], lists({ h1: [img('a', { primary: true })], h2: [img('b', { primary: true })] }), { storage, concurrency: 1 });
    await vi.advanceTimersByTimeAsync(50_000);
    expect(await sync).toMatchObject({ added: 2, failed: 0 });
    expect(owned(storage)).toEqual([url('a'), url('b')]);
  });

  it('a write of an image\'s bytes the device refuses (its quota) keeps nothing and counts the image failed, not added: the images after it are still fetched', async () => {
    uninstall = installFakeLocks();
    const storage = device();
    const open = storage.open.bind(storage);
    (storage as unknown as { open: (name: string) => Promise<Cache> }).open = async (name: string) => {
      const cache = await open(name);
      if (name !== OWNED_MEDIA_CACHE) return cache;
      return Object.assign(Object.create(cache) as Cache, {
        put: async (req: RequestInfo | URL, res: Response) => {
          if ((req instanceof Request ? req.url : String(req)) === url('a')) throw new DOMException('quota', 'QuotaExceededError');
          return cache.put(req, res);
        },
      });
    };
    const synced = await syncKeptImages(['h1', 'h2'], lists({ h1: [img('a', { primary: true })], h2: [img('b', { primary: true })] }), { storage, concurrency: 1 });
    expect(synced).toMatchObject({ added: 1, failed: 1 });
    expect(owned(storage)).toEqual([url('b')]);
  });

  it('where the browser has no Web Locks, a sync runs at once: syncs in two documents are not serialised', async () => {
    expect((navigator as unknown as { locks?: unknown }).locks).toBeUndefined();
    const storage = device();
    const events: string[] = [];
    let answerB!: () => void;
    const syncB = syncKeptImages(['h1'], async () => {
      await new Promise<void>((res) => (answerB = res));
      return new Map();
    }, { storage }).then(() => events.push('B done'));
    await settle();
    await syncKeptImages(['h1'], lists({ h1: [img('c', { primary: true })] }), { storage }).then(() => events.push('A done'));
    answerB();
    await syncB;
    expect(events).toEqual(['A done', 'B done']);
  });
});

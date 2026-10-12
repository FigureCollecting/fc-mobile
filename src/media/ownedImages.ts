// ADDR-1: the image, mask and grounding of the OWNED figures, kept so the case view renders offline.
//
//   fc-image-lists-v1   one record per owned figure: its image list as the coordinator last sent it
//                       (address, size, role, primary, mask address, grounding). A fresh list REPLACES
//                       the record (catalog.proto DISPLAY RESTRICTIONS).
//   fc-owned-media-v1   the bytes of each owned figure's primary image and its mask, fetched by a CORS
//                       request without credentials that neither reads nor fills the browser's HTTP
//                       cache (cache 'no-store': the origin answers immutable, and a copy there would
//                       outlive an eviction here). The service worker reads this cache FIRST for the
//                       public image address and sends this fetch to the origin without storing it
//                       (src/sw.ts). The sync stores the bytes here only; an image an <img> showed
//                       before its figure was owned stays in fc-derivatives-v2 too, until the sync
//                       evicts it (e2e/pwa (b)).
//   fc-derivatives-v2   the worker's cache of what an <img> showed (BROWSED_MEDIA_CACHE). The sync
//                       deletes from it too every address a kept list named and the fresh lists no
//                       longer carry, and every withheld address recorded below.
//   fc-withheld-v1      one record per address withheld from a figure still owned (its kept list
//                       named it, no fresh list carries it): keyed on the app's origin, no bytes, at
//                       most MAX_WITHHELD, the oldest dropped first. Written before any kept list is
//                       replaced or any byte evicted, so a sync that stops part way keeps it; an
//                       address a fresh list carries again is forgotten before any fetch.
//                       The worker refuses a recorded address (src/sw.ts), and neither keptImages
//                       nor useProductImage online answers it, until a fresh list carries it again.
//
// So at each sync, an image or a mask a display restriction now withholds from an owned figure, or
// that belonged to a figure no longer owned, is deleted from the owned and browsed caches, and a
// withheld one is recorded, so a refill of the browsed cache after that sync is deleted at the next.
// A figure no longer owned is not recorded: its figure page asks the coordinator, as for any figure
// not owned. Both kept caches hold exactly the owned figures (at most MAX_OWNED_FIGURES of them).
// Where the browser has Web Locks, the documents of the app sync one at a time (syncOwnedImages). A list
// call of a sync ends within OWNED_SYNC_STEP_MS, an image fetch once it has received nothing for that
// long, and either as soon as its case view goes away.
// keptImage answers a figure's kept image only if its bytes are here when asked and no sync recorded
// it withheld; otherwise the figure is drawn as its plate. Nothing here is sent anywhere.
// No fetch of the image address, here or in the worker, uses the HTTP cache, so neither answers an
// evicted image from it. A document the worker does not control yet (a first visit before it claims,
// a shift-reload) loads its <img>s through the HTTP cache, where the origin's immutable keeps a copy
// after an eviction here; no fetch here or in the worker reads it. The worker answers the page with a
// copy marked Cache-Control no-store (src/sw.ts), because Chromium's memory cache inside a tab keeps
// an immutable image for a later document of that tab past an eviction here (measured outside the
// suite: src/sw.ts says why); an opaque answer cannot be copied and goes as it is.
import type { ProductImage } from '@figurecollecting/fc-api-contract';
import { isMediaUrl } from './address';

export const OWNED_MEDIA_CACHE = 'fc-owned-media-v1';
export const IMAGE_LISTS_CACHE = 'fc-image-lists-v1';
/** The service worker's cache of the images an <img> showed (src/sw.ts). */
export const BROWSED_MEDIA_CACHE = 'fc-derivatives-v2';
/** The bound on figures kept for offline: ~2 images each. */
export const MAX_OWNED_FIGURES = 1500;
/** The addresses a sync withheld from a figure still owned: one record each, no bytes (withheldKey). */
export const WITHHELD_CACHE = 'fc-withheld-v1';
/** The bound on the withheld addresses remembered (a full collection's images and masks); the oldest go first. */
export const MAX_WITHHELD = 2 * MAX_OWNED_FIGURES;
/**
 * The most GetProductImages pages one batch may take: a server that never ends is a fault. At
 * IMAGE_PAGE_SIZE rows a page, that is 50 images a figure for a batch of 200 figures.
 */
export const MAX_IMAGE_PAGES = 50;
/** The largest page the coordinator serves (catalog.proto: 0 is its default of 50 rows, capped at 200). */
export const IMAGE_PAGE_SIZE = 200;
const MAX_HEADS_PER_CALL = 200;
/** The Web Lock every document of the app syncs the owned images under: one name across builds. */
export const OWNED_SYNC_LOCK = 'fc-owned-sync';
/**
 * How long a sync waits for another document's before it fails, having asked and touched nothing (what
 * the last sync kept then stands). The other lets go when it completes or fails: when its case view
 * goes away, once its fetches in flight end and a cache write under way finishes; and at most
 * OWNED_SYNC_STEP_MS after its fetches in flight stop receiving anything, or a cache write finishes,
 * whichever is later (syncOwnedImages). While their bytes keep coming (a large first sync, a slow
 * link), or a write is slow, it holds the lock, and this wait runs out first. A document whose sync
 * failed here answers from what was kept, the other's sync told to it or not, until a sync of its own:
 * its case view opened again once its answer is ten minutes old, or the owned figures or the reach
 * changing. So a takedown the other's lists did not carry yet lands there only then, as one between
 * two documents' list reads does.
 */
export const OWNED_SYNC_WAIT_MS = 10_000;
/**
 * The longest a GetProductImages call of a sync may take, and the longest an image fetch may go
 * without receiving anything (its headers, a byte of its body). A list call past it fails the sync; an
 * image fetch that receives nothing for that long is abandoned, and no other starts after it.
 */
export const OWNED_SYNC_STEP_MS = 20_000;

export interface CachedImage {
  url: string;
  width: number;
  height: number;
  role: string;
  primary: boolean;
  /** The mask's address, when the coordinator sent this caller one. */
  maskUrl?: string;
  /** Grounding (catalog.proto ProductImage), as the coordinator measured it for this caller. */
  bottomMarginFrac?: number;
  contactBand?: { centerXFrac: number; widthFrac: number };
}

export interface OwnedImageSync {
  figures: number;
  images: number;
  added: number;
  evicted: number;
  failed: number;
}

/** The images a client may keep: only those on the public image address, a mask only when it is too. */
export function toCachedImages(images: readonly ProductImage[]): CachedImage[] {
  const out: CachedImage[] = [];
  for (const i of images) {
    if (!isMediaUrl(i.url)) continue;
    const c: CachedImage = { url: i.url, width: i.width, height: i.height, role: i.role, primary: i.primary };
    if (i.mask !== undefined && isMediaUrl(i.mask.url)) c.maskUrl = i.mask.url;
    if (i.bottomMarginFrac !== undefined) c.bottomMarginFrac = i.bottomMarginFrac;
    if (i.contactBand !== undefined) c.contactBand = { centerXFrac: i.contactBand.centerXFrac, widthFrac: i.contactBand.widthFrac };
    out.push(c);
  }
  return out;
}

/** The image to show for a figure: the primary, else the first. */
export function primaryImage(list: readonly CachedImage[]): CachedImage | undefined {
  return list.find((i) => i.primary) ?? list[0];
}

const browserCaches = (): CacheStorage | undefined => (typeof caches === 'undefined' ? undefined : caches);
// The origin answers Vary: Origin; an <img crossorigin> stores its request with an Origin, so a bare
// address finds (or deletes) it only ignoring Vary. The bytes are content-addressed: one per address.
const IGNORE_VARY: CacheQueryOptions = { ignoreVary: true };
const addressesOf = (list: readonly CachedImage[]): string[] => list.flatMap((i) => (i.maskUrl === undefined ? [i.url] : [i.url, i.maskUrl]));
const listKey = (headId: string): Request => new Request(new URL(`/__fc/image-list/${encodeURIComponent(headId)}`, self.location.href));
const headOfKey = (url: string): string => decodeURIComponent(new URL(url).pathname.slice('/__fc/image-list/'.length));
const WITHHELD_PATH = '/__fc/withheld/';
/** A withheld address's record: on the app's origin, so no cache holds the image's own address for it. */
export const withheldKey = (address: string): Request => new Request(new URL(`${WITHHELD_PATH}${encodeURIComponent(new URL(address).href)}`, self.location.href));
const addressOfWithheldKey = (url: string): string => decodeURIComponent(new URL(url).pathname.slice(WITHHELD_PATH.length));

/** Keep (or, for an empty list, forget) a figure's image list. */
export async function rememberImages(headId: string, list: readonly CachedImage[], storage: CacheStorage | undefined = browserCaches()): Promise<void> {
  if (storage === undefined) return;
  const cache = await storage.open(IMAGE_LISTS_CACHE);
  if (list.length === 0) await cache.delete(listKey(headId));
  else await cache.put(listKey(headId), new Response(JSON.stringify(list), { headers: { 'Content-Type': 'application/json' } }));
}

async function readList(records: Cache, headId: string): Promise<CachedImage[] | undefined> {
  const res = await records.match(listKey(headId));
  if (res === undefined) return undefined;
  try {
    return JSON.parse(await res.text()) as CachedImage[];
  } catch {
    return undefined;
  }
}

/** A figure's last image list, or undefined when none is kept. */
export async function recallImages(headId: string, storage: CacheStorage | undefined = browserCaches()): Promise<CachedImage[] | undefined> {
  if (storage === undefined) return undefined;
  return readList(await storage.open(IMAGE_LISTS_CACHE), headId);
}

/**
 * Each figure's primary as kept, but only while its bytes are on the device: a kept list whose image
 * never cached (or was evicted) answers nothing, and the figure is drawn as its plate. An address a
 * sync recorded withheld is never answered, though a kept list still names it (another document's
 * sync between its record and its list replacement): the figure is drawn as its plate, or without
 * that mask. Reads only the figures that have a kept list, so a collection with no image costs two
 * cache calls, and the withheld record in two however many figures it answers.
 */
export async function keptImages(heads: readonly string[], storage: CacheStorage | undefined = browserCaches()): Promise<Map<string, CachedImage>> {
  const out = new Map<string, CachedImage>();
  if (storage === undefined) return out;
  const records = await storage.open(IMAGE_LISTS_CACHE);
  const recorded = new Set((await records.keys()).map((k) => headOfKey(k.url)));
  const wanted = heads.filter((h) => recorded.has(h));
  if (wanted.length === 0) return out;
  const media = await storage.open(OWNED_MEDIA_CACHE);
  const withheld = new Set((await (await storage.open(WITHHELD_CACHE)).keys()).map((k) => addressOfWithheldKey(k.url)));
  for (const head of wanted) {
    const image = primaryImage((await readList(records, head)) ?? []);
    if (image === undefined || withheld.has(image.url) || (await media.match(image.url, IGNORE_VARY)) === undefined) continue;
    if (image.maskUrl !== undefined && withheld.has(image.maskUrl)) {
      const { maskUrl: _withheld, ...rest } = image;
      out.set(head, rest);
    } else out.set(head, image);
  }
  return out;
}

/** One figure's kept image (keptImages). */
export async function keptImage(headId: string, storage: CacheStorage | undefined = browserCaches()): Promise<CachedImage | undefined> {
  return (await keptImages([headId], storage)).get(headId);
}

/** The addresses among these that a sync withheld and no later sync carried again. */
export async function withheldAmong(addresses: readonly string[], storage: CacheStorage | undefined = browserCaches()): Promise<Set<string>> {
  const out = new Set<string>();
  if (storage === undefined) return out;
  const records = await storage.open(WITHHELD_CACHE);
  for (const address of addresses) if ((await records.match(withheldKey(address))) !== undefined) out.add(address);
  return out;
}

/** The client's slice of CatalogService.GetProductImages. */
export interface ImageListClient {
  getProductImages(
    request: { headIds: string[]; pageSize?: number; pageToken?: string },
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<{ products: { headId: string; images: ProductImage[] }[]; nextPageToken: string }>;
}

/**
 * Every head's image list, in batches of 200 heads and pages of IMAGE_PAGE_SIZE rows, every page
 * followed, a head's rows joined across pages. An aborted signal stops it between calls and aborts the
 * call in flight; a call the coordinator has not answered within OWNED_SYNC_STEP_MS fails it.
 */
export async function fetchImageLists(client: ImageListClient, heads: readonly string[], signal?: AbortSignal): Promise<Map<string, ProductImage[]>> {
  const out = new Map<string, ProductImage[]>();
  for (let i = 0; i < heads.length; i += MAX_HEADS_PER_CALL) {
    const headIds = heads.slice(i, i + MAX_HEADS_PER_CALL);
    let pageToken = '';
    for (let pages = 0; ; pages += 1) {
      signal?.throwIfAborted();
      // Over the budget the sync fails before it touches a cache: nothing is evicted, so a kept image a
      // fresh list would now withhold stays until a sync completes (an F6 follow-up of ADDR-1).
      if (pages === MAX_IMAGE_PAGES) throw new Error(`GetProductImages did not end within ${MAX_IMAGE_PAGES} pages`);
      const request = pageToken === '' ? { headIds, pageSize: IMAGE_PAGE_SIZE } : { headIds, pageSize: IMAGE_PAGE_SIZE, pageToken };
      const res = await client.getProductImages(request, signal === undefined ? { timeoutMs: OWNED_SYNC_STEP_MS } : { signal, timeoutMs: OWNED_SYNC_STEP_MS });
      for (const p of res.products) out.set(p.headId, [...(out.get(p.headId) ?? []), ...p.images]);
      pageToken = res.nextPageToken;
      if (pageToken === '') break;
    }
  }
  return out;
}

interface SyncOptions {
  storage?: CacheStorage | undefined;
  max?: number;
  concurrency?: number;
  signal?: AbortSignal;
  /** How long to wait for another document's sync (OWNED_SYNC_WAIT_MS). */
  lockWaitMs?: number;
  /** Called each time the sync has written the record of an address it withholds. */
  onRecorded?: () => void;
}

/**
 * Bring the caches to the owned figures: fetch their lists, replace every record, drop the records
 * of figures no longer owned, then keep exactly each figure's primary image and its mask, fetching
 * what is missing (`concurrency` at a time) and deleting what nothing references. Every address a
 * record named before and no fresh list carries is deleted from the worker's browsed cache too.
 *
 * One document of the app at a time (a tab, the installed window): the sync holds the Web Lock
 * OWNED_SYNC_LOCK from before it reads the lists until its last cache write, so a sync that read the
 * lists later also writes later, and one that read older lists never undoes what a later one
 * withheld. It waits at most `lockWaitMs` for another document's, then fails having asked and
 * touched nothing. Every image fetch carries the sync's signal, so the case view going away aborts
 * the fetches in flight (and fetchImageLists' call), and the sync lets go of the lock once they
 * end and a cache write under way finishes. An image fetch that receives nothing (its headers, a byte
 * of its body) for OWNED_SYNC_STEP_MS is abandoned and no other starts after it; what is still missing
 * is fetched at a later sync that the link brings bytes to. So the sync lets go of the lock at most
 * that long after its fetches in flight stop receiving anything, or a cache write finishes, whichever
 * is later, its case view open or not; while their bytes keep coming, however slowly, it fetches on,
 * and a slow but working link keeps every image. A write is not bounded: a slow one holds the lock.
 * Where the browser has no Web Locks (an older browser, a page not served securely), syncs are not
 * serialised, as before the lock: two documents syncing at once can finish in the other order, and
 * the one that read older lists then undoes, until the next sync, what the other withheld.
 */
export async function syncOwnedImages(
  ownedHeads: readonly string[],
  fetchLists: (heads: readonly string[]) => Promise<Map<string, ProductImage[]>>,
  options: SyncOptions = {},
): Promise<OwnedImageSync> {
  const storage = 'storage' in options ? options.storage : browserCaches();
  if (storage === undefined) return { figures: 0, images: 0, added: 0, evicted: 0, failed: 0 };
  const locks = (navigator as { locks?: LockManager }).locks;
  if (locks === undefined) return bringToOwned(ownedHeads, fetchLists, storage, options);
  const wait = new AbortController();
  const timer = setTimeout(
    () => wait.abort(new DOMException('another document of the app is still syncing', 'TimeoutError')),
    options.lockWaitMs ?? OWNED_SYNC_WAIT_MS,
  );
  const stop = () => wait.abort(options.signal?.reason);
  if (options.signal?.aborted === true) stop();
  options.signal?.addEventListener('abort', stop, { once: true });
  try {
    // Once the lock is granted, the browser ignores the signal (Web Locks): the timer stops nothing more.
    return await locks.request(OWNED_SYNC_LOCK, { signal: wait.signal }, () => bringToOwned(ownedHeads, fetchLists, storage, options));
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', stop);
  }
}

/** One body of the chunks a reader read, in order. */
function joined(chunks: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

async function bringToOwned(
  ownedHeads: readonly string[],
  fetchLists: (heads: readonly string[]) => Promise<Map<string, ProductImage[]>>,
  storage: CacheStorage,
  options: SyncOptions,
): Promise<OwnedImageSync> {
  const result: OwnedImageSync = { figures: 0, images: 0, added: 0, evicted: 0, failed: 0 };
  const heads = [...new Set(ownedHeads)].slice(0, options.max ?? MAX_OWNED_FIGURES);
  const lists = await fetchLists(heads);
  // Cancelled (the case view went away, or a newer sync replaced this one): no cache is touched.
  options.signal?.throwIfAborted();

  // Every address the device holds for an owned figure before this sync: each record's, each kept byte's.
  const records = await storage.open(IMAGE_LISTS_CACHE);
  const media = await storage.open(OWNED_MEDIA_CACHE);
  const recordKeys = await records.keys();
  const before = new Set<string>();
  const beforeOf = new Map<string, string[]>();
  for (const key of recordKeys) {
    const addresses = addressesOf((await readList(records, headOfKey(key.url))) ?? []);
    beforeOf.set(headOfKey(key.url), addresses);
    for (const u of addresses) before.add(u);
  }
  const mediaKeys = await media.keys();
  for (const key of mediaKeys) before.add(key.url);

  // A figure with no image costs nothing here: only a non-empty list is written, and every record
  // of a figure that is not kept (no image now, or no longer owned) is deleted below.
  const keep = new Set<string>();
  const kept = new Map<string, CachedImage[]>();
  const fresh = new Set<string>();
  for (const head of heads) {
    const list = toCachedImages(lists.get(head) ?? []);
    const primary = primaryImage(list);
    if (primary === undefined) continue;
    for (const u of addressesOf(list)) fresh.add(u);
    kept.set(head, list);
    keep.add(primary.url);
    if (primary.maskUrl !== undefined) keep.add(primary.maskUrl);
  }

  // Withheld: an address the kept list of a figure still owned named and no fresh list carries. It is
  // remembered before any kept list is replaced or any byte evicted, so a sync that stops part way
  // (a quota error, the page killed) loses no record of it, and the worker refuses it from then on
  // (src/sw.ts). An address a fresh list carries again is forgotten before any fetch below. When the
  // first record cannot be written, the sync fails here, having replaced and evicted nothing.
  const tomb = await storage.open(WITHHELD_CACHE);
  const remembered = (await tomb.keys()).map((k) => addressOfWithheldKey(k.url));
  const withheld = new Set<string>();
  for (const head of heads) for (const u of beforeOf.get(head) ?? []) if (!fresh.has(u)) withheld.add(u);
  for (const u of remembered) if (fresh.has(u)) await tomb.delete(withheldKey(u));
  // Oldest first. A withheld address was named by a list this sync replaced, so it is normally not
  // recorded yet; the Set keeps one of each.
  const recorded = new Set(remembered.filter((u) => !fresh.has(u)));
  const unrecorded = new Set(withheld);
  let refused: { error: unknown } | undefined;
  try {
    for (const u of withheld) {
      await tomb.put(withheldKey(u), new Response(null));
      unrecorded.delete(u);
      recorded.add(u);
      options.onRecorded?.();
    }
  } catch (error) {
    if (unrecorded.size === withheld.size) throw error;
    // Another was recorded: the deletes below run, then the sync fails.
    refused = { error };
  }
  const oldestFirst = [...recorded];
  for (const u of oldestFirst.slice(0, Math.max(0, oldestFirst.length - MAX_WITHHELD))) await tomb.delete(withheldKey(u));

  // Deletes need no quota, and every one comes before the first kept list is written: what this sync
  // withholds, and what it no longer keeps, leaves the device even when a later write fails. The kept
  // list of a figure no longer kept, or that names a recorded address, is deleted, unless it names one
  // the device refused to record: the next sync records that from it.
  for (const key of recordKeys) {
    const head = headOfKey(key.url);
    const names = beforeOf.get(head) ?? [];
    if ((!kept.has(head) || names.some((u) => recorded.has(u))) && !names.some((u) => unrecorded.has(u))) await records.delete(key);
  }
  const have = new Set<string>();
  for (const key of mediaKeys) {
    if (keep.has(key.url)) have.add(key.url);
    else if (await media.delete(key, IGNORE_VARY)) result.evicted += 1;
  }
  // From the worker's browsed cache: every address gone since the last sync, and every withheld one
  // remembered, so a refill after the sync that withheld it goes at the next.
  const sweep = new Set([...before].filter((u) => !fresh.has(u)));
  for (const u of recorded) sweep.add(u);
  if (sweep.size > 0) {
    const browsed = await storage.open(BROWSED_MEDIA_CACHE);
    for (const key of await browsed.keys()) if (sweep.has(key.url)) await browsed.delete(key, IGNORE_VARY);
  }
  if (refused !== undefined) throw refused.error;

  for (const [head, list] of kept) {
    // Cancelled (the case view went away): no other kept list is written, and nothing is fetched.
    options.signal?.throwIfAborted();
    await records.put(listKey(head), new Response(JSON.stringify(list), { headers: { 'Content-Type': 'application/json' } }));
  }
  const missing = [...keep].filter((u) => !have.has(u));
  // Each fetch is aborted when the sync's signal aborts, or when it has received nothing (its headers,
  // a byte of its body) for OWNED_SYNC_STEP_MS; then the link is taken as stalled and no other fetch
  // starts. Only an ok answer with a body is kept (Cache.add kept any ok one), once all of it arrived.
  let stalled = false;
  const workers = Array.from({ length: Math.max(1, options.concurrency ?? 4) }, async () => {
    for (let next = missing.shift(); next !== undefined && options.signal?.aborted !== true && !stalled; next = missing.shift()) {
      const step = new AbortController();
      let quiet: ReturnType<typeof setTimeout> | undefined;
      const heard = () => {
        clearTimeout(quiet);
        quiet = setTimeout(() => {
          stalled = true;
          step.abort(new DOMException('the image link sent nothing in time', 'TimeoutError'));
        }, OWNED_SYNC_STEP_MS);
      };
      const stop = () => step.abort(options.signal?.reason);
      options.signal?.addEventListener('abort', stop, { once: true });
      try {
        heard();
        const request = new Request(next, { mode: 'cors', credentials: 'omit', cache: 'no-store', signal: step.signal });
        const res = await fetch(request);
        heard();
        if (!res.ok || res.body === null) throw new TypeError(`the image link answered ${res.status} without an image`);
        const chunks: Uint8Array[] = [];
        const reader = res.body.getReader();
        for (let read = await reader.read(); !read.done; read = await reader.read()) {
          heard();
          chunks.push(read.value);
        }
        // All of it arrived: a slow write here is not a stalled link.
        clearTimeout(quiet);
        await media.put(request, new Response(joined(chunks), { status: res.status, statusText: res.statusText, headers: res.headers }));
        result.added += 1;
      } catch {
        result.failed += 1;
      } finally {
        clearTimeout(quiet);
        options.signal?.removeEventListener('abort', stop);
      }
    }
  });
  await Promise.all(workers);
  result.figures = kept.size;
  result.images = keep.size;
  return result;
}

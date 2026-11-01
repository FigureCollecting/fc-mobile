// ADDR-1: the image, mask and grounding of the KEPT figures, kept so the case view renders offline: every
// figure in the collection, owned, ordered or wished (src/hooks/useCollectionImages.ts), owned first.
//
//   fc-image-lists-v1   one record per kept figure: its image list as the coordinator last sent it
//                       (address, size, role, primary, mask address, grounding). A fresh list REPLACES
//                       the record (catalog.proto DISPLAY RESTRICTIONS).
//   fc-owned-media-v1   the bytes of each kept figure's primary image and its mask, fetched by a CORS
//                       request without credentials that neither reads nor fills the browser's HTTP
//                       cache (cache 'no-store': the origin answers immutable, and a copy there would
//                       outlive an eviction here). The service worker reads this cache FIRST for the
//                       public image address and sends this fetch to the origin without storing it
//                       (src/sw.ts). The sync stores the bytes here only; an image an <img> showed
//                       before its figure was kept stays in fc-derivatives-v2 too, until the sync
//                       evicts it (e2e/pwa (b)).
//   fc-derivatives-v2   the worker's cache of what an <img> showed (BROWSED_MEDIA_CACHE). The sync
//                       deletes from it too every address a kept list named and the fresh lists no
//                       longer carry, and every withheld address recorded below.
//   fc-withheld-v1      one record per address withheld from a figure still kept (its kept list
//                       named it, no fresh list carries it): keyed on the app's origin, no bytes, at
//                       most MAX_WITHHELD, the oldest dropped first. Written before any kept list is
//                       replaced or any byte evicted, so a sync that stops part way keeps it; then
//                       its bytes and its shown copy are deleted (deletes need no quota), and every
//                       kept list naming it is replaced, or deleted where the device refuses that
//                       write, before any other kept list is written, so a write refused or a case
//                       view gone after that leaves none of them. A record the device refuses, the
//                       first or a later one, still lets every delete run, then the sync fails,
//                       keeping the kept list naming the address it could not record for the next
//                       sync to record: that address's bytes and shown copy are gone, so no kept
//                       answer names it as an image, but a withheld mask is still named with its
//                       figure's kept image until that sync. An address a fresh list carries again
//                       is forgotten before any fetch.
//                       The worker refuses a recorded address (src/sw.ts), and neither keptImages
//                       nor useProductImage online answers it, until a fresh list carries it again.
//
// So at each sync, an image or a mask a display restriction now withholds from an kept figure, or
// that belonged to a figure no longer kept, is deleted from the kept and browsed caches, a withheld
// one recorded first and the kept lists naming it replaced, all before any other kept list is written:
// a write refused after that, or the case view going away, leaves none. A refill of the browsed cache
// after that sync is deleted at the next.
// A figure no longer kept is not recorded: its figure page asks the coordinator, as for any figure
// not kept. Both kept caches hold exactly the kept figures (at most MAX_KEPT_FIGURES of them).
// Where the browser has Web Locks, the documents of the app sync one at a time (syncKeptImages). A list
// call of a sync ends within KEPT_SYNC_STEP_MS, an image fetch once it has received nothing for that
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
import type { PhotoChoices } from './photoChoice';

/** The kept bytes. Named when only owned figures were kept; unchanged, so what a device kept stays valid. */
export const OWNED_MEDIA_CACHE = 'fc-owned-media-v1';
export const IMAGE_LISTS_CACHE = 'fc-image-lists-v1';
/** The service worker's cache of the images an <img> showed (src/sw.ts). */
export const BROWSED_MEDIA_CACHE = 'fc-derivatives-v2';
/** The bound on figures kept for offline: ~2 images each. */
export const MAX_KEPT_FIGURES = 1500;
/** The addresses a sync withheld from a figure still kept: one record each, no bytes (withheldKey). */
export const WITHHELD_CACHE = 'fc-withheld-v1';
/** The bound on the withheld addresses remembered (a full collection's images and masks); the oldest go first. */
export const MAX_WITHHELD = 2 * MAX_KEPT_FIGURES;
/**
 * The most GetProductImages pages one batch may take: a server that never ends is a fault. At
 * IMAGE_PAGE_SIZE rows a page, that is 50 images a figure for a batch of 200 figures.
 */
export const MAX_IMAGE_PAGES = 50;
/** The largest page the coordinator serves (catalog.proto: 0 is its default of 50 rows, capped at 200). */
export const IMAGE_PAGE_SIZE = 200;
const MAX_HEADS_PER_CALL = 200;
/** The Web Lock every document of the app syncs the kept images under: one name across builds (so still 'owned'). */
export const OWNED_SYNC_LOCK = 'fc-owned-sync';
/**
 * How long a sync waits for another document's before it fails, having asked and touched nothing (what
 * the last sync kept then stands). The other lets go when it completes or fails. When its case view
 * goes away, it lets go once its fetches in flight end and the cache work under way is done: a write,
 * or, once it has read the lists, reading the kept lists, recording and deleting what it withholds or
 * no longer keeps and replacing the kept lists that named what it withholds, which an abort never cuts
 * short; it writes no other kept list and starts no fetch after. And at most KEPT_SYNC_STEP_MS after
 * its fetches in flight stop receiving anything, or a cache write finishes, whichever is later
 * (syncKeptImages). While their bytes keep coming (a large first sync, a slow link), or a write is
 * slow, it holds the lock, and this wait runs out first. A document whose sync failed here answers from
 * what was kept, the other's sync told to it or not, until a sync of its own: its case view opened
 * again once its answer is ten minutes old, or the kept figures or the reach changing. So a takedown
 * the other's lists did not carry yet lands there only then, as one between two documents' list reads
 * does.
 */
export const KEPT_SYNC_WAIT_MS = 10_000;
/**
 * The longest a GetProductImages call of a sync may take, and the longest an image fetch may go
 * without receiving anything (its headers, a byte of its body). A list call past it fails the sync; an
 * image fetch that receives nothing for that long is abandoned, and no other starts after it.
 */
export const KEPT_SYNC_STEP_MS = 20_000;

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

export interface KeptImageSync {
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

/**
 * GALLERY-1: the image to show for a figure whose user may have chosen one (photoChoice.ts): the chosen image while the
 * list names it, else the primary. A choice the list no longer names (taken down, or never there) is no choice.
 */
export function shownImage(list: readonly CachedImage[], choice?: string): CachedImage | undefined {
  return (choice === undefined ? undefined : list.find((i) => i.url === choice)) ?? primaryImage(list);
}

/** Where a figure's shown image stands in line to be answered: the chosen one first, the primary (what it showed before) after it. */
const answerable = (list: readonly CachedImage[], choice: string | undefined): CachedImage[] => {
  const first = shownImage(list, choice);
  const primary = primaryImage(list);
  return first === undefined ? [] : primary === undefined || primary === first ? [first] : [first, primary];
};

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
 * GALLERY-1: a figure whose user chose a photo answers it once its bytes are here, and the primary until then (or when the
 * chosen one is withheld), so a choice never leaves the figure as its plate while the chosen photo comes.
 */
export async function keptImages(
  heads: readonly string[],
  storage: CacheStorage | undefined = browserCaches(),
  choices?: PhotoChoices,
): Promise<Map<string, CachedImage>> {
  const out = new Map<string, CachedImage>();
  if (storage === undefined) return out;
  const records = await storage.open(IMAGE_LISTS_CACHE);
  const recorded = new Set((await records.keys()).map((k) => headOfKey(k.url)));
  const wanted = heads.filter((h) => recorded.has(h));
  if (wanted.length === 0) return out;
  const media = await storage.open(OWNED_MEDIA_CACHE);
  const withheld = new Set((await (await storage.open(WITHHELD_CACHE)).keys()).map((k) => addressOfWithheldKey(k.url)));
  for (const head of wanted) {
    for (const image of answerable((await readList(records, head)) ?? [], choices?.get(head))) {
      if (withheld.has(image.url) || (await media.match(image.url, IGNORE_VARY)) === undefined) continue;
      if (image.maskUrl !== undefined && withheld.has(image.maskUrl)) {
        const { maskUrl: _withheld, ...rest } = image;
        out.set(head, rest);
      } else out.set(head, image);
      break;
    }
  }
  return out;
}

/** One figure's kept image (keptImages). */
export async function keptImage(headId: string, storage: CacheStorage | undefined = browserCaches(), choices?: PhotoChoices): Promise<CachedImage | undefined> {
  return (await keptImages([headId], storage, choices)).get(headId);
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
 * call in flight; a call the coordinator has not answered within KEPT_SYNC_STEP_MS fails it.
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
      const res = await client.getProductImages(request, signal === undefined ? { timeoutMs: KEPT_SYNC_STEP_MS } : { signal, timeoutMs: KEPT_SYNC_STEP_MS });
      for (const p of res.products) out.set(p.headId, [...(out.get(p.headId) ?? []), ...p.images]);
      pageToken = res.nextPageToken;
      if (pageToken === '') break;
    }
  }
  return out;
}

interface SyncOptions {
  storage?: CacheStorage | undefined;
  /** GALLERY-1: the photo the user chose per figure (photoChoice.ts): kept with its mask beside the primary, and shown once its bytes are here. */
  choices?: PhotoChoices;
  max?: number;
  concurrency?: number;
  signal?: AbortSignal;
  /** How long to wait for another document's sync (KEPT_SYNC_WAIT_MS). */
  lockWaitMs?: number;
  /** Called once the sync has read the lists, its signal not aborted, before it touches any cache. */
  onListsRead?: () => void;
  /**
   * Told what the device keeps for the kept figures, as keptImages answers it: once every kept list is
   * written, and again as each image lands, so a case view shows them while the rest still come.
   */
  onKept?: (kept: ReadonlyMap<string, CachedImage>) => void;
  /**
   * FETCH-FIRST: the heads whose missing images to fetch first, in this order (the case view's: the figures it shows, then
   * the rest as it stands them), asked as each fetch starts, so a view that moves is followed from the next fetch on. The
   * other kept figures' come after, in the order kept. It orders the fetches only: what is kept is the same either way.
   */
  first?: () => readonly string[];
}

/**
 * Bring the caches to the kept figures: fetch their lists, record what they withhold, delete what
 * nothing references any more (bytes, the kept list of a figure no longer kept), replace the kept lists
 * that named a recorded address, then write every other figure's fresh list and keep exactly each
 * figure's primary image and its mask, fetching what is missing (`concurrency` at a time). Every
 * address a record named before and no fresh list carries is deleted from the worker's browsed cache
 * too, before any list is written. A record the device refuses, even the first, fails the sync once
 * the deletes ran. `onListsRead` is told once the lists arrived with the signal not aborted, before
 * any cache is touched: from then on the caller tells the sync's end, however it ends.
 *
 * One document of the app at a time (a tab, the installed window): the sync holds the Web Lock
 * OWNED_SYNC_LOCK from before it reads the lists until its last cache write, so a sync that read the
 * lists later also writes later, and one that read older lists never undoes what a later one
 * withheld. It waits at most `lockWaitMs` for another document's, then fails having asked and
 * touched nothing. Every image fetch carries the sync's signal, so the case view going away aborts
 * the fetches in flight (and fetchImageLists' call), and the sync lets go of the lock once they
 * end and the cache work under way is done (KEPT_SYNC_WAIT_MS): it writes no other kept list and
 * starts no fetch after. An image fetch that receives nothing (its headers, a byte of its body) for
 * KEPT_SYNC_STEP_MS is abandoned and no other starts after it; what is still missing is fetched at a
 * later sync that the link brings bytes to. So the sync lets go of the lock at most that long after
 * its fetches in flight stop receiving anything, or a cache write finishes, whichever is later, its
 * case view open or not; while their bytes keep coming, however slowly, it fetches on, and a slow but
 * working link keeps every image. A write is not bounded: a slow one holds the lock.
 * Where the browser has no Web Locks (an older browser, a page not served securely), syncs are not
 * serialised, as before the lock: two documents syncing at once can finish in the other order, and
 * the one that read older lists then undoes, until the next sync, what the other withheld.
 */
export async function syncKeptImages(
  keptHeads: readonly string[],
  fetchLists: (heads: readonly string[]) => Promise<Map<string, ProductImage[]>>,
  options: SyncOptions = {},
): Promise<KeptImageSync> {
  const storage = 'storage' in options ? options.storage : browserCaches();
  if (storage === undefined) return { figures: 0, images: 0, added: 0, evicted: 0, failed: 0 };
  const locks = (navigator as { locks?: LockManager }).locks;
  if (locks === undefined) return bringToKept(keptHeads, fetchLists, storage, options);
  const wait = new AbortController();
  const timer = setTimeout(
    () => wait.abort(new DOMException('another document of the app is still syncing', 'TimeoutError')),
    options.lockWaitMs ?? KEPT_SYNC_WAIT_MS,
  );
  const stop = () => wait.abort(options.signal?.reason);
  if (options.signal?.aborted === true) stop();
  options.signal?.addEventListener('abort', stop, { once: true });
  try {
    // Once the lock is granted, the browser ignores the signal (Web Locks): the timer stops nothing more.
    return await locks.request(OWNED_SYNC_LOCK, { signal: wait.signal }, () => bringToKept(keptHeads, fetchLists, storage, options));
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', stop);
  }
}

/** FETCH-FIRST: no head to fetch first, one array for every fetch, so the order is not worked out again at each. */
const NO_HEADS: readonly string[] = [];

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

/**
 * One image into the owned cache, fetched as the sync fetches each: CORS, no credentials, past the HTTP cache, and kept only
 * when the answer is ok with a body, once all of it arrived. Aborted when `signal` aborts, or when it has received nothing
 * (its headers, a byte of its body) for KEPT_SYNC_STEP_MS, `onStall` told first. Throws when nothing was kept.
 */
async function fetchKept(media: Cache, address: string, signal: AbortSignal | undefined, onStall: () => void): Promise<void> {
  const step = new AbortController();
  let quiet: ReturnType<typeof setTimeout> | undefined;
  const heard = () => {
    clearTimeout(quiet);
    quiet = setTimeout(() => {
      onStall();
      step.abort(new DOMException('the image link sent nothing in time', 'TimeoutError'));
    }, KEPT_SYNC_STEP_MS);
  };
  const stop = () => step.abort(signal?.reason);
  signal?.addEventListener('abort', stop, { once: true });
  try {
    heard();
    const request = new Request(address, { mode: 'cors', credentials: 'omit', cache: 'no-store', signal: step.signal });
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
  } finally {
    clearTimeout(quiet);
    signal?.removeEventListener('abort', stop);
  }
}

/**
 * PICK-CASE-1 (Ross 10-31: he chose a photo with no cut-out, and the case went on drawing the default cut-out): the photo the
 * user chose for each of these figures, and its mask, fetched into the owned cache now when their bytes are not on the device,
 * from the list the device kept for the figure. A choice so reaches the case within an image fetch, never only through a sync
 * that reads every kept figure's list again first: that takes tens of seconds for a large collection, and one list call that
 * fails (a 503) ends it before it fetches anything. A figure with no kept list, a choice its kept list does not name, and an
 * address a sync withheld are left to the sync. The sync keeps what this fetched (the chosen photo and its mask are in what it
 * keeps), so nothing is fetched twice. Not under the sync's lock: another document's sync that read the choices before this one
 * may evict what it fetched, which the sync this document runs next fetches again. Answers how many it kept.
 */
export async function keepChosenPhotos(
  heads: readonly string[],
  choices: PhotoChoices,
  options: { storage?: CacheStorage | undefined; signal?: AbortSignal } = {},
): Promise<number> {
  const storage = 'storage' in options ? options.storage : browserCaches();
  const chosen = heads.filter((h) => choices.has(h));
  if (storage === undefined || chosen.length === 0) return 0;
  const records = await storage.open(IMAGE_LISTS_CACHE);
  const media = await storage.open(OWNED_MEDIA_CACHE);
  const tomb = await storage.open(WITHHELD_CACHE);
  let kept = 0;
  for (const head of chosen) {
    const image = ((await readList(records, head)) ?? []).find((i) => i.url === choices.get(head));
    // a photo a sync withheld is not shown: neither it nor its mask is fetched
    if (image === undefined || (await tomb.match(withheldKey(image.url))) !== undefined) continue;
    for (const address of addressesOf([image])) {
      if (options.signal?.aborted === true) return kept;
      // here already, or a withheld mask (the photo is shown without it)
      if ((await media.match(address, IGNORE_VARY)) !== undefined || (await tomb.match(withheldKey(address))) !== undefined) continue;
      try {
        await fetchKept(media, address, options.signal, () => {});
        kept += 1;
      } catch {
        // not kept now: the sync fetches it
      }
    }
  }
  return kept;
}

async function bringToKept(
  keptHeads: readonly string[],
  fetchLists: (heads: readonly string[]) => Promise<Map<string, ProductImage[]>>,
  storage: CacheStorage,
  options: SyncOptions,
): Promise<KeptImageSync> {
  const result: KeptImageSync = { figures: 0, images: 0, added: 0, evicted: 0, failed: 0 };
  const heads = [...new Set(keptHeads)].slice(0, options.max ?? MAX_KEPT_FIGURES);
  const lists = await fetchLists(heads);
  // Cancelled (the case view went away, or a newer sync replaced this one): no cache is touched.
  options.signal?.throwIfAborted();
  options.onListsRead?.();

  // Every address the device holds for a kept figure before this sync: each record's, each kept byte's.
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
  // of a figure that is not kept (no image now, or no longer kept) is deleted below.
  const keep = new Set<string>();
  const kept = new Map<string, CachedImage[]>();
  const fresh = new Set<string>();
  // the kept figures each kept address is shown for (FETCH-FIRST: it is fetched where the first of them comes)
  const shownFor = new Map<string, string[]>();
  const keepFor = (u: string, head: string) => {
    keep.add(u);
    shownFor.set(u, [...(shownFor.get(u) ?? []), head]);
  };
  for (const head of heads) {
    const list = toCachedImages(lists.get(head) ?? []);
    const shown = answerable(list, options.choices?.get(head));
    if (shown.length === 0) continue;
    for (const u of addressesOf(list)) fresh.add(u);
    kept.set(head, list);
    // the chosen photo and the primary it replaces (shown till the chosen one is here), each with its mask
    for (const image of shown) {
      keepFor(image.url, head);
      if (image.maskUrl !== undefined) keepFor(image.maskUrl, head);
    }
  }

  // Withheld: an address the kept list of a figure still kept named and no fresh list carries. It is
  // remembered before any kept list is replaced or any byte evicted, so a sync that stops part way
  // (a quota error, the page killed) loses no record of it, and the worker refuses it from then on
  // (src/sw.ts). An address a fresh list carries again is forgotten before any fetch below. When a
  // record cannot be written, the first or a later one, the deletes below still run, then the sync
  // fails.
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
    }
  } catch (error) {
    // The deletes below run, then the sync fails.
    refused = { error };
  }
  const oldestFirst = [...recorded];
  for (const u of oldestFirst.slice(0, Math.max(0, oldestFirst.length - MAX_WITHHELD))) await tomb.delete(withheldKey(u));

  // Deletes need no quota, and every one comes before the first kept list is written: what this sync
  // withholds, and what it no longer keeps, leaves the device even when a later write fails. The kept
  // list of a figure no longer kept is deleted, and when a record was refused, so is one that names a
  // recorded address; but not one that names an address the device refused to record: the next sync
  // records that from it. That address's bytes and shown copy are deleted all the same (keptImages
  // then answers no image of it; a mask of it stays named with its figure's image until then).
  const namesRecorded = (head: string) => (beforeOf.get(head) ?? []).some((u) => recorded.has(u));
  for (const key of recordKeys) {
    const head = headOfKey(key.url);
    const names = beforeOf.get(head) ?? [];
    if ((!kept.has(head) || (refused !== undefined && namesRecorded(head))) && !names.some((u) => unrecorded.has(u))) await records.delete(key);
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

  const listOf = (list: readonly CachedImage[]) => new Response(JSON.stringify(list), { headers: { 'Content-Type': 'application/json' } });
  // A kept list naming a recorded address is replaced next, the case view gone or not; one the device
  // refuses to write is deleted instead, with every such list not written yet, and the sync fails. So
  // no kept list names a recorded address once these writes end, however the sync ends.
  const replaced = [...kept.keys()].filter(namesRecorded);
  const replacedFirst = new Set(replaced);
  let at = 0;
  try {
    for (; at < replaced.length; at += 1) await records.put(listKey(replaced[at]!), listOf(kept.get(replaced[at]!)!));
  } catch (error) {
    for (const head of replaced.slice(at)) await records.delete(listKey(head));
    throw error;
  }
  for (const [head, list] of kept) {
    if (replacedFirst.has(head)) continue;
    // Cancelled (the case view went away): no other kept list is written, and nothing is fetched.
    options.signal?.throwIfAborted();
    await records.put(listKey(head), listOf(list));
  }
  const missing = [...keep].filter((u) => !have.has(u));
  // FETCH-FIRST: the next address to fetch, those of the heads `first` names first, in its order, then the rest as kept
  const keptAt = new Map(missing.map((u, i) => [u, i]));
  let orderedBy: readonly string[] | undefined;
  const take = (): string | undefined => {
    const first = options.first?.() ?? NO_HEADS;
    if (first !== orderedBy) {
      orderedBy = first;
      const rank = new Map<string, number>();
      first.forEach((head, i) => {
        if (!rank.has(head)) rank.set(head, i);
      });
      const at = new Map(missing.map((u) => [u, Math.min(...shownFor.get(u)!.map((head) => rank.get(head) ?? first.length))]));
      missing.sort((a, b) => at.get(a)! - at.get(b)! || keptAt.get(a)! - keptAt.get(b)!);
    }
    return missing.shift();
  };
  // Each fresh list's primary whose bytes are here (none of them is withheld): what keptImages would answer now.
  const tellKept = () => {
    if (options.onKept === undefined) return;
    const now = new Map<string, CachedImage>();
    for (const [head, list] of kept) {
      const image = answerable(list, options.choices?.get(head)).find((i) => have.has(i.url));
      if (image !== undefined) now.set(head, image);
    }
    options.onKept(now);
  };
  tellKept();
  // Each fetch is aborted when the sync's signal aborts, or when it has received nothing (its headers,
  // a byte of its body) for KEPT_SYNC_STEP_MS; then the link is taken as stalled and no other fetch
  // starts. Only an ok answer with a body is kept (Cache.add kept any ok one), once all of it arrived.
  let stalled = false;
  const workers = Array.from({ length: Math.max(1, options.concurrency ?? 4) }, async () => {
    for (let next = take(); next !== undefined && options.signal?.aborted !== true && !stalled; next = take()) {
      try {
        await fetchKept(media, next, options.signal, () => (stalled = true));
        result.added += 1;
        have.add(next);
        tellKept();
      } catch {
        result.failed += 1;
      }
    }
  });
  await Promise.all(workers);
  result.figures = kept.size;
  result.images = keep.size;
  return result;
}

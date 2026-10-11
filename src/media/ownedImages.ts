// ADDR-1: the image, mask and grounding of the OWNED figures, kept so the case view renders offline.
//
//   fc-image-lists-v1   one record per owned figure: its image list as the coordinator last sent it
//                       (address, size, role, primary, mask address, grounding). A fresh list REPLACES
//                       the record, so an image or a mask a display restriction now withholds is gone
//                       from the device at the next sync (catalog.proto DISPLAY RESTRICTIONS).
//   fc-owned-media-v1   the bytes of each owned figure's primary image and its mask, fetched by a CORS
//                       request without credentials. The service worker reads it FIRST for the public
//                       image address (src/sw.ts).
//
// Both hold exactly the owned figures (at most MAX_OWNED_FIGURES of them): a figure that leaves the
// collection leaves both caches at the next sync. Nothing here is ever sent anywhere.
import type { ProductImage } from '@figurecollecting/fc-api-contract';
import { isMediaUrl } from './address';

export const OWNED_MEDIA_CACHE = 'fc-owned-media-v1';
export const IMAGE_LISTS_CACHE = 'fc-image-lists-v1';
/** The bound on figures kept for offline: ~2 images each. */
export const MAX_OWNED_FIGURES = 1500;
const MAX_IMAGE_PAGES = 50;
const MAX_HEADS_PER_CALL = 200;

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
const listKey = (headId: string): Request => new Request(new URL(`/__fc/image-list/${encodeURIComponent(headId)}`, self.location.href));
const headOfKey = (url: string): string => decodeURIComponent(new URL(url).pathname.slice('/__fc/image-list/'.length));

/** Keep (or, for an empty list, forget) a figure's image list. */
export async function rememberImages(headId: string, list: readonly CachedImage[], storage: CacheStorage | undefined = browserCaches()): Promise<void> {
  if (storage === undefined) return;
  const cache = await storage.open(IMAGE_LISTS_CACHE);
  if (list.length === 0) await cache.delete(listKey(headId));
  else await cache.put(listKey(headId), new Response(JSON.stringify(list), { headers: { 'Content-Type': 'application/json' } }));
}

/** A figure's last image list, or undefined when none is kept. */
export async function recallImages(headId: string, storage: CacheStorage | undefined = browserCaches()): Promise<CachedImage[] | undefined> {
  if (storage === undefined) return undefined;
  const res = await (await storage.open(IMAGE_LISTS_CACHE)).match(listKey(headId));
  if (res === undefined) return undefined;
  try {
    return JSON.parse(await res.text()) as CachedImage[];
  } catch {
    return undefined;
  }
}

/** The client's slice of CatalogService.GetProductImages. */
export interface ImageListClient {
  getProductImages(request: { headIds: string[]; pageToken?: string }): Promise<{ products: { headId: string; images: ProductImage[] }[]; nextPageToken: string }>;
}

/** Every head's image list, in batches of 200 heads, every page followed, a head's rows joined across pages. */
export async function fetchImageLists(client: ImageListClient, heads: readonly string[]): Promise<Map<string, ProductImage[]>> {
  const out = new Map<string, ProductImage[]>();
  for (let i = 0; i < heads.length; i += MAX_HEADS_PER_CALL) {
    const headIds = heads.slice(i, i + MAX_HEADS_PER_CALL);
    let pageToken = '';
    for (let pages = 0; ; pages += 1) {
      if (pages === MAX_IMAGE_PAGES) throw new Error(`GetProductImages did not end within ${MAX_IMAGE_PAGES} pages`);
      const res = await client.getProductImages(pageToken === '' ? { headIds } : { headIds, pageToken });
      for (const p of res.products) out.set(p.headId, [...(out.get(p.headId) ?? []), ...p.images]);
      pageToken = res.nextPageToken;
      if (pageToken === '') break;
    }
  }
  return out;
}

/**
 * Bring both caches to the owned figures: fetch their lists, replace every record, drop the records
 * of figures no longer owned, then keep exactly each figure's primary image and its mask, fetching
 * what is missing (`concurrency` at a time) and deleting what nothing references.
 */
export async function syncOwnedImages(
  ownedHeads: readonly string[],
  fetchLists: (heads: readonly string[]) => Promise<Map<string, ProductImage[]>>,
  options: { storage?: CacheStorage | undefined; max?: number; concurrency?: number } = {},
): Promise<OwnedImageSync> {
  const storage = 'storage' in options ? options.storage : browserCaches();
  const result: OwnedImageSync = { figures: 0, images: 0, added: 0, evicted: 0, failed: 0 };
  if (storage === undefined) return result;
  const heads = [...new Set(ownedHeads)].slice(0, options.max ?? MAX_OWNED_FIGURES);
  const lists = await fetchLists(heads);

  const keep = new Set<string>();
  const kept = new Set<string>();
  for (const head of heads) {
    const list = toCachedImages(lists.get(head) ?? []);
    await rememberImages(head, list, storage);
    const primary = primaryImage(list);
    if (primary === undefined) continue;
    kept.add(head);
    keep.add(primary.url);
    if (primary.maskUrl !== undefined) keep.add(primary.maskUrl);
  }
  const records = await storage.open(IMAGE_LISTS_CACHE);
  for (const key of await records.keys()) if (!kept.has(headOfKey(key.url))) await records.delete(key);

  const media = await storage.open(OWNED_MEDIA_CACHE);
  const have = new Set<string>();
  for (const key of await media.keys()) {
    if (keep.has(key.url)) have.add(key.url);
    else if (await media.delete(key)) result.evicted += 1;
  }
  const missing = [...keep].filter((u) => !have.has(u));
  const workers = Array.from({ length: Math.max(1, options.concurrency ?? 4) }, async () => {
    for (let next = missing.shift(); next !== undefined; next = missing.shift()) {
      try {
        await media.add(new Request(next, { mode: 'cors', credentials: 'omit' }));
        result.added += 1;
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

// GALLERY-1 (Ross 10-18): every photo of a figure, for its Photos tab. In reach, what GetProductImages sends (the derivative of
// every captured photo, each with its mask when it has one), on the public image address only (src/media/address.ts); out of
// reach, or when that call fails, the list the last image sync kept (src/media/keptImages.ts), and when it failed the answer
// says so (PHOTOS-FIND-1). Never an address a sync withheld, or a mask of one, and the answer joins the other image answers so
// a sync that withholds one drops it from here too (src/hooks/imageAnswers.ts). The primary first, then the coordinator's order.
import { useQuery } from '@tanstack/react-query';
import type { ProductImage } from '@figurecollecting/fc-api-contract';
import { localSession, type OnlineClients } from '../local/session';
import { useAuthPhase } from '../local/useLocal';
import { useOnlineStatus } from './useOnlineStatus';
import { recallImages, toCachedImages, withheldAmong, type CachedImage } from '../media/keptImages';
import { IMAGE_ASK_TIMEOUT_MS } from './useProductImage';
import { hearKeptSyncs } from './imageAnswers';
import { fixturePhotos, getFixturePhotos, isFixtureMode } from '../dev-fixtures/fixtures';

/** A figure's photos, and whether they are the kept list because the coordinator could not be asked (the Photos tab says so). */
export interface ProductPhotos {
  photos: CachedImage[];
  refreshFailed: boolean;
}

/** PHOTOS-FIND-1: at most this many pages of one figure's photos are read (the coordinator sends 50 to a page by default). */
export const PHOTO_PAGES_MAX = 10;

const primaryFirst = (list: readonly CachedImage[]): CachedImage[] => [...list.filter((i) => i.primary), ...list.filter((i) => !i.primary)];

/**
 * PHOTOS-FIND-1: every page of one head's photos, up to PHOTO_PAGES_MAX. The coordinator answers under the head the spine
 * resolves, so a head merged into another comes back under that one: this head's own product when the answer has it, else the
 * one product the answer has, else none.
 */
async function askPhotos(catalog: OnlineClients['catalog'], headId: string, signal: AbortSignal): Promise<ProductImage[]> {
  const byHead = new Map<string, ProductImage[]>();
  let pageToken = '';
  for (let page = 0; page < PHOTO_PAGES_MAX; page++) {
    const res = await catalog.getProductImages(pageToken === '' ? { headIds: [headId] } : { headIds: [headId], pageToken }, { signal, timeoutMs: IMAGE_ASK_TIMEOUT_MS });
    for (const p of res.products) byHead.set(p.headId, [...(byHead.get(p.headId) ?? []), ...p.images]);
    pageToken = res.nextPageToken;
    if (pageToken === '') break;
  }
  return byHead.get(headId) ?? (byHead.size === 1 ? [...byHead.values()][0]! : []);
}

export function useProductPhotos(headId: string | undefined) {
  const session = localSession.value;
  const phase = useAuthPhase();
  const online = useOnlineStatus().value;
  const reachable = online && session?.engine.state.value.reachability !== 'unreachable';
  // the dev fixtures' Photos tab (?fxphotos=1): three photos each (or ?fxphotocount=), no session, no coordinator
  const fixture = isFixtureMode() && getFixturePhotos();
  return useQuery<ProductPhotos>({
    queryKey: ['local', 'photos', headId, reachable, fixture],
    queryFn: async ({ signal, client }) => {
      if (fixture) return { photos: fixturePhotos(), refreshFailed: false };
      hearKeptSyncs(client);
      let list: CachedImage[];
      let refreshFailed = false;
      if (!reachable) list = (await recallImages(headId!)) ?? [];
      else {
        try {
          list = toCachedImages(await askPhotos(session!.clients.catalog, headId!, signal));
        } catch {
          // The server did not answer: the list the last sync kept stands, and the Photos tab says it could not refresh.
          list = (await recallImages(headId!)) ?? [];
          refreshFailed = true;
        }
      }
      // An address a sync withheld is not answered until a sync carries it again; a withheld mask goes with its mask only.
      const withheld = await withheldAmong(list.flatMap((i) => (i.maskUrl === undefined ? [i.url] : [i.url, i.maskUrl])));
      const photos = primaryFirst(
        list
          .filter((i) => !withheld.has(i.url))
          .map((i) => {
            if (i.maskUrl === undefined || !withheld.has(i.maskUrl)) return i;
            const { maskUrl: _withheld, ...rest } = i;
            return rest;
          }),
      );
      return { photos, refreshFailed };
    },
    enabled: headId !== undefined && (fixture || (session !== undefined && phase === 'signed-in')),
    staleTime: 10 * 60_000,
    retry: false,
  });
}

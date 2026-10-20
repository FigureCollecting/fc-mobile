// GALLERY-1 (Ross 10-18): every photo of a figure, for its Photos tab. In reach, what GetProductImages sends (the derivative of
// every captured photo, each with its mask when it has one), on the public image address only (src/media/address.ts); out of
// reach, or when that call fails, the list the last image sync kept (src/media/keptImages.ts). Never an address a sync
// withheld, or a mask of one, and the answer joins the other image answers so a sync that withholds one drops it from here too
// (src/hooks/imageAnswers.ts). The primary first, then the coordinator's order.
import { useQuery } from '@tanstack/react-query';
import { localSession } from '../local/session';
import { useAuthPhase } from '../local/useLocal';
import { useOnlineStatus } from './useOnlineStatus';
import { recallImages, toCachedImages, withheldAmong, type CachedImage } from '../media/keptImages';
import { IMAGE_ASK_TIMEOUT_MS } from './useProductImage';
import { hearKeptSyncs } from './imageAnswers';
import { fixturePhotos, getFixturePhotos, isFixtureMode } from '../dev-fixtures/fixtures';

const primaryFirst = (list: readonly CachedImage[]): CachedImage[] => [...list.filter((i) => i.primary), ...list.filter((i) => !i.primary)];

export function useProductPhotos(headId: string | undefined) {
  const session = localSession.value;
  const phase = useAuthPhase();
  const online = useOnlineStatus().value;
  const reachable = online && session?.engine.state.value.reachability !== 'unreachable';
  // the dev fixtures' Photos tab (?fxphotos=1): three photos each, no session, no coordinator
  const fixture = isFixtureMode() && getFixturePhotos();
  return useQuery<CachedImage[]>({
    queryKey: ['local', 'photos', headId, reachable, fixture],
    queryFn: async ({ signal, client }) => {
      if (fixture) return fixturePhotos();
      hearKeptSyncs(client);
      let list: CachedImage[];
      if (!reachable) list = (await recallImages(headId!)) ?? [];
      else {
        try {
          const res = await session!.clients.catalog.getProductImages({ headIds: [headId!] }, { signal, timeoutMs: IMAGE_ASK_TIMEOUT_MS });
          list = toCachedImages(res.products.find((p) => p.headId === headId)?.images ?? []);
        } catch {
          // The server did not answer: the list the last sync kept stands.
          list = (await recallImages(headId!)) ?? [];
        }
      }
      // An address a sync withheld is not answered until a sync carries it again; a withheld mask goes with its mask only.
      const withheld = await withheldAmong(list.flatMap((i) => (i.maskUrl === undefined ? [i.url] : [i.url, i.maskUrl])));
      return primaryFirst(
        list
          .filter((i) => !withheld.has(i.url))
          .map((i) => {
            if (i.maskUrl === undefined || !withheld.has(i.maskUrl)) return i;
            const { maskUrl: _withheld, ...rest } = i;
            return rest;
          }),
      );
    },
    enabled: headId !== undefined && (fixture || (session !== undefined && phase === 'signed-in')),
    staleTime: 10 * 60_000,
    retry: false,
  });
}

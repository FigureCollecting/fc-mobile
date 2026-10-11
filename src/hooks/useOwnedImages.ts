// ADDR-1: each owned figure's image for the case view, online and offline. Signed in and in reach (the
// browser online AND the sync engine not finding the server unreachable), the caches are brought to
// the owned figures (src/media/ownedImages.ts: their lists replaced, their primary images and masks
// fetched, everything else evicted, a withheld address recorded); out of reach, or when that sync
// fails, what the last one kept stands and nothing more is asked. A figure answers the image the last
// sync kept, and only if its bytes were on the device when asked; one without is absent, and the case
// draws its plate. Once a sync completes, no earlier answer of this hook or of useProductImage stands,
// offline or online: one a view shows is asked again, any other is dropped, so neither answers an
// image that sync withheld (src/hooks/__tests__/imageAnswersAfterSync.test.tsx). A collection with no
// image costs a few cache calls, not a few per figure, and a sync stops when the case view goes away.
import { hashKey, useQuery, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { useCallback } from 'preact/hooks';
import { localSession } from '../local/session';
import { useAuthPhase, useSnapshot, type Snapshot } from '../local/useLocal';
import { fetchImageLists, keptImages, syncOwnedImages, MAX_OWNED_FIGURES, type CachedImage } from '../media/ownedImages';
import { useOnlineStatus } from './useOnlineStatus';

const EMPTY: ReadonlyMap<string, CachedImage> = new Map();

/**
 * After a completed sync, no earlier image answer stands: of this hook (for any reachability or
 * collection) or of useProductImage (['local', 'image', ...]). One a view shows now is asked again;
 * any other is dropped, so a view that opens later asks too. The sync's own answer is the exception.
 */
function dropImageAnswers(client: QueryClient, own: QueryKey): void {
  const ownHash = hashKey(own);
  const earlier = (q: { queryKey: QueryKey; queryHash: string }) =>
    q.queryHash !== ownHash && q.queryKey[0] === 'local' && (q.queryKey[1] === 'owned-images' || q.queryKey[1] === 'image');
  client.removeQueries({ type: 'inactive', predicate: earlier });
  void client.invalidateQueries({ predicate: earlier });
}

export function useOwnedImages(): ReadonlyMap<string, CachedImage> {
  const session = localSession.value;
  const phase = useAuthPhase();
  const online = useOnlineStatus().value;
  const reachable = online && session?.engine.state.value.reachability !== 'unreachable';
  const ownedHeads = useCallback(
    (s: Snapshot): string[] => [...new Set(s.figures.filter((f) => f.local.kind === 'owned').map((f) => f.local.headId))].sort(),
    [],
  );
  const heads = useSnapshot(ownedHeads).data;
  const query = useQuery<ReadonlyMap<string, CachedImage>>({
    queryKey: ['local', 'owned-images', reachable, heads?.join(',') ?? ''],
    // The query's signal is consumed, so a sync stops (its call in flight aborted, no cache touched)
    // when the case view goes away or a newer one replaces it.
    queryFn: async ({ signal, client, queryKey }) => {
      const owned = (heads ?? []).slice(0, MAX_OWNED_FIGURES);
      if (reachable) {
        try {
          await syncOwnedImages(owned, (h) => fetchImageLists(session!.clients.catalog, h, signal), { signal });
          dropImageAnswers(client, queryKey);
        } catch (err) {
          if (signal.aborted) throw err;
          // The server did not answer (UNAVAILABLE, a fault, a lost connection): what the last sync kept stands.
        }
      }
      return keptImages(owned);
    },
    enabled: session !== undefined && phase === 'signed-in' && heads !== undefined,
    staleTime: 10 * 60_000,
    retry: false,
  });
  return query.data ?? EMPTY;
}

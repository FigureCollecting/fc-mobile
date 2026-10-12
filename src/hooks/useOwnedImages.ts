// ADDR-1: each owned figure's image for the case view, online and offline. Signed in and in reach (the
// browser online AND the sync engine not finding the server unreachable), the caches are brought to
// the owned figures (src/media/ownedImages.ts: their lists replaced, their primary images and masks
// fetched, everything else evicted, a withheld address recorded); out of reach, or when that sync
// fails, what the last one kept stands and nothing more is asked. A figure answers the image the last
// sync kept, and only if its bytes were on the device when asked and no sync recorded it withheld; one
// without is absent, and the case draws its plate. Once a sync completes, no earlier answer of this hook or of useProductImage stands,
// offline or online, in the document that ran it or in any other open document of the app, each told
// on a BroadcastChannel (src/hooks/imageAnswers.ts): one being read is read again, one a view shows is
// asked again, any other is dropped, so neither answers an image that sync withheld
// (src/hooks/__tests__/imageAnswersAfterSync.test.tsx). An answer a view shows that names an address
// that sync withheld stops naming it before it is asked again, not once the coordinator answers. A
// case view told of another document's sync answers from what it kept, without a sync of its own.
// Where the browser has Web Locks, documents sync one at a time (src/media/ownedImages.ts), so a sync
// that read older lists never undoes what a later one withheld. A collection with no image costs a few
// cache calls, not a few per figure, and a sync stops when the case view goes away (its fetches in
// flight aborted) or a step of it stalls (src/media/ownedImages.ts OWNED_SYNC_STEP_MS).
import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'preact/hooks';
import { localSession } from '../local/session';
import { useAuthPhase, useSnapshot, type Snapshot } from '../local/useLocal';
import { fetchImageLists, keptImages, syncOwnedImages, MAX_OWNED_FIGURES, type CachedImage } from '../media/ownedImages';
import { answersFromKept, dropImageAnswers, hearOwnedSyncs, tellOwnedSync } from './imageAnswers';
import { useOnlineStatus } from './useOnlineStatus';

const EMPTY: ReadonlyMap<string, CachedImage> = new Map();

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
    // The query's signal is consumed, so a sync stops when the case view goes away or a newer one
    // replaces it: aborted while it reads the lists, it touches no cache; while it fetches images, the
    // fetches in flight are aborted and no other starts.
    queryFn: async ({ signal, client, queryKey }) => {
      hearOwnedSyncs(client);
      const owned = (heads ?? []).slice(0, MAX_OWNED_FIGURES);
      if (reachable && !answersFromKept(client, queryKey)) {
        try {
          await syncOwnedImages(owned, (h) => fetchImageLists(session!.clients.catalog, h, signal), { signal });
          void dropImageAnswers(client, queryKey);
          tellOwnedSync(client);
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

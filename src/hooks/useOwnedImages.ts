// ADDR-1: each owned figure's image for the case view, online and offline. Signed in and in reach (the
// browser online AND the sync engine not finding the server unreachable), the caches are brought to
// the owned figures (src/media/ownedImages.ts: their lists replaced, their primary images and masks
// fetched, everything else evicted); out of reach, or when that sync fails, what the last one kept
// stands and nothing more is asked. A figure answers its image only while the bytes are on the device;
// one without is absent, and the case draws its plate.
import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'preact/hooks';
import { localSession } from '../local/session';
import { useAuthPhase, useSnapshot, type Snapshot } from '../local/useLocal';
import { fetchImageLists, keptImage, syncOwnedImages, MAX_OWNED_FIGURES, type CachedImage } from '../media/ownedImages';
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
    queryFn: async () => {
      const owned = (heads ?? []).slice(0, MAX_OWNED_FIGURES);
      if (reachable) {
        try {
          await syncOwnedImages(owned, (h) => fetchImageLists(session!.clients.catalog, h));
        } catch {
          // The server did not answer (UNAVAILABLE, a fault, a lost connection): what the last sync kept stands.
        }
      }
      const out = new Map<string, CachedImage>();
      for (const head of owned) {
        const image = await keptImage(head);
        if (image !== undefined) out.set(head, image);
      }
      return out;
    },
    enabled: session !== undefined && phase === 'signed-in' && heads !== undefined,
    staleTime: 10 * 60_000,
    retry: false,
  });
  return query.data ?? EMPTY;
}

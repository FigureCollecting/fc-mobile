// ADDR-1: each owned figure's image for the case view, online and offline. Signed in and online,
// the caches are brought to the owned figures (src/media/ownedImages.ts: their lists replaced, their
// primary images and masks fetched, everything else evicted); offline, the kept lists answer and
// nothing is asked. A figure with no kept image is absent: the case draws its plate.
import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'preact/hooks';
import { localSession } from '../local/session';
import { useAuthPhase, useSnapshot, type Snapshot } from '../local/useLocal';
import { fetchImageLists, primaryImage, recallImages, syncOwnedImages, MAX_OWNED_FIGURES, type CachedImage } from '../media/ownedImages';
import { useOnlineStatus } from './useOnlineStatus';

const EMPTY: ReadonlyMap<string, CachedImage> = new Map();

export function useOwnedImages(): ReadonlyMap<string, CachedImage> {
  const session = localSession.value;
  const phase = useAuthPhase();
  const online = useOnlineStatus().value;
  const ownedHeads = useCallback(
    (s: Snapshot): string[] => [...new Set(s.figures.filter((f) => f.local.kind === 'owned').map((f) => f.local.headId))].sort(),
    [],
  );
  const heads = useSnapshot(ownedHeads).data;
  const query = useQuery<ReadonlyMap<string, CachedImage>>({
    queryKey: ['local', 'owned-images', online, heads?.join(',') ?? ''],
    queryFn: async () => {
      const owned = (heads ?? []).slice(0, MAX_OWNED_FIGURES);
      if (online) await syncOwnedImages(owned, (h) => fetchImageLists(session!.clients.catalog, h));
      const out = new Map<string, CachedImage>();
      for (const head of owned) {
        const image = primaryImage((await recallImages(head)) ?? []);
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

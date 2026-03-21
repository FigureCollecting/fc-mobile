import { useQuery } from '@tanstack/react-query';
import { getFigureStats } from '@figurecollecting/fc-shared';
import type { StatsData } from '@figurecollecting/fc-shared';
import { api } from '../api/client';
import { useAuthStore } from '../stores/auth';
import { getCachedFigures } from '../storage/figureCache';

interface CollectionCounts {
  owned: number;
  ordered: number;
  wished: number;
  total: number;
}

/**
 * Fetch collection stats from the API.
 * Falls back to counting cached figures when offline.
 */
export function useCollectionStats() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return useQuery<CollectionCounts>({
    queryKey: ['collectionStats'],
    queryFn: async () => {
      try {
        const stats: StatsData = await getFigureStats(api);
        return {
          owned: stats.statusCounts.owned,
          ordered: stats.statusCounts.ordered,
          wished: stats.statusCounts.wished,
          total: stats.totalCount,
        };
      } catch {
        // Fallback: count from IndexedDB cache
        const [owned, ordered, wished] = await Promise.all([
          getCachedFigures('owned'),
          getCachedFigures('ordered'),
          getCachedFigures('wished'),
        ]);
        return {
          owned: owned.length,
          ordered: ordered.length,
          wished: wished.length,
          total: owned.length + ordered.length + wished.length,
        };
      }
    },
    enabled: isAuthenticated,
    staleTime: 120_000, // 2 minutes
  });
}

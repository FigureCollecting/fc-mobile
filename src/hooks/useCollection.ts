import { useQuery } from '@tanstack/react-query';
import { getFigures } from '@figurecollecting/fc-shared';
import type { Figure, PaginatedResponse, CollectionStatus } from '@figurecollecting/fc-shared';
import { api } from '../api/client';
import { useAuthStore } from '../stores/auth';
import { cacheFigures, getCachedFigures, setMetadata } from '../storage/figureCache';

interface UseCollectionOptions {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  status?: CollectionStatus;
}

export function useCollection(options: UseCollectionOptions = {}) {
  const { page = 1, limit = 20, sortBy = 'activity', sortOrder = 'asc', status } = options;
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return useQuery<PaginatedResponse<Figure>>({
    queryKey: ['collection', { page, limit, sortBy, sortOrder, status }],
    queryFn: async () => {
      try {
        const response = await getFigures(api, page, limit, sortBy, sortOrder, status);
        // Cache figures to IndexedDB on successful fetch
        await cacheFigures(response.data);
        await setMetadata('lastFetch', Date.now());
        return response;
      } catch (error) {
        // If the fetch fails, try serving from IndexedDB cache
        const cached = await getCachedFigures(status);
        if (cached.length > 0) {
          return {
            success: true,
            data: cached.slice((page - 1) * limit, page * limit),
            count: cached.length,
            page,
            pages: Math.ceil(cached.length / limit),
            total: cached.length,
          };
        }
        throw error;
      }
    },
    enabled: isAuthenticated,
    staleTime: 60_000,
  });
}

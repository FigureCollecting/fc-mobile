import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getFigureById } from '@figurecollecting/fc-shared';
import type { Figure, PaginatedResponse } from '@figurecollecting/fc-shared';
import { api } from '../api/client';
import { useAuthStore } from '../stores/auth';
import { getCachedFigure } from '../storage/figureCache';

export function useFigure(id: string | undefined) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const queryClient = useQueryClient();

  return useQuery<Figure>({
    queryKey: ['figure', id],
    queryFn: async () => {
      try {
        return await getFigureById(api, id!);
      } catch (error) {
        // Fall back to IndexedDB cache if API fetch fails
        const cached = await getCachedFigure(id!);
        if (cached) return cached;
        throw error;
      }
    },
    enabled: isAuthenticated && !!id,
    staleTime: 60_000,
    placeholderData: () => {
      // Check if this figure is already in a collection query cache
      const queries = queryClient.getQueriesData<PaginatedResponse<Figure>>({
        queryKey: ['collection'],
      });
      for (const [, data] of queries) {
        const match = data?.data?.find((f) => f._id === id);
        if (match) return match;
      }
      return undefined;
    },
  });
}

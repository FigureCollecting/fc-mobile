import { useQuery } from '@tanstack/react-query';
import { getFigures } from '@figurecollecting/fc-shared';
import type { Figure, PaginatedResponse, CollectionStatus } from '@figurecollecting/fc-shared';
import { api } from '../api/client';
import { useAuthStore } from '../stores/auth';

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
    queryFn: () => getFigures(api, page, limit, sortBy, sortOrder, status),
    enabled: isAuthenticated,
    staleTime: 60_000, // 1 minute
  });
}

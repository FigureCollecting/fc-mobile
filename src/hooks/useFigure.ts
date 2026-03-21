import { useQuery } from '@tanstack/react-query';
import { getFigureById } from '@figurecollecting/fc-shared';
import type { Figure } from '@figurecollecting/fc-shared';
import { api } from '../api/client';
import { useAuthStore } from '../stores/auth';

export function useFigure(id: string | undefined) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return useQuery<Figure>({
    queryKey: ['figure', id],
    queryFn: () => getFigureById(api, id!),
    enabled: isAuthenticated && !!id,
    staleTime: 60_000,
  });
}

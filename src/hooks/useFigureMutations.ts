import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateFigure, deleteFigure } from '@figurecollecting/fc-shared';
import type { Figure, FigureFormData, PaginatedResponse } from '@figurecollecting/fc-shared';
import { api } from '../api/client';
import { useOnlineStatus } from './useOnlineStatus';
import { queueOperation } from '../storage/pendingOps';

export function useUpdateFigure() {
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<FigureFormData> }) => {
      if (!isOnline.value) {
        await queueOperation({ type: 'update', figureId: id, data });

        // Optimistically update the figure query cache
        const current = queryClient.getQueryData<Figure>(['figure', id]);
        if (current) {
          const updated = applyFormDataToFigure(current, data);
          queryClient.setQueryData(['figure', id], updated);
        }

        // Optimistically update collection query caches
        queryClient.setQueriesData<PaginatedResponse<Figure>>(
          { queryKey: ['collection'] },
          (old) => {
            if (!old) return old;
            return {
              ...old,
              data: old.data.map((f) =>
                f._id === id ? applyFormDataToFigure(f, data) : f,
              ),
            };
          },
        );

        return current ?? ({} as Figure);
      }

      return updateFigure(api, id, data as FigureFormData);
    },
    onSuccess: (_result, { id }) => {
      if (isOnline.value) {
        queryClient.invalidateQueries({ queryKey: ['figure', id] });
        queryClient.invalidateQueries({ queryKey: ['collection'] });
        queryClient.invalidateQueries({ queryKey: ['stats'] });
      }
    },
  });
}

export function useDeleteFigure() {
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();

  return useMutation({
    mutationFn: async (id: string) => {
      if (!isOnline.value) {
        await queueOperation({ type: 'delete', figureId: id });

        // Optimistically remove from collection cache
        queryClient.setQueriesData<PaginatedResponse<Figure>>(
          { queryKey: ['collection'] },
          (old) => {
            if (!old) return old;
            return {
              ...old,
              data: old.data.filter((f) => f._id !== id),
              total: old.total - 1,
              count: old.count - 1,
            };
          },
        );

        return;
      }

      return deleteFigure(api, id);
    },
    onSuccess: () => {
      if (isOnline.value) {
        queryClient.invalidateQueries({ queryKey: ['collection'] });
        queryClient.invalidateQueries({ queryKey: ['stats'] });
      }
    },
  });
}

export function useBulkUpdateStatus() {
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();

  return useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: string }) => {
      const data: Partial<FigureFormData> = { collectionStatus: status as FigureFormData['collectionStatus'] };

      if (!isOnline.value) {
        for (const id of ids) {
          await queueOperation({ type: 'update', figureId: id, data });
        }

        // Optimistically update collection cache
        queryClient.setQueriesData<PaginatedResponse<Figure>>(
          { queryKey: ['collection'] },
          (old) => {
            if (!old) return old;
            return {
              ...old,
              data: old.data.map((f) =>
                ids.includes(f._id)
                  ? { ...f, collectionStatus: status as Figure['collectionStatus'] }
                  : f,
              ),
            };
          },
        );

        return;
      }

      // Online: update each figure individually
      await Promise.all(
        ids.map((id) => updateFigure(api, id, data as FigureFormData)),
      );
    },
    onSuccess: () => {
      if (isOnline.value) {
        queryClient.invalidateQueries({ queryKey: ['collection'] });
        queryClient.invalidateQueries({ queryKey: ['stats'] });
      }
    },
  });
}

export function useBulkDelete() {
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();

  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (!isOnline.value) {
        for (const id of ids) {
          await queueOperation({ type: 'delete', figureId: id });
        }

        // Optimistically remove from collection cache
        queryClient.setQueriesData<PaginatedResponse<Figure>>(
          { queryKey: ['collection'] },
          (old) => {
            if (!old) return old;
            const idSet = new Set(ids);
            return {
              ...old,
              data: old.data.filter((f) => !idSet.has(f._id)),
              total: old.total - ids.length,
              count: old.count - ids.length,
            };
          },
        );

        return;
      }

      await Promise.all(ids.map((id) => deleteFigure(api, id)));
    },
    onSuccess: () => {
      if (isOnline.value) {
        queryClient.invalidateQueries({ queryKey: ['collection'] });
        queryClient.invalidateQueries({ queryKey: ['stats'] });
      }
    },
  });
}

/** Map FigureFormData fields back to Figure shape for optimistic updates */
function applyFormDataToFigure(figure: Figure, data: Partial<FigureFormData>): Figure {
  const updated = { ...figure };

  if (data.collectionStatus !== undefined) updated.collectionStatus = data.collectionStatus;
  if (data.note !== undefined) updated.note = data.note;
  if (data.purchasePrice !== undefined || data.purchaseCurrency !== undefined || data.purchaseDate !== undefined) {
    updated.purchaseInfo = {
      ...updated.purchaseInfo,
      ...(data.purchasePrice !== undefined ? { price: data.purchasePrice } : {}),
      ...(data.purchaseCurrency !== undefined ? { currency: data.purchaseCurrency } : {}),
      ...(data.purchaseDate !== undefined ? { date: data.purchaseDate } : {}),
    };
  }

  return updated;
}

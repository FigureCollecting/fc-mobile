// The whole collection from the local store (WK-15): every item, with no page cap and no request.
// One item per figure and kind; `status` picks a tab, the No longer owned tab ('former') included.
// Without one, every held item (former copies are not in the collection).
import { useCallback, useEffect } from 'preact/hooks';
import type { UseQueryResult } from '@tanstack/react-query';
import type { CollectionStatus, PaginatedResponse } from '@figurecollecting/fc-shared';
import type { LocalFigure } from '../local/figures';
import { useSnapshot, type Snapshot } from '../local/useLocal';
import { markHydrated } from '../pwa/storage';

export type CollectionTab = CollectionStatus | 'former';

interface UseCollectionOptions {
  /** Kept for the pages' signatures; the local store has no pages. */
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  status?: CollectionTab;
}

export function useCollection(options: UseCollectionOptions = {}): UseQueryResult<PaginatedResponse<LocalFigure>> {
  const { status } = options;
  const select = useCallback(
    (s: Snapshot): PaginatedResponse<LocalFigure> => {
      const data = s.figures.filter((f) => (status === undefined ? f.local.kind !== 'former' : f.local.kind === status));
      return { success: true, data, count: data.length, total: data.length, page: 1, pages: 1 };
    },
    [status],
  );
  const query = useSnapshot(select);
  const any = (query.data?.total ?? 0) > 0;
  useEffect(() => {
    // First local data: ask the browser not to evict it.
    if (any) void markHydrated();
  }, [any]);
  return query;
}

// The whole collection from the local store (WK-15): every item, with no page cap and no request.
// One item per figure and kind; `status` picks a tab, the No longer owned tab ('former') included.
// Without one, every held item (former copies are not in the collection).
import { useCallback, useEffect } from 'preact/hooks';
import type { UseQueryResult } from '@tanstack/react-query';
import type { CollectionStatus, PaginatedResponse } from '@figurecollecting/fc-shared';
import type { CollectionView } from '../sync/occurrences';
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

const countKinds = (s: Snapshot): Record<CollectionTab, number> => {
  const counts: Record<CollectionTab, number> = { owned: 0, ordered: 0, wished: 0, former: 0 };
  for (const f of s.figures) counts[f.local.kind] += 1;
  return counts;
};

/** Items per tab, for the tab bar. */
export function useCollectionCounts(): Record<CollectionTab, number> | undefined {
  return useSnapshot(countKinds).data;
}

const listCollections = (s: Snapshot): CollectionView[] => s.collections;

/** The collections a copy can be filed in: the four defaults and every live user collection. */
export function useCollections(): CollectionView[] {
  return useSnapshot(listCollections).data ?? [];
}

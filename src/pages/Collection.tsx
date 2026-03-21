import { useState, useCallback } from 'preact/hooks';
import { Header } from '../components/layout/Header';
import { CollectionGrid } from '../components/collection/CollectionGrid';
import { FigureCard } from '../components/collection/FigureCard';
import { SkeletonCard } from '../components/ui/SkeletonCard';
import { PullToRefresh } from '../components/ui/PullToRefresh';
import { FilterSheet, DEFAULT_FILTERS } from '../components/collection/FilterSheet';
import { StatusSheet } from '../components/collection/StatusSheet';
import { DeleteSheet } from '../components/collection/DeleteSheet';
import type { FilterState } from '../components/collection/FilterSheet';
import type { CollectionStatus } from '@figurecollecting/fc-shared';
import { useCollection } from '../hooks/useCollection';
import { useAuthStore } from '../stores/auth';
import { useMultiSelect } from '../hooks/useMultiSelect';
import { useBulkUpdateStatus, useBulkDelete } from '../hooks/useFigureMutations';
import { hapticMedium } from '../utils/haptics';

function FilterButton({ onClick, hasActiveFilters }: { onClick: () => void; hasActiveFilters: boolean }) {
  return (
    <button
      class="collection-filter-btn"
      onClick={onClick}
      type="button"
      aria-label="Filters"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
      </svg>
      {hasActiveFilters && <span class="collection-filter-btn__dot" />}

      <style>{`
        .collection-filter-btn {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          width: var(--touch-min);
          height: var(--touch-min);
          color: var(--text-secondary);
          border-radius: var(--radius-md);
          transition: color var(--transition-fast);
        }

        .collection-filter-btn:active {
          color: var(--text-primary);
          background: var(--surface-tertiary);
        }

        .collection-filter-btn__dot {
          position: absolute;
          top: 10px;
          right: 10px;
          width: 8px;
          height: 8px;
          background: var(--brand-500);
          border-radius: 50%;
        }
      `}</style>
    </button>
  );
}

export function Collection() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  const { isSelecting, selected, toggle, selectAll, enterSelectMode, exitSelectMode } = useMultiSelect();
  const bulkUpdateStatus = useBulkUpdateStatus();
  const bulkDelete = useBulkDelete();

  const hasActiveFilters =
    filters.statuses.length > 0 ||
    filters.manufacturer !== null ||
    filters.scale !== null ||
    filters.sortBy !== DEFAULT_FILTERS.sortBy ||
    filters.sortOrder !== DEFAULT_FILTERS.sortOrder;

  const { data, isLoading, isError, refetch } = useCollection({
    sortBy: filters.sortBy,
    sortOrder: filters.sortOrder,
    status: filters.statuses.length === 1 ? filters.statuses[0] : undefined,
  });

  const handleRefresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const handleApplyFilters = useCallback((newFilters: FilterState) => {
    setFilters(newFilters);
  }, []);

  const handleLongPress = useCallback(
    (id: string) => {
      hapticMedium();
      enterSelectMode(id);
    },
    [enterSelectMode],
  );

  const handleCardClick = useCallback(
    (id: string) => {
      if (isSelecting) {
        hapticMedium();
        toggle(id);
      }
    },
    [isSelecting, toggle],
  );

  const handleBulkStatusChange = useCallback(
    (status: CollectionStatus) => {
      const ids = Array.from(selected);
      bulkUpdateStatus.mutate(
        { ids, status },
        {
          onSuccess: () => {
            setBulkStatusOpen(false);
            exitSelectMode();
          },
        },
      );
    },
    [selected, bulkUpdateStatus, exitSelectMode],
  );

  const handleBulkDelete = useCallback(() => {
    const ids = Array.from(selected);
    bulkDelete.mutate(ids, {
      onSuccess: () => {
        setBulkDeleteOpen(false);
        exitSelectMode();
      },
    });
  }, [selected, bulkDelete, exitSelectMode]);

  const figures = data?.data ?? [];

  // Not logged in
  if (!isAuthenticated) {
    return (
      <div class="page-collection">
        <Header title="Collection" />
        <p class="page-collection__empty">
          Sign in to see your collection
        </p>
        <style>{styles}</style>
      </div>
    );
  }

  // Loading
  if (isLoading) {
    return (
      <div class="page-collection">
        <Header
          title="Collection"
          action={<FilterButton onClick={() => setFilterOpen(true)} hasActiveFilters={hasActiveFilters} />}
        />
        <CollectionGrid>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </CollectionGrid>
        <FilterSheet
          open={filterOpen}
          onClose={() => setFilterOpen(false)}
          filters={filters}
          onApply={handleApplyFilters}
        />
        <style>{styles}</style>
      </div>
    );
  }

  // Error
  if (isError) {
    return (
      <div class="page-collection">
        <Header title="Collection" />
        <PullToRefresh onRefresh={handleRefresh}>
          <p class="page-collection__empty">
            Failed to load collection. Pull down to retry.
          </p>
        </PullToRefresh>
        <style>{styles}</style>
      </div>
    );
  }

  // Empty collection
  if (figures.length === 0) {
    return (
      <div class="page-collection">
        <Header
          title="Collection"
          action={<FilterButton onClick={() => setFilterOpen(true)} hasActiveFilters={hasActiveFilters} />}
        />
        <PullToRefresh onRefresh={handleRefresh}>
          <p class="page-collection__empty">
            {hasActiveFilters
              ? 'No figures match your filters.'
              : 'Your collection is empty. Add figures to get started!'}
          </p>
        </PullToRefresh>
        <FilterSheet
          open={filterOpen}
          onClose={() => setFilterOpen(false)}
          filters={filters}
          onApply={handleApplyFilters}
        />
        <style>{styles}</style>
      </div>
    );
  }

  // Selection mode header action
  const headerAction = isSelecting ? (
    <div class="collection-select-actions">
      <button
        class="collection-select-actions__select-all"
        type="button"
        onClick={() => selectAll(figures.map((f) => f._id))}
      >
        All
      </button>
      <button
        class="collection-select-actions__cancel"
        type="button"
        onClick={exitSelectMode}
      >
        Cancel
      </button>
    </div>
  ) : (
    <FilterButton onClick={() => setFilterOpen(true)} hasActiveFilters={hasActiveFilters} />
  );

  // Collection with data
  return (
    <div class="page-collection">
      <Header
        title={isSelecting ? `${selected.size} selected` : `Collection (${data?.total ?? 0})`}
        action={headerAction}
      />
      <PullToRefresh onRefresh={handleRefresh}>
        <CollectionGrid>
          {figures.map((figure) => (
            <FigureCard
              key={figure._id}
              figure={figure}
              selectable={isSelecting}
              isSelected={selected.has(figure._id)}
              onLongPress={() => handleLongPress(figure._id)}
              onClick={isSelecting ? () => handleCardClick(figure._id) : undefined}
            />
          ))}
        </CollectionGrid>
      </PullToRefresh>

      {/* Multi-select bottom action bar */}
      {isSelecting && selected.size > 0 && (
        <div class="collection-bulk-bar">
          <button
            class="collection-bulk-bar__btn collection-bulk-bar__btn--status"
            type="button"
            onClick={() => setBulkStatusOpen(true)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
            <span>Status</span>
          </button>
          <button
            class="collection-bulk-bar__btn collection-bulk-bar__btn--delete"
            type="button"
            onClick={() => setBulkDeleteOpen(true)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 6h18" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
            <span>Delete</span>
          </button>
        </div>
      )}

      <FilterSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        filters={filters}
        onApply={handleApplyFilters}
      />

      {/* Bulk status sheet */}
      <StatusSheet
        open={bulkStatusOpen}
        onClose={() => setBulkStatusOpen(false)}
        onSelect={handleBulkStatusChange}
        isUpdating={bulkUpdateStatus.isPending}
        title={`Set Status (${selected.size} figures)`}
      />

      {/* Bulk delete sheet */}
      <DeleteSheet
        open={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        onConfirm={handleBulkDelete}
        isDeleting={bulkDelete.isPending}
        count={selected.size}
      />

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .page-collection__empty {
    text-align: center;
    color: var(--text-secondary);
    padding: var(--space-8) var(--space-4);
    font-size: var(--font-sm);
  }

  /* Selection header actions */
  .collection-select-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .collection-select-actions__select-all,
  .collection-select-actions__cancel {
    min-height: var(--touch-min);
    padding: var(--space-2) var(--space-3);
    font-size: var(--font-sm);
    font-weight: var(--font-weight-semibold);
    border-radius: var(--radius-md);
  }

  .collection-select-actions__select-all {
    color: var(--brand-400);
  }

  .collection-select-actions__cancel {
    color: var(--text-secondary);
  }

  /* Bulk action bar */
  .collection-bulk-bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    justify-content: space-around;
    background: var(--surface-secondary);
    border-top: 1px solid var(--border-subtle);
    padding: var(--space-2) var(--space-4);
    padding-bottom: calc(var(--space-2) + var(--safe-area-bottom));
    z-index: 50;
  }

  .collection-bulk-bar__btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    min-width: var(--touch-min);
    min-height: var(--touch-min);
    padding: var(--space-2);
    font-size: var(--font-xs);
    font-weight: var(--font-weight-medium);
    transition: color var(--transition-fast);
  }

  .collection-bulk-bar__btn--status {
    color: var(--brand-400);
  }

  .collection-bulk-bar__btn--delete {
    color: var(--accent-danger);
  }

  .collection-bulk-bar__btn:active {
    opacity: 0.7;
  }
`;

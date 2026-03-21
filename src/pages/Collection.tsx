import { useState, useCallback } from 'preact/hooks';
import { Header } from '../components/layout/Header';
import { CollectionGrid } from '../components/collection/CollectionGrid';
import { FigureCard } from '../components/collection/FigureCard';
import { SkeletonCard } from '../components/ui/SkeletonCard';
import { PullToRefresh } from '../components/ui/PullToRefresh';
import { FilterSheet, DEFAULT_FILTERS } from '../components/collection/FilterSheet';
import type { FilterState } from '../components/collection/FilterSheet';
import { useCollection } from '../hooks/useCollection';
import { useAuthStore } from '../stores/auth';

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

  const figures = data?.data ?? [];

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

  // Collection with data
  return (
    <div class="page-collection">
      <Header
        title={`Collection (${data?.total ?? 0})`}
        action={<FilterButton onClick={() => setFilterOpen(true)} hasActiveFilters={hasActiveFilters} />}
      />
      <PullToRefresh onRefresh={handleRefresh}>
        <CollectionGrid>
          {figures.map((figure) => (
            <FigureCard key={figure._id} figure={figure} />
          ))}
        </CollectionGrid>
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

const styles = `
  .page-collection__empty {
    text-align: center;
    color: var(--text-secondary);
    padding: var(--space-8) var(--space-4);
    font-size: var(--font-sm);
  }
`;

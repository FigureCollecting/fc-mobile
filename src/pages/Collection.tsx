import { useState, useCallback, useMemo } from 'preact/hooks';
import { useQuery } from '@tanstack/react-query';
import type { Figure } from '@figurecollecting/fc-shared';
import { SlimHeader } from '../components/layout/SlimHeader';
import { PullToRefresh } from '../components/ui/PullToRefresh';
import { ErrorState } from '../components/ui/ErrorState';
import { LastSyncedBadge } from '../components/ui/LastSyncedBadge';
import { CaseShelf } from '../components/display/CaseShelf';
import { JustifiedRows } from '../components/display/JustifiedRows';
import { DisplayToggle } from '../components/display/DisplayToggle';
import { FigureViewer } from '../components/display/FigureViewer';
import { FilterBar } from '../components/collection/FilterBar';
import { AppliedChips } from '../components/collection/AppliedChips';
import { TabbedFilterSheet } from '../components/collection/TabbedFilterSheet';
import { useCollection } from '../hooks/useCollection';
import { useFigureListParams } from '../hooks/useFigureListParams';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useAuthStore } from '../stores/auth';
import { applyFilters, countActiveFilters } from '../utils/facets';
import { sortFigures } from '../utils/sortFigures';
import { FIXTURE_FIGURES, isFixtureMode } from '../dev-fixtures/fixtures';

/** Shelf-shaped loading skeleton. */
function SkeletonShelves() {
  return (
    <div class="skeleton-shelves" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} class="skeleton-shelves__bay">
          <div class="skeleton-shelves__figure" style={{ width: '26%' }} />
          <div class="skeleton-shelves__figure" style={{ width: '34%' }} />
          <div class="skeleton-shelves__figure" style={{ width: '22%' }} />
        </div>
      ))}
      <style>{`
        .skeleton-shelves {
          display: flex;
          flex-direction: column;
          gap: var(--space-gap);
          padding: var(--space-2) var(--space-page);
        }
        .skeleton-shelves__bay {
          display: flex;
          align-items: flex-end;
          justify-content: space-evenly;
          height: var(--shelf-h, 168px);
          background: var(--surface-secondary);
          border-radius: var(--radius-md);
          padding: var(--space-2);
        }
        .skeleton-shelves__figure {
          height: 78%;
          border-radius: var(--radius-sm);
          background: var(--surface-tertiary);
          animation: skeleton-shelves-pulse 1.5s ease-in-out infinite;
        }
        @keyframes skeleton-shelves-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.55; }
        }
      `}</style>
    </div>
  );
}

export function Collection() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const {
    layout,
    density,
    motif,
    filters,
    sort,
    order,
    setLayout,
    setDensity,
    setMotif,
    setFilters,
    setSort,
  } = useFigureListParams();
  const [filterOpen, setFilterOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const online = useOnlineStatus();

  // Fixture mode (dev default): the app runs fully offline against the
  // gitignored matted fixtures — still through the query layer.
  const fixtureMode = useMemo(() => isFixtureMode(), []);
  const fixturesQuery = useQuery<Figure[]>({
    queryKey: ['dev-fixtures'],
    queryFn: () => Promise.resolve(FIXTURE_FIGURES),
    enabled: fixtureMode,
    staleTime: Infinity,
  });

  const collectionQuery = useCollection({
    sortBy: sort,
    sortOrder: order,
    status: filters.status.length === 1 ? (filters.status[0] as never) : undefined,
  });

  const figures: Figure[] = fixtureMode
    ? fixturesQuery.data ?? []
    : collectionQuery.data?.data ?? [];
  const isLoading = fixtureMode ? fixturesQuery.isLoading : collectionQuery.isLoading;
  const isError = fixtureMode ? fixturesQuery.isError : collectionQuery.isError;
  const total = fixtureMode ? figures.length : collectionQuery.data?.total ?? figures.length;

  // Facet filters + sort applied client-side over the loaded set (fixture
  // parity now; keeps working against cached data when offline).
  const visible = useMemo(
    () => sortFigures(applyFilters(figures, filters), sort, order),
    [figures, filters, sort, order],
  );

  const handleRefresh = useCallback(async () => {
    await (fixtureMode ? fixturesQuery.refetch() : collectionQuery.refetch());
  }, [fixtureMode, fixturesQuery, collectionQuery]);

  const handleSelect = useCallback((_figure: Figure, index: number) => {
    setViewerIndex(index);
  }, []);

  const hasActiveFilters = countActiveFilters(filters) > 0;

  const headerActions = (
    <DisplayToggle
      layout={layout}
      density={density}
      motif={motif}
      onLayout={setLayout}
      onDensity={setDensity}
      onMotif={setMotif}
    />
  );

  // Signed out (and not running on fixtures)
  if (!isAuthenticated && !fixtureMode) {
    return (
      <div class="page-collection" data-density={density}>
        <SlimHeader context={<span>Collection</span>} />
        <p class="page-collection__empty">Sign in to see your collection</p>
        <style>{styles}</style>
      </div>
    );
  }

  // Loading
  if (isLoading) {
    return (
      <div class="page-collection" data-density={density}>
        <SlimHeader context={<span>Collection</span>} actions={headerActions} />
        <SkeletonShelves />
        <style>{styles}</style>
      </div>
    );
  }

  // Error with nothing cached
  if (isError && figures.length === 0) {
    if (!online.value) {
      return (
        <div class="page-collection" data-density={density}>
          <SlimHeader context={<span>Collection</span>} />
          <ErrorState
            title="You're offline"
            message="No cached data yet. We'll refresh automatically once you're back online."
          />
          <style>{styles}</style>
        </div>
      );
    }
    return (
      <div class="page-collection" data-density={density}>
        <SlimHeader context={<span>Collection</span>} />
        <ErrorState
          title="Couldn't load your collection"
          message="Something went wrong fetching your figures. Try again?"
          onRetry={handleRefresh}
        />
        <style>{styles}</style>
      </div>
    );
  }

  return (
    <div class="page-collection cq-grid" data-density={density}>
      <SlimHeader context={<span>Collection ({total})</span>} actions={headerActions} />
      {!online.value && !fixtureMode && (
        <LastSyncedBadge timestamp={collectionQuery.dataUpdatedAt} />
      )}
      <FilterBar
        filters={filters}
        sort={sort}
        order={order}
        resultCount={visible.length}
        onOpen={() => setFilterOpen(true)}
      />
      <AppliedChips filters={filters} onChange={setFilters} />

      <PullToRefresh onRefresh={handleRefresh}>
        {figures.length === 0 ? (
          <p class="page-collection__empty">
            {hasActiveFilters
              ? 'No figures match your filters.'
              : 'Your collection is empty. Add figures to get started!'}
          </p>
        ) : visible.length === 0 ? (
          <p class="page-collection__empty">No figures match your filters.</p>
        ) : layout === 'case' ? (
          <div class="page-collection__display">
            <CaseShelf
              figures={visible}
              motif={motif}
              density={density}
              onSelect={handleSelect}
            />
          </div>
        ) : (
          <div class="page-collection__display page-collection__display--flush">
            <JustifiedRows figures={visible} density={density} onSelect={handleSelect} />
          </div>
        )}
      </PullToRefresh>

      <TabbedFilterSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        figures={figures}
        filters={filters}
        sort={sort}
        order={order}
        onApply={setFilters}
        onSort={setSort}
      />

      {viewerIndex !== null && (
        <FigureViewer
          figures={visible}
          index={viewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      )}

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .page-collection__empty {
    text-align: center;
    color: var(--text-secondary);
    padding: var(--space-8) var(--space-page);
    font-size: var(--font-sm);
  }

  .page-collection__display {
    padding: 0 var(--space-1) var(--space-4);
  }

  /* justified rows go edge-to-edge */
  .page-collection__display--flush {
    padding: 0 0 var(--space-4);
  }
`;

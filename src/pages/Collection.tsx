import { useState, useCallback, useMemo, useRef } from 'preact/hooks';
import { useQuery } from '@tanstack/react-query';
import type { Figure } from '@figurecollecting/fc-shared';
import { SlimHeader } from '../components/layout/SlimHeader';
import { PullToRefresh } from '../components/ui/PullToRefresh';
import { ErrorState } from '../components/ui/ErrorState';
import { LastSyncedBadge } from '../components/ui/LastSyncedBadge';
import { CaseShelf } from '../components/display/CaseShelf';
import { JustifiedRows } from '../components/display/JustifiedRows';
import { BrandWatermark } from '../components/brand/BrandWatermark';
import { DisplayToggle } from '../components/display/DisplayToggle';
import { FigureViewer } from '../components/display/FigureViewer';
import { DetailPane } from '../components/display/DetailPane';
import { FilterBar } from '../components/collection/FilterBar';
import { AppliedChips } from '../components/collection/AppliedChips';
import { TabbedFilterSheet } from '../components/collection/TabbedFilterSheet';
import { useCollection, useCollectionCounts, useCollections } from '../hooks/useCollection';
import { useCopyActions } from '../hooks/useFigureMutations';
import { useLastSynced } from '../local/useLocal';
import { localSession } from '../local/session';
import type { LocalFigure } from '../local/figures';
import { CollectionTabs, TAB_LABEL } from '../components/collection/CollectionTabs';
import { FormerList } from '../components/collection/FormerList';
import { MoveSheet, type MoveTarget } from '../components/collection/MoveSheet';
import { showToast } from '../stores/toast';
import { useFigureListParams } from '../hooks/useFigureListParams';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useElementWidth } from '../hooks/useElementWidth';
import { useAuthPhase } from '../local/useLocal';
import { applyFilters, countActiveFilters } from '../utils/facets';
import { sortFigures } from '../utils/sortFigures';
import { getFixtureFigures, isFixtureMode } from '../dev-fixtures/fixtures';
import { Style } from '../styles/Style';

/** Fold-open near-square threshold: at or above this container width, the
 *  figure detail opens as a right-hand pane instead of a full-screen
 *  takeover. A container query (measured width), never a device/UA check. */
const DUAL_PANE_MIN_WIDTH = 640;

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
      <Style css={`
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
      `} />
    </div>
  );
}

const EMPTY_TAB: Record<string, string> = {
  owned: 'Your collection is empty. Add figures to get started!',
  ordered: 'Nothing ordered yet.',
  wished: 'Nothing wished for yet.',
  former: 'Nothing here: every copy is still yours.',
};

const copiesLabel = (n: number): string => (n === 1 ? '1 copy' : `${n} copies`);

export function Collection() {
  const phase = useAuthPhase();
  // Fixture mode (dev default): the app runs fully offline against the
  // gitignored matted fixtures — still through the query layer. `?fx=N`
  // multiplies the set to stress-test virtualization at real scale.
  const fixtureMode = useMemo(() => isFixtureMode(), []);
  const {
    layout,
    density,
    motif,
    filters,
    sort,
    order,
    labels,
    tab,
    setTab,
    setLayout,
    setDensity,
    setMotif,
    setFilters,
    setSort,
    setLabels,
  } = useFigureListParams({ labelsDefault: !fixtureMode });
  const [filterOpen, setFilterOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [moveOpen, setMoveOpen] = useState(false);
  const online = useOnlineStatus();
  const pageRef = useRef<HTMLDivElement>(null);
  const pageWidth = useElementWidth(pageRef, 360);
  const dualPane = pageWidth >= DUAL_PANE_MIN_WIDTH;
  const actions = useCopyActions();

  const fixtureFigures = useMemo(() => getFixtureFigures(), []);
  const fixturesQuery = useQuery<Figure[]>({
    queryKey: ['dev-fixtures', fixtureFigures.length],
    queryFn: () => Promise.resolve(fixtureFigures),
    enabled: fixtureMode,
    staleTime: Infinity,
  });

  // The local store (WK-15): the whole tab, every item, no page cap and no request.
  const collectionQuery = useCollection({ sortBy: sort, sortOrder: order, status: tab });
  const counts = useCollectionCounts();
  const collections = useCollections();
  const lastSynced = useLastSynced();
  const syncState = localSession.value?.engine.state.value;
  const outOfReach = !online.value || syncState?.reachability === 'unreachable';

  const figures: Figure[] = fixtureMode ? (fixturesQuery.data ?? []) : (collectionQuery.data?.data ?? []);
  const isLoading = fixtureMode ? fixturesQuery.isLoading : phase === 'loading' || collectionQuery.isLoading;
  const isError = fixtureMode ? fixturesQuery.isError : collectionQuery.isError;
  const total = fixtureMode ? figures.length : (collectionQuery.data?.total ?? figures.length);

  // Facet filters + sort applied client-side over the loaded set (fixture
  // parity now; keeps working against cached data when offline).
  const visible = useMemo(
    () => sortFigures(applyFilters(figures, filters), sort, order),
    [figures, filters, sort, order],
  );

  const handleRefresh = useCallback(async () => {
    if (fixtureMode) await fixturesQuery.refetch();
    else await localSession.peek()?.engine.trigger('manual');
  }, [fixtureMode, fixturesQuery]);

  const handleSelect = useCallback(
    (figure: Figure, index: number) => {
      if (!selecting) {
        setViewerIndex(index);
        return;
      }
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(figure._id)) next.delete(figure._id);
        else next.add(figure._id);
        return next;
      });
    },
    [selecting],
  );

  const endSelect = useCallback(() => {
    setSelecting(false);
    setSelected(new Set());
    setMoveOpen(false);
  }, []);

  const chosen = (visible as LocalFigure[]).filter((f) => selected.has(f._id));
  const chosenCopies = chosen.flatMap((f) => f.local.copies.map((c) => c.occ_id));

  // The tabs' default collections, then any user collection of a kind a copy may be filed in.
  const moveTargets: MoveTarget[] = collections
    .filter((c) => c.kind !== 'former' && !(c.coll_id === 'default' && c.kind === tab))
    .map((c) => ({ ref: c.ref, label: c.coll_id === 'default' ? (c.name ?? TAB_LABEL[c.kind]) : `${TAB_LABEL[c.kind]}: ${c.name}` }));

  const handleMove = useCallback(
    (target: MoveTarget) => {
      actions
        .moveCopies(chosenCopies, target.ref)
        .then(() => showToast(`Moved ${copiesLabel(chosenCopies.length)} to ${target.label}`, 'success'))
        .catch((err: unknown) => showToast(`Could not move: ${(err as Error).message}`, 'error'))
        .finally(endSelect);
    },
    [actions, chosenCopies, endSelect],
  );

  const hasActiveFilters = countActiveFilters(filters) > 0;

  const headerActions = (
    <>
      {!fixtureMode && tab !== 'former' && (
        <button
          type="button"
          class="page-collection__select-btn"
          onClick={() => {
            if (selecting) endSelect();
            else {
              setSelecting(true);
              setViewerIndex(null);
            }
          }}
        >
          {selecting ? 'Done' : 'Select'}
        </button>
      )}
      <DisplayToggle
        layout={layout}
        density={density}
        motif={motif}
        labels={labels}
        onLayout={setLayout}
        onDensity={setDensity}
        onMotif={setMotif}
        onLabels={setLabels}
      />
    </>
  );

  // Signed out (and not running on fixtures)
  if (phase === 'signed-out' && !fixtureMode) {
    return (
      <div class="page-collection" data-density={density} ref={pageRef}>
        <SlimHeader context={<span>Collection</span>} />
        {/* The sign-in-to-sync banner above carries the one Sign in button. */}
        <p class="page-collection__empty">Sign in to see your collection</p>
        <Style css={styles} />
      </div>
    );
  }

  // Loading
  if (isLoading) {
    return (
      <div class="page-collection" data-density={density} ref={pageRef}>
        <SlimHeader context={<span>Collection</span>} actions={headerActions} />
        <SkeletonShelves />
        <Style css={styles} />
      </div>
    );
  }

  // Error with nothing to show
  if (isError && figures.length === 0) {
    return (
      <div class="page-collection" data-density={density} ref={pageRef}>
        <SlimHeader context={<span>Collection</span>} />
        <ErrorState
          title="Couldn't load your collection"
          message="This device's copy of your collection could not be read. Try again?"
          onRetry={handleRefresh}
        />
        <Style css={styles} />
      </div>
    );
  }

  const showDetailPane = !selecting && dualPane && viewerIndex !== null && !!visible[viewerIndex];
  // Select mode lays the tab out as rows, where a tap toggles a tile.
  const shownLayout = selecting ? 'rows' : layout;

  return (
    <div class="page-collection cq-grid" data-density={density} ref={pageRef}>
      <SlimHeader context={<span>Collection ({total})</span>} actions={headerActions} />
      {!fixtureMode && outOfReach && <LastSyncedBadge timestamp={lastSynced} />}
      {!fixtureMode && <CollectionTabs tab={tab} counts={counts} onChange={(t) => { endSelect(); setViewerIndex(null); setTab(t); }} />}
      <FilterBar
        filters={filters}
        sort={sort}
        order={order}
        resultCount={visible.length}
        onOpen={() => setFilterOpen(true)}
      />
      <AppliedChips filters={filters} onChange={setFilters} />

      <div class={`page-collection__body ${showDetailPane ? 'page-collection__body--split' : ''}`}>
        <div class="page-collection__grid-col">
          <PullToRefresh onRefresh={handleRefresh}>
            {figures.length === 0 ? (
              <p class="page-collection__empty">
                {hasActiveFilters ? 'No figures match your filters.' : fixtureMode ? EMPTY_TAB['owned'] : EMPTY_TAB[tab]}
              </p>
            ) : visible.length === 0 ? (
              <p class="page-collection__empty">No figures match your filters.</p>
            ) : !fixtureMode && tab === 'former' ? (
              <FormerList figures={visible as LocalFigure[]} onOpen={(f) => setViewerIndex(visible.indexOf(f))} />
            ) : shownLayout === 'case' ? (
              <div class="page-collection__display">
                <CaseShelf
                  figures={visible}
                  motif={motif}
                  density={density}
                  onSelect={handleSelect}
                  labels={labels}
                  watermark={<BrandWatermark />}
                />
              </div>
            ) : (
              <div class="page-collection__display page-collection__display--flush">
                <JustifiedRows
                  figures={visible}
                  density={density}
                  onSelect={handleSelect}
                  labels={labels}
                  watermark={<BrandWatermark />}
                  {...(selecting ? { isSelected: (f: Figure) => selected.has(f._id) } : {})}
                />
              </div>
            )}
          </PullToRefresh>
        </div>

        {showDetailPane && (
          <DetailPane
            figure={visible[viewerIndex]}
            index={viewerIndex}
            total={visible.length}
            onClose={() => setViewerIndex(null)}
          />
        )}
      </div>

      {selecting && (
        <div class="page-collection__select-bar">
          <span>{chosen.length === 0 ? 'Tap figures to select them' : `${chosen.length} selected`}</span>
          <button
            type="button"
            class="page-collection__select-action"
            disabled={chosenCopies.length === 0}
            onClick={() => setMoveOpen(true)}
          >
            {`Move ${copiesLabel(chosenCopies.length)} to…`}
          </button>
        </div>
      )}

      <MoveSheet
        open={moveOpen}
        title={`Move ${copiesLabel(chosenCopies.length)} to`}
        targets={moveTargets}
        onPick={handleMove}
        onClose={() => setMoveOpen(false)}
      />

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

      {!selecting && !dualPane && viewerIndex !== null && (
        <FigureViewer
          figures={visible}
          index={viewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      )}

      <Style css={styles} />
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

  /* Fold dual-pane (>= 640px container width): grid condenses left, detail
     opens as a right-hand pane instead of a full-screen viewer takeover. */
  .page-collection__body {
    display: flex;
    align-items: stretch;
  }

  .page-collection__grid-col {
    flex: 1;
    min-width: 0;
  }

  .page-collection__body--split .page-collection__grid-col {
    border-right: 1px solid var(--border-subtle);
  }

  .page-collection__select-btn {
    min-height: 32px;
    padding: 0 var(--space-3);
    border-radius: var(--radius-full);
    font-size: var(--font-sm);
    color: var(--brand-400);
  }

  .page-collection__select-bar {
    position: sticky;
    bottom: 0;
    z-index: 5;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-page);
    background: var(--surface-primary);
    border-top: 1px solid var(--border-subtle);
    font-size: var(--font-sm);
  }

  .page-collection__select-action {
    min-height: 44px;
    padding: 0 var(--space-4);
    border-radius: var(--radius-full);
    background: var(--brand-500);
    color: #fff;
    font-weight: 600;
  }

  .page-collection__select-action:disabled {
    opacity: 0.5;
  }
`;

import { useState, useCallback, useMemo, useRef } from 'preact/hooks';
import { useQuery } from '@tanstack/react-query';
import type { Figure } from '@figurecollecting/fc-shared';
import { SlimHeader } from '../components/layout/SlimHeader';
import { PullToRefresh } from '../components/ui/PullToRefresh';
import { ErrorState } from '../components/ui/ErrorState';
import { LastSyncedBadge } from '../components/ui/LastSyncedBadge';
import { CabinetScene } from '../components/display/CabinetScene';
import { CaseTabs, type CaseCard } from '../components/display/CaseTabs';
import { CaseViewCard } from '../components/display/CaseViewCard';
import { useCasePrefs } from '../components/display/casePrefs';
import { JustifiedRows } from '../components/display/JustifiedRows';
import { BrandWatermark } from '../components/brand/BrandWatermark';
import { DisplayToggle } from '../components/display/DisplayToggle';
import { FigureViewer } from '../components/display/FigureViewer';
import { DetailPane } from '../components/display/DetailPane';
import { AppliedChips } from '../components/collection/AppliedChips';
import { TabbedFilterSheet } from '../components/collection/TabbedFilterSheet';
import { useCollection, useCollectionCounts } from '../hooks/useCollection';
import { useLastSynced } from '../local/useLocal';
import { localSession } from '../local/session';
import type { LocalFigure } from '../local/figures';
import { FormerList } from '../components/collection/FormerList';
import { COLLECTION_TABS, useFigureListParams, type CollectionTab, type ListFilters } from '../hooks/useFigureListParams';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useOwnedImages } from '../hooks/useOwnedImages';
import { useElementWidth } from '../hooks/useElementWidth';
import { useAuthPhase } from '../local/useLocal';
import { applyFilters, holdingOf } from '../utils/facets';
import { sortFigures } from '../utils/sortFigures';
import { getFixtureFigures, getFixtureImageRef, isFixtureMode } from '../dev-fixtures/fixtures';
import { Style } from '../styles/Style';
import { BackToClose } from '../hooks/useBackToClose';

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

/** The fixtures hold no default: every holding shows until Refine picks some. */
const NO_HOLDINGS: readonly CollectionTab[] = [];
const NO_FILTERS: ListFilters = { status: [], mfr: [], dist: [], scale: [], origin: [], cat: [], type: [], tag: [] };

/** Each holding's count over a figure list (the fixtures, which the local store does not count). */
function countHoldings(figures: Figure[]): Record<CollectionTab, number> {
  const counts = Object.fromEntries(COLLECTION_TABS.map((h) => [h, 0])) as Record<CollectionTab, number>;
  for (const f of figures) {
    const h = holdingOf(f) as CollectionTab;
    if (h in counts) counts[h] += 1;
  }
  return counts;
}

export function Collection() {
  const phase = useAuthPhase();
  // Fixture mode (dev default): the app runs fully offline against the
  // gitignored matted fixtures — still through the query layer. `?fx=N`
  // multiplies the set to stress-test virtualization at real scale.
  const fixtureMode = useMemo(() => isFixtureMode(), []);
  const {
    layout,
    density,
    filters,
    sort,
    order,
    labels,
    defaults,
    setLayout,
    setDensity,
    setFilters,
    setSort,
    setLabels,
  } = useFigureListParams({ labelsDefault: !fixtureMode, holdingsDefault: fixtureMode ? NO_HOLDINGS : undefined });
  const [filterOpen, setFilterOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  // the figure last opened, by id: the Info tab opens it again wherever a re-sort or filter has moved it
  const [lastOpenedId, setLastOpenedId] = useState<string | null>(null);
  const [caseCard, setCaseCard] = useState<CaseCard | null>(null);
  const [casePrefs, setCasePrefs] = useCasePrefs();
  const online = useOnlineStatus();
  const pageRef = useRef<HTMLDivElement>(null);
  const pageWidth = useElementWidth(pageRef, 360);
  const dualPane = pageWidth >= DUAL_PANE_MIN_WIDTH;

  const fixtureFigures = useMemo(() => getFixtureFigures(), []);
  const fixturesQuery = useQuery<Figure[]>({
    queryKey: ['dev-fixtures', fixtureFigures.length],
    queryFn: () => Promise.resolve(fixtureFigures),
    enabled: fixtureMode,
    staleTime: Infinity,
  });

  // The local store (WK-15): every holding, every item, no page cap and no request; Refine's holdings choose among them.
  const collectionQuery = useCollection({ sortBy: sort, sortOrder: order, status: 'all' });
  const counts = useCollectionCounts();
  const lastSynced = useLastSynced();
  const syncState = localSession.value?.engine.state.value;
  const outOfReach = !online.value || syncState?.reachability === 'unreachable';

  // ADDR-1: an owned figure stands in the case as its kept image (online or off); the rest as plates.
  const ownedImages = useOwnedImages();
  const localFigures = collectionQuery.data?.data;
  const withImages = useMemo(
    () =>
      (localFigures ?? []).map((f) => {
        // Kept for the owned figures only; the same product on another tab shows the same image.
        const image = ownedImages.get(f.local.headId);
        return image === undefined ? f : { ...f, imageUrl: image.url };
      }),
    [localFigures, ownedImages],
  );
  const figures: Figure[] = fixtureMode ? (fixturesQuery.data ?? []) : withImages;
  const isLoading = fixtureMode ? fixturesQuery.isLoading : phase === 'loading' || collectionQuery.isLoading;
  const isError = fixtureMode ? fixturesQuery.isError : collectionQuery.isError;
  const holdingCounts = useMemo(
    () => (fixtureMode ? countHoldings(figures) : (counts ?? countHoldings([]))),
    [fixtureMode, figures, counts],
  );

  // The chosen holdings' figures (the total), then the facet filters and the sort, client-side over the
  // loaded set (fixture parity; keeps working against cached data when offline).
  const scoped = useMemo(() => applyFilters(figures, { ...NO_FILTERS, status: filters.status }), [figures, filters.status]);
  const total = scoped.length;
  const visible = useMemo(
    () => sortFigures(applyFilters(scoped, filters), sort, order),
    [scoped, filters, sort, order],
  );
  const onlyHolding = filters.status.length === 1 ? (filters.status[0] as CollectionTab) : null;
  const lastOpened = lastOpenedId === null ? -1 : visible.findIndex((f) => f._id === lastOpenedId);

  const handleRefresh = useCallback(async () => {
    if (fixtureMode) await fixturesQuery.refetch();
    else await localSession.peek()?.engine.trigger('manual');
  }, [fixtureMode, fixturesQuery]);

  const handleSelect = useCallback((figure: Figure, index: number) => {
    setViewerIndex(index);
    setLastOpenedId(figure._id);
  }, []);

  // No Select until a selection can do something (BULK-1: move to a cabinet or shelf, change status, mark arrived).
  const headerActions = (
    <>
      <DisplayToggle
        layout={layout}
        density={density}
        caseView={casePrefs.view}
        labels={labels}
        onLayout={setLayout}
        onDensity={setDensity}
        onCaseView={(view) => setCasePrefs({ view })}
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

  const showDetailPane = dualPane && viewerIndex !== null && !!visible[viewerIndex];
  const shownLayout = layout;
  const emptyText = fixtureMode ? EMPTY_TAB['owned'] : onlyHolding !== null ? EMPTY_TAB[onlyHolding] : 'Nothing here yet.';

  return (
    <div class={`page-collection cq-grid ${shownLayout === 'case' ? 'page-collection--case' : ''}`} data-density={density} ref={pageRef}>
      <SlimHeader context={<span>Collection ({total})</span>} actions={headerActions} />
      {!fixtureMode && outOfReach && <LastSyncedBadge timestamp={lastSynced} />}
      <AppliedChips filters={filters} defaults={defaults} shown={visible.length} total={total} onChange={setFilters} />

      <div class={`page-collection__body ${showDetailPane ? 'page-collection__body--split' : ''}`}>
        <div class="page-collection__grid-col">
          <PullToRefresh onRefresh={handleRefresh}>
            {scoped.length === 0 ? (
              <p class="page-collection__empty">{emptyText}</p>
            ) : visible.length === 0 ? (
              <p class="page-collection__empty">No figures match your filters.</p>
            ) : !fixtureMode && onlyHolding === 'former' ? (
              <FormerList figures={visible as LocalFigure[]} onOpen={(f) => setViewerIndex(visible.indexOf(f))} />
            ) : shownLayout === 'case' ? (
              <div class="page-collection__display page-collection__display--case">
                <CabinetScene
                  figures={visible}
                  onSelect={handleSelect}
                  prefs={casePrefs}
                  labels={labels}
                  imageFor={fixtureMode ? getFixtureImageRef : undefined}
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

      {/* both layouts: Refine's way in now the filter row comes and goes; the View card is the case's */}
      <CaseTabs
        order={casePrefs.tabOrder}
        viewEnabled={shownLayout === 'case'}
        infoEnabled={lastOpened >= 0}
        open={caseCard ?? (filterOpen ? 'refine' : null)}
        onTab={(tab) => {
          if (tab === 'view') setCaseCard('view');
          else if (tab === 'refine') setFilterOpen(true);
          else if (lastOpened >= 0) setViewerIndex(lastOpened);
        }}
      />

      <CaseViewCard open={caseCard === 'view'} prefs={casePrefs} onChange={setCasePrefs} onClose={() => setCaseCard(null)} />
      {/* Back and Esc close the card on top, never the Info pane under it */}
      {caseCard === 'view' && <BackToClose onClose={() => setCaseCard(null)} />}
      {filterOpen && <BackToClose onClose={() => setFilterOpen(false)} />}

      <TabbedFilterSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        figures={scoped}
        filters={filters}
        defaults={defaults}
        holdings={holdingCounts}
        shown={visible.length}
        total={total}
        sort={sort}
        order={order}
        onApply={setFilters}
        onSort={setSort}
      />

      {!dualPane && viewerIndex !== null && (
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

  /* the cabinets fill the frame left above the tabs; the room, not padding, takes any spare space */
  .page-collection__display--case {
    padding: 0;
    height: 100%;
  }

  /* The case ends above the pull-up tabs (B1), in CSS so it follows any change above it (the offline
     banner, the chips row) and a turn of the phone: the page is the content area, which ends at the tab
     bar, less the pull-up tabs (32 px) and a 4 px gap; a column whose header, filter bar and chips take
     what they need and whose body, down to the scene, the rest. The camera re-frames on the scene's own
     resize (CabinetScene's useFrame). */
  .animated-route:has(> .page-collection--case) {
    height: 100%;
  }

  .page-collection--case {
    display: flex;
    flex-direction: column;
    height: 100%;
    box-sizing: border-box;
    padding-bottom: 36px;
  }

  .page-collection--case > * {
    flex-shrink: 0;
  }

  .page-collection--case > .page-collection__body {
    flex: 1 1 0;
    min-height: 0;
  }

  .page-collection__display--case > .cabinet-scene {
    height: 100%;
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

  /* the tiles end above the pull-up tabs (32 px and a 4 px gap), like the case */
  .page-collection.cq-grid:not(.page-collection--case) {
    padding-bottom: 36px;
  }
`;

// LOADBAR (Ross 11-03: "a loading/progress indicator near the top middle or in the top bar" while the cached catalogue
// loads, slow on a weak connection): a thin bar along the top edge of the top bar and a small label at the middle just
// under the top bar (over it, the label would hide the header's own buttons), while the sync
// engine's pass loads the catalogue (SyncState.loading). Real progress where the pass knows it (the cards: how many of
// those due are in), a moving bar where it does not (the pull: how many pages are to come is not known), and gone the
// moment the pass ends. Shown only once a load has lasted LOADBAR_SHOW_DELAY_MS, so a fast link never flashes it.
// An indicator, never a control (feedback: no frequent controls at the top): it takes no taps and no layout space, so
// whatever lies under it at the top keeps working and nothing moves when it comes or goes.
// Its label is drawn only where nothing to tap, type in or read lies under it, scrolled too (labelDrawn): the case view
// while no row of filter chips stands under the top bar. Elsewhere it is left to screen readers and the bar alone shows the
// load: the Search field, the collection's rows of figure tiles, the filter chips, the Stats counts, and the screens whose
// content scrolls under it (Settings; Profile, signed in, is a list of actions).
// LOADBAR-2 (Ross 11-04: "so loading is hidden if there are filters?"): over the filter chips, the collection says it in a
// strip of its own that covers the row (CatalogueLoadStrip).
import { useEffect, useState } from 'preact/hooks';
import { useLocation, useSearch } from 'wouter';
import { localSession } from '../../local/session';
import type { CatalogueLoading } from '../../sync/engine';
import { getFixtureLoading, isFixtureMode } from '../../dev-fixtures/fixtures';
import { resolveLayout } from '../../hooks/useFigureListParams';
import { useAppliedChipsShown } from '../collection/AppliedChips';
import { Style } from '../../styles/Style';

/**
 * Whether the label is drawn on the screen at `path` with `search`: only where nothing to tap, type in or read lies under it,
 * the collection as the case while no row of filter chips stands under the top bar.
 */
function labelDrawn(path: string, search: string, chipsShown: boolean): boolean {
  return path === '/' && !chipsShown && resolveLayout(new URLSearchParams(search)) === 'case';
}

/** How long a load must last before the bar shows. */
export const LOADBAR_SHOW_DELAY_MS = 600;

const count = (n: number): string => n.toLocaleString('en-US');

/** What the bar's label, and the collection's load strip, say. */
export function loadingLabel(loading: CatalogueLoading): string {
  return loading.step === 'cards' ? `Loading catalogue · ${count(loading.done)} of ${count(loading.total)}` : 'Loading catalogue…';
}

// LOADBAR-2 (challenge N2): when the load under way began, one time for every reader (the bar, the collection's load
// strip), so one drawn part way through a load (the collection opened mid-load) shows it when the others do, not the delay
// after; null while none loads, and forgotten when the last reader goes, none being left to see the load end.
let loadBegan: number | null = null;
let readers = 0;

/** Whether `active`, the load, has lasted `delayMs` since it began: true from then until it ends, false again at once when it does. */
function useAfterDelay(active: boolean, delayMs: number): boolean {
  const [shown, setShown] = useState(() => active && loadBegan !== null && performance.now() - loadBegan >= delayMs);
  useEffect(() => {
    readers++;
    return () => {
      if (--readers === 0) loadBegan = null;
    };
  }, []);
  useEffect(() => {
    if (!active) {
      loadBegan = null;
      setShown(false);
      return;
    }
    loadBegan ??= performance.now();
    const timer = setTimeout(() => setShown(true), loadBegan + delayMs - performance.now());
    return () => clearTimeout(timer);
  }, [active, delayMs]);
  return active && shown;
}

/**
 * What of the catalogue loads, once the load has lasted LOADBAR_SHOW_DELAY_MS; null otherwise, at once when it ends. The dev
 * fixtures, which have no sync engine, take theirs from the address (?fxloadbar=), followed as it changes.
 */
export function useCatalogueLoading(): CatalogueLoading | null {
  // the fixtures' load is read from the address: drawn again as it changes
  useSearch();
  const loading = (isFixtureMode() ? getFixtureLoading() : null) ?? localSession.value?.engine.state.value.loading ?? null;
  const shown = useAfterDelay(loading !== null, LOADBAR_SHOW_DELAY_MS);
  return shown ? loading : null;
}

export function CatalogueLoadBar() {
  const [path] = useLocation();
  const search = useSearch();
  const chipsShown = useAppliedChipsShown();
  const loading = useCatalogueLoading();
  if (loading === null) return null;
  const known = loading.step === 'cards';
  const pct = known ? Math.round((loading.done / loading.total) * 1000) / 10 : 0;
  return (
    <div
      class={`catalogue-loadbar ${known ? '' : 'catalogue-loadbar--indeterminate'}`}
      role="progressbar"
      aria-label="Loading catalogue"
      {...(known ? { 'aria-valuemin': 0, 'aria-valuemax': loading.total, 'aria-valuenow': loading.done } : {})}
    >
      <div class="catalogue-loadbar__track">
        <div class="catalogue-loadbar__fill" style={known ? { width: `${pct}%` } : undefined} />
      </div>
      <span class={labelDrawn(path, search, chipsShown) ? 'catalogue-loadbar__label' : 'sr-only'}>{loadingLabel(loading)}</span>

      <Style css={`
        .catalogue-loadbar {
          position: fixed;
          top: var(--safe-area-top);
          left: 0;
          right: 0;
          height: 3px;
          z-index: 30;
          pointer-events: none;
        }

        .catalogue-loadbar__track {
          height: 100%;
          overflow: hidden;
          background: color-mix(in srgb, var(--brand-500) 18%, transparent);
        }

        .catalogue-loadbar__fill {
          height: 100%;
          background: var(--brand-500);
          transition: width var(--transition-normal);
        }

        .catalogue-loadbar--indeterminate .catalogue-loadbar__fill {
          width: 30%;
          animation: catalogue-loadbar-sweep 1.2s ease-in-out infinite;
        }

        @keyframes catalogue-loadbar-sweep {
          from { transform: translateX(-100%); }
          to { transform: translateX(340%); }
        }

        .catalogue-loadbar__label {
          position: absolute;
          top: calc(var(--header-height) + var(--space-2));
          left: 50%;
          transform: translateX(-50%);
          padding: 2px var(--space-2);
          border-radius: var(--radius-full);
          background: color-mix(in srgb, var(--surface-elevated) 92%, transparent);
          box-shadow: var(--shadow-sm);
          color: var(--text-secondary);
          font-size: var(--font-xs);
          font-weight: 500;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }

        @media (prefers-reduced-motion: reduce) {
          .catalogue-loadbar--indeterminate .catalogue-loadbar__fill {
            width: 100%;
            opacity: 0.5;
            animation: none;
          }
          .catalogue-loadbar__fill { transition: none; }
        }
      `} />
    </div>
  );
}

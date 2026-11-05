// LOADBAR-2 (Ross 11-04: "so loading is hidden if there are filters? Then we won't know it's loading... maybe better to
// cover filters behind it with full-width bar of same background color while loading occurs instead?"): on the collection,
// while the catalogue loads and its row of filter chips stands, the label stands as a full-width opaque strip in the page's
// own colour over the row. It takes the taps that land on it, and the row under it is inert (no focus, no key), so no chip
// is removed by accident. It takes no layout space, so nothing moves when it comes or goes, and it stands under the top bar
// and its menus. Where no row stands no strip is drawn (challenge B1/S1: it covered the one-shelf view's Shelf above and the
// first figures and tiles); the bar's own label says it in the case there (CatalogueLoadBar). The page places it round its
// row (Collection). A live region always there, empty while nothing loads, so a screen reader hears the load start, move
// and end, row or not.
import type { ComponentChildren } from 'preact';
import { useAppliedChipsShown } from '../collection/AppliedChips';
import { loadingLabel, useCatalogueLoading } from './CatalogueLoadBar';
import { Style } from '../../styles/Style';

/** The filter chips row's place (`children`: the row), and over the row while the catalogue loads, the strip. */
export function CatalogueLoadStrip({ children }: { children: ComponentChildren }) {
  const loading = useCatalogueLoading();
  const rowShown = useAppliedChipsShown();
  const covering = loading !== null && rowShown;
  return (
    <div class="catalogue-strip-slot">
      <div inert={covering}>{children}</div>
      <div class={covering ? 'catalogue-strip' : 'sr-only'} role="status" aria-live="polite">
        {loading !== null && loadingLabel(loading)}
      </div>

      <Style css={`
        .catalogue-strip-slot {
          position: relative;
        }

        .catalogue-strip {
          position: absolute;
          inset: 0;
          /* over the row and the page under it; under the top bar (20) and its menus */
          z-index: 19;
          display: flex;
          align-items: center;
          justify-content: center;
          box-sizing: border-box;
          padding: 0 var(--space-page);
          background: var(--surface-primary);
          color: var(--text-secondary);
          font-size: var(--font-xs);
          font-weight: 500;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      `} />
    </div>
  );
}

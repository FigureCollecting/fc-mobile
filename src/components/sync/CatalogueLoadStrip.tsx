// LOADBAR-2 (Ross 11-04: "so loading is hidden if there are filters? Then we won't know it's loading... maybe better to
// cover filters behind it with full-width bar of same background color while loading occurs instead?"): on the collection,
// while the catalogue loads, its label stands as a full-width opaque strip in the page's own colour over the filter chips
// row, and takes the taps that land on it, so no chip under it is removed by one; where no row stands it stands as high, in
// the row's place under the top bar. It takes no layout space, so nothing moves when it comes or goes, and it stands under
// the top bar and its menus. The page places it (Collection); the bar along the top edge (CatalogueLoadBar) shows with it.
// A live region always there, empty while nothing loads, so a screen reader hears the load start, move and end.
import { APPLIED_CHIPS_ROW_HEIGHT } from '../collection/AppliedChips';
import { loadingLabel, useCatalogueLoading } from './CatalogueLoadBar';
import { Style } from '../../styles/Style';

export function CatalogueLoadStrip() {
  const loading = useCatalogueLoading();
  return (
    <div class={loading === null ? 'sr-only' : 'catalogue-strip'} role="status" aria-live="polite">
      {loading !== null && loadingLabel(loading)}

      <Style css={`
        .catalogue-strip {
          position: absolute;
          inset: 0;
          min-height: ${APPLIED_CHIPS_ROW_HEIGHT};
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

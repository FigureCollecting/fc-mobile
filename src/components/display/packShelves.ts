import type { Figure } from '@figurecollecting/fc-shared';
import type { FigureDisplayMeta } from './displayMeta';
import { getDisplayMeta } from './displayMeta';

export interface ShelfItem {
  figure: Figure;
  meta: FigureDisplayMeta;
  /** Index into the flat source list (for viewer swipe order). */
  index: number;
  /** Display width in px. */
  w: number;
  /** Display height in px. */
  h: number;
  /**
   * The item's rendered footprint in the row, including its share of the
   * surrounding gaps (both the fixed packing gap and whatever slack
   * `justify-content: space-evenly` distributes) — i.e. how wide an
   * overlay (a nameplate) can grow before it reaches the midpoint to its
   * neighbor. Always >= w.
   */
  slotWidth: number;
  /**
   * The item's X offset (px) from the row's own usable-width origin,
   * analytically mirroring where `justify-content: space-evenly` actually
   * renders it. The floor's contact-shadow layer lives OUTSIDE the flex
   * layout (in its own 3D local coordinate space, per CaseShelf's
   * per-figure Z-depth placement), so it needs to know each figure's real X
   * position without measuring the DOM.
   */
  left: number;
}

export type ShelfRow = ShelfItem[];

/** Assigns each item's slotWidth and left (X) position once a row's full
 *  composition is known — both derived from the identical space-evenly gap
 *  math, so they always agree with each other and with the real flex
 *  layout. */
function assignSlotWidths(row: Array<Omit<ShelfItem, 'slotWidth' | 'left'>>, usable: number, gap: number): ShelfRow {
  const n = row.length;
  const sumW = row.reduce((sum, item) => sum + item.w, 0);
  const naturalWidth = sumW + (n - 1) * gap;
  const leftover = Math.max(0, usable - naturalWidth);
  // justify-content: space-evenly splits leftover space into n+1 equal gaps
  // (before the first item, between each pair, after the last).
  const extra = leftover / (n + 1);

  let cursor = extra; // the leading gap, i.e. the first item's left edge
  return row.map((item, i) => {
    const gapBefore = (i === 0 ? 0 : gap) + extra;
    const gapAfter = (i === n - 1 ? 0 : gap) + extra;
    const left = Math.round(cursor);
    cursor += item.w + gap + extra;
    return { ...item, left, slotWidth: Math.round(item.w + gapBefore / 2 + gapAfter / 2) };
  });
}

/**
 * Pack figures onto shelf rows. Figures share a visual height band (standing
 * figures near the top of the band, chibi/sitting shorter — relHeight), keep
 * natural width variance from their aspect ratio, and fill each shelf until
 * the next figure would overflow. Rows are self-contained units so the list
 * can later be virtualized row-by-row.
 *
 * @param getRelHeight Overrides where each item's relHeight (0..1 within
 *   bandHeight) comes from. Defaults to the figure's own FigureDisplayMeta
 *   relHeight (today's behavior). CaseShelf passes a lookup into
 *   resolveRelHeights' collection-wide, physical-height-proportional map
 *   instead, so a figure renders at a size relative to the rest of the
 *   displayed set rather than a fixed per-figure guess.
 */
export function packShelves(
  figures: Figure[],
  containerWidth: number,
  bandHeight: number,
  gap = 8,
  getRelHeight: (figure: Figure, meta: FigureDisplayMeta) => number = (_figure, meta) => meta.relHeight,
): ShelfRow[] {
  const usable = Math.max(120, containerWidth);
  const rows: ShelfRow[] = [];
  let row: Array<Omit<ShelfItem, 'slotWidth' | 'left'>> = [];
  let rowWidth = 0;

  figures.forEach((figure, index) => {
    const meta = getDisplayMeta(figure);
    const h = Math.round(getRelHeight(figure, meta) * bandHeight);
    const w = Math.round(h * meta.aspect);
    const needed = rowWidth === 0 ? w : rowWidth + gap + w;

    if (row.length > 0 && needed > usable) {
      rows.push(assignSlotWidths(row, usable, gap));
      row = [];
      rowWidth = 0;
    }

    row.push({ figure, meta, index, w, h });
    rowWidth = rowWidth === 0 ? w : rowWidth + gap + w;
  });

  if (row.length > 0) rows.push(assignSlotWidths(row, usable, gap));
  return rows;
}

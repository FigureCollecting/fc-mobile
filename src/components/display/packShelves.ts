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
}

export type ShelfRow = ShelfItem[];

/**
 * Pack figures onto shelf rows. Figures share a visual height band (standing
 * figures near the top of the band, chibi/sitting shorter — relHeight), keep
 * natural width variance from their aspect ratio, and fill each shelf until
 * the next figure would overflow. Rows are self-contained units so the list
 * can later be virtualized row-by-row.
 */
export function packShelves(
  figures: Figure[],
  containerWidth: number,
  bandHeight: number,
  gap = 8,
): ShelfRow[] {
  const usable = Math.max(120, containerWidth);
  const rows: ShelfRow[] = [];
  let row: ShelfRow = [];
  let rowWidth = 0;

  figures.forEach((figure, index) => {
    const meta = getDisplayMeta(figure);
    const h = Math.round(meta.relHeight * bandHeight);
    const w = Math.round(h * meta.aspect);
    const needed = rowWidth === 0 ? w : rowWidth + gap + w;

    if (row.length > 0 && needed > usable) {
      rows.push(row);
      row = [];
      rowWidth = 0;
    }

    row.push({ figure, meta, index, w, h });
    rowWidth = rowWidth === 0 ? w : rowWidth + gap + w;
  });

  if (row.length > 0) rows.push(row);
  return rows;
}

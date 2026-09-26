import type { Figure } from '@figurecollecting/fc-shared';
import { getDisplayMeta } from './displayMeta';

export interface JustifiedItem {
  figure: Figure;
  /** Index into the flat source list (viewer swipe order). */
  index: number;
  w: number;
  h: number;
}

export interface JustifiedRow {
  items: JustifiedItem[];
  height: number;
}

/**
 * Display B — classic justified gallery packing. Fixed target row height,
 * native-aspect widths, then each full row is scaled so it exactly fills the
 * container edge-to-edge. Images are NEVER cropped: the row absorbs aspect
 * variance, not the image. The final row keeps the base height.
 */
export function packJustified(
  figures: Figure[],
  containerWidth: number,
  baseHeight: number,
  gap = 2,
): JustifiedRow[] {
  const usable = Math.max(120, containerWidth);
  const rows: JustifiedRow[] = [];
  let current: { figure: Figure; index: number; aspect: number }[] = [];

  const flush = (isLast: boolean) => {
    if (current.length === 0) return;
    const gaps = (current.length - 1) * gap;
    const aspectSum = current.reduce((s, i) => s + i.aspect, 0);
    // Full rows accumulate until they overflow, then scale DOWN to fit —
    // so height <= baseHeight and the row fills edge-to-edge exactly.
    // The trailing partial row just keeps the base height.
    const height = isLast ? Math.min((usable - gaps) / aspectSum, baseHeight) : (usable - gaps) / aspectSum;
    const rounded = Math.round(height);
    rows.push({
      height: rounded,
      items: current.map((i) => ({
        figure: i.figure,
        index: i.index,
        w: Math.round(i.aspect * rounded),
        h: rounded,
      })),
    });
    current = [];
  };

  figures.forEach((figure, index) => {
    const aspect = getDisplayMeta(figure).aspect;
    current.push({ figure, index, aspect });
    const rowWidth =
      current.reduce((s, i) => s + i.aspect * baseHeight, 0) + (current.length - 1) * gap;
    if (rowWidth >= usable) flush(false);
  });
  flush(true);

  return rows;
}

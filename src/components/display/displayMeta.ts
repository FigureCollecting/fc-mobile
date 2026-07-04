import type { Figure } from '@figurecollecting/fc-shared';
import type { FigureDisplayMeta } from '../../dev-fixtures/fixtures';
import { FIXTURE_META } from '../../dev-fixtures/fixtures';

export type { FigureDisplayMeta };

/**
 * Fallback display meta for figures without matting-pipeline data (i.e. every
 * real figure until the ingest pipeline ships derivatives). They render as
 * framed pictures standing on the shelf — the metaphor survives failed or
 * missing mattes.
 */
export const UNMATTED_META: FigureDisplayMeta = {
  width: 600,
  height: 800,
  aspect: 0.75,
  relHeight: 0.9,
  footprintCenterX: 0.5,
  footprintWidth: 0.72,
  matted: false,
  baseRecovered: false,
};

/** Resolve display meta for a figure: manifest data, else unmatted fallback. */
export function getDisplayMeta(figure: Figure): FigureDisplayMeta {
  return FIXTURE_META[figure._id] ?? UNMATTED_META;
}

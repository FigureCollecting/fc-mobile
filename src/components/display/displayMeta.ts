import type { Figure, FigureDisplayMeta as ApiFigureDisplayMeta, FigureContactBand } from '@figurecollecting/fc-shared';
import type { FixtureDisplayMeta } from '../../dev-fixtures/fixtures';
import { FIXTURE_META } from '../../dev-fixtures/fixtures';

/**
 * The local render meta CabinetScene/packCabinets/packJustified/
 * sizeResolution/FigureViewer all consume. Superset of FixtureDisplayMeta (the hand-
 * authored dev-fixture shape): plus optional passthrough fields carried
 * straight from a real figure's fc-shared displayMeta contract
 * (bottomMarginFrac, contactBand, matteImageId, matteVersionId, thumbhash,
 * dominantColor) once mapApiDisplayMeta below fills them in. Kept named
 * FigureDisplayMeta (unchanged) so every existing consumer import
 * (`import type { FigureDisplayMeta } from './displayMeta'`) keeps working
 * — only the fixture-side name changed (see FixtureDisplayMeta's doc
 * comment in dev-fixtures/fixtures.ts for why).
 *
 * The case (CabinetScene, through figureArt) takes bottomMarginFrac and
 * contactBand from here when the server sent them, and otherwise measures
 * both from the picture's alpha (alphaMargin.ts), so a known value skips
 * the canvas round-trip.
 */
export interface FigureDisplayMeta extends FixtureDisplayMeta {
  /** Passthrough from the real figure's API displayMeta, when present. */
  bottomMarginFrac?: number;
  /** Passthrough from the real figure's API displayMeta, when present. */
  contactBand?: FigureContactBand;
  /** Passthrough from the real figure's API displayMeta, when present. */
  matteImageId?: string;
  /** Passthrough from the real figure's API displayMeta, when present. */
  matteVersionId?: string;
  /** Passthrough from the real figure's API displayMeta, when present. */
  thumbhash?: string;
  /** Passthrough from the real figure's API displayMeta, when present. */
  dominantColor?: string;
}

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

/**
 * Maps a real figure's fc-shared FigureDisplayMeta API contract into the
 * local render meta the case expects. Width/height/aspect/relHeight aren't
 * part of the API contract (the matting pipeline doesn't know how a figure
 * should be sized on a shelf) — those keep UNMATTED_META's defaults;
 * relHeight is separately resolved from the figure's own heightMm by
 * sizeResolution.ts regardless of which branch getDisplayMeta takes.
 * baseRecovered mirrors contactBand's presence: the pipeline only measures
 * a contact band when it successfully found the figure's base, the same
 * "was the base recoverable" signal FixtureDisplayMeta.baseRecovered
 * already encodes by hand for fixtures.
 */
function mapApiDisplayMeta(apiMeta: ApiFigureDisplayMeta): FigureDisplayMeta {
  return {
    ...UNMATTED_META,
    matted: apiMeta.matted ?? false,
    baseRecovered: Boolean(apiMeta.contactBand),
    footprintCenterX: apiMeta.contactBand?.centerXFrac ?? UNMATTED_META.footprintCenterX,
    footprintWidth: apiMeta.contactBand?.widthFrac ?? UNMATTED_META.footprintWidth,
    bottomMarginFrac: apiMeta.bottomMarginFrac,
    contactBand: apiMeta.contactBand,
    matteImageId: apiMeta.matteImageId,
    matteVersionId: apiMeta.matteVersionId,
    thumbhash: apiMeta.thumbhash,
    dominantColor: apiMeta.dominantColor,
  };
}

/**
 * Resolve display meta for a figure: a real figure's own API-supplied
 * displayMeta takes priority when present (mapApiDisplayMeta); else dev-
 * fixture manifest data; else the unmatted fallback. The `?fx=N`
 * stress-test multiplier suffixes repeated copies as `<id>-xN` — strip
 * that to resolve the original copy's matte metadata.
 */
export function getDisplayMeta(figure: Figure): FigureDisplayMeta {
  if (figure.displayMeta) return mapApiDisplayMeta(figure.displayMeta);
  if (FIXTURE_META[figure._id]) return FIXTURE_META[figure._id];
  const baseId = figure._id.replace(/-x\d+$/, '');
  return FIXTURE_META[baseId] ?? UNMATTED_META;
}

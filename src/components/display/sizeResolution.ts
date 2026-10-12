import type { Figure } from '@figurecollecting/fc-shared';
import type { FigureDisplayMeta } from './displayMeta';

/**
 * Nominal mm-per-scale-unit used to *estimate* physical height when no
 * labeled dimension exists but a scale fraction (e.g. "1/7") does — a rough
 * average adult-human-proportioned figure height assumption, per the
 * size-resolution tree Ross approved (figure_sizing_and_case_dimension_model).
 */
const NOMINAL_CHARACTER_HEIGHT_MM = 1600;

/**
 * No real figure exceeds roughly 2000mm (a large 1/1 life-size statue tops
 * out around ~1700mm): a resolvable heightMm above this is scraper-corrupted
 * data (notably the pre-fix Cheerio concat bug that produced values like
 * "660580570" from concatenated H/W/D strings). The case packer caps at it
 * (measureCaseFigure), so such a figure is a too-tall violator, never an
 * effectively infinite one.
 */
export const MAX_PLAUSIBLE_HEIGHT_MM = 2500;

export type HeightSource = 'labeled' | 'scale-estimate';

export interface ResolvedHeight {
  /** Physical height in mm, resolved via the fallback tree. */
  heightMm: number;
  source: HeightSource;
}

/** Parses "1/7"-style scale strings into a numeric fraction; null if unparseable. */
function parseScaleFraction(scale: string | undefined): number | null {
  if (!scale) return null;
  const match = /^\s*1\s*\/\s*(\d+(\.\d+)?)\s*$/.exec(scale);
  if (!match) return null;
  const denom = Number(match[1]);
  return denom > 0 ? 1 / denom : null;
}

/**
 * Resolve a figure's best-guess physical height in mm. Never throws and
 * never returns a non-finite value — MFC dimension data is unreliable by
 * design (missing, mislabeled, or scraper-concatenated), so every rung of
 * this fallback tree must degrade gracefully instead of assuming a field
 * is present:
 *   1. labeled heightMm, if present and sane (finite, > 0).
 *   2. scale fraction (e.g. "1/7") x nominal 1600mm character height.
 *   3. null — the caller falls back to a default height (packCabinets'
 *      DEFAULT_FIGURE_HEIGHT_MM, flagged as estimated), since there's no
 *      physical signal left to estimate from.
 */
export function resolveHeightMm(figure: Figure): ResolvedHeight | null {
  const labeled = figure.dimensions?.heightMm;
  if (typeof labeled === 'number' && Number.isFinite(labeled) && labeled > 0) {
    return { heightMm: labeled, source: 'labeled' };
  }
  const fraction = parseScaleFraction(figure.scale);
  if (fraction) {
    return { heightMm: fraction * NOMINAL_CHARACTER_HEIGHT_MM, source: 'scale-estimate' };
  }
  return null;
}

/** Typical depth-to-width ratio for a figure's footprint — Ross's estimate
 *  for a "normal" figure stance, used when a real depth measurement isn't
 *  available (figure_sizing_and_case_dimension_model). */
const DEPTH_WIDTH_RATIO = 0.65;

/** Absolute last-resort width (mm) if literally nothing — no labeled width,
 *  no resolvable height to derive one from — is available. Should be
 *  unreachable for any real Figure/FigureDisplayMeta pair (aspect always
 *  exists), kept only so resolveDepthMm is total and never returns 0. */
const FALLBACK_WIDTH_MM = 120;

export type DepthSource = 'labeled' | 'width-ratio' | 'square-fallback';

export interface ResolvedDepth {
  /** Footprint depth in mm, resolved via the fallback tree. */
  depthMm: number;
  source: DepthSource;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Resolve a figure's best-guess footprint depth in mm — how far back it
 * occupies on a shelf, not its height. Same fault-tolerance requirement as
 * resolveHeightMm (MFC dimension data is unreliable by design): every rung
 * degrades gracefully instead of assuming a field is present, and the
 * function is total — it always returns a positive, finite depthMm.
 *   1. labeled depthMm (MFC "L"/"D"), if present and sane.
 *   2. ~0.65x a resolvable widthMm — labeled widthMm if present, else
 *      width derived from the figure's own pixel aspect x its resolved
 *      render height (the same resolved height measureCaseFigure already
 *      computed for this figure — passed in rather than re-derived here,
 *      so height and depth share one resolution pass).
 *   3. square-footprint fallback (depth = the resolved width, uncorrected)
 *      when the 0.65 ratio can't be applied to a trustworthy width — e.g.
 *      no resolvedHeightMm was available to derive one from AND no width
 *      is labeled either. Falls back to FALLBACK_WIDTH_MM in the
 *      (practically unreachable) case that even that's unavailable.
 */
export function resolveDepthMm(
  figure: Figure,
  meta: FigureDisplayMeta,
  resolvedHeightMm: number | null,
): ResolvedDepth {
  const labeledDepth = figure.dimensions?.depthMm;
  if (isPositiveFinite(labeledDepth)) {
    return { depthMm: labeledDepth, source: 'labeled' };
  }

  const labeledWidth = figure.dimensions?.widthMm;
  const derivedWidth = isPositiveFinite(resolvedHeightMm) ? meta.aspect * resolvedHeightMm : null;
  const widthMm = isPositiveFinite(labeledWidth) ? labeledWidth : derivedWidth;

  if (isPositiveFinite(widthMm)) {
    return { depthMm: widthMm * DEPTH_WIDTH_RATIO, source: 'width-ratio' };
  }
  return { depthMm: FALLBACK_WIDTH_MM, source: 'square-fallback' };
}

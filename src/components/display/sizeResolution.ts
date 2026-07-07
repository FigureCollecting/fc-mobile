import type { Figure } from '@figurecollecting/fc-shared';
import type { FigureDisplayMeta } from './displayMeta';

/**
 * Nominal mm-per-scale-unit used to *estimate* physical height when no
 * labeled dimension exists but a scale fraction (e.g. "1/7") does — a rough
 * average adult-human-proportioned figure height assumption, per the
 * size-resolution tree Ross approved (figure_sizing_and_case_dimension_model).
 */
const NOMINAL_CHARACTER_HEIGHT_MM = 1600;

/** Below this, a figure reads as "essentially nothing" next to a collection
 *  outlier — floor it so tap targets and visibility stay reasonable. */
const MIN_REL_HEIGHT = 0.25;

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
 *   3. null — the caller falls back to a per-figure default (see
 *      resolveRelHeights), since there's no physical signal left to
 *      estimate from.
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

/**
 * Compute each figure's relHeight (0..1) proportional to its resolved
 * physical height, relative to the tallest figure in the passed-in set —
 * ONE shared scale across the whole collection being displayed (not
 * renormalized per shelf row), so a figure always renders at the same
 * relative size regardless of which row it lands on. Recomputed whenever
 * the displayed set changes (it's a pure function of `figures`, memoize at
 * the call site), which is what makes it "rolling" rather than frozen.
 *
 * Figures with no resolvable heightMm keep their existing FigureDisplayMeta
 * relHeight — a per-figure default, not forced onto the mm-relative scale,
 * since there's no physical data to relate it to anything else by. This is
 * the tree's final "isolated figure, default band" rung.
 */
export function resolveRelHeights(
  figures: Figure[],
  getMeta: (figure: Figure) => FigureDisplayMeta,
): Map<string, number> {
  const resolved = figures.map((figure) => ({ figure, height: resolveHeightMm(figure) }));
  const maxMm = resolved.reduce((max, r) => (r.height ? Math.max(max, r.height.heightMm) : max), 0);

  const out = new Map<string, number>();
  for (const { figure, height } of resolved) {
    if (height && maxMm > 0) {
      const rel = height.heightMm / maxMm;
      out.set(figure._id, Math.max(MIN_REL_HEIGHT, Math.min(1, rel)));
    } else {
      out.set(figure._id, getMeta(figure).relHeight);
    }
  }
  return out;
}

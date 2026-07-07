/**
 * Converts a figure's resolved footprint depth (mm) into actual 3D
 * placement (px) within a shelf bay — where its billboard sits in Z, and
 * how deep a footprint/shadow to draw on the floor plane.
 *
 * THE CONSTRAINT THIS EXISTS TO PROTECT (Ross): translateZ makes the
 * perspective engine shrink an element. If height-sizing AND depth-
 * recession both scale a figure, a tall figure placed deep could render
 * SMALLER than a short figure up front — which breaks the proportional-
 * height truth already validated. The DEFAULT strategy below avoids that
 * by keeping billboards close to the front (a gentle parallax, not full
 * physical recession) while expressing the real depth difference through
 * the floor-space footprint/shadow instead. 'true-depth' is the escape
 * hatch if stronger parallax is ever wanted over height precision — see
 * PlacementStrategy.
 */

export type PlacementStrategy = 'height-truth' | 'true-depth';

export interface FigureZPlacementOptions {
  strategy: PlacementStrategy;
  /** The bay's own 3D depth (px) — how far back the floor/back-wall
   *  actually recede. Footprint depth is clamped to fit inside it. */
  caseDepthPx: number;
  /** Small uniform offset (px) all figures/footprints sit forward of the
   *  true z=0 front-glass plane, so nothing looks pressed against it. */
  frontMarginPx: number;
}

export interface FigureZPlacement {
  /** The billboard's own translateZ (px, <= 0 — negative recedes from the
   *  viewer). Under 'height-truth' this stays close to 0 regardless of
   *  footprint depth (gentle parallax); under 'true-depth' it recedes the
   *  figure's FULL footprint depth. */
  billboardZPx: number;
  /** Footprint depth (px), clamped to fit within the bay — how deep a
   *  shadow/footprint to draw on the floor plane, from the front margin
   *  back toward the back wall. */
  footprintDepthPx: number;
}

/**
 * Apparent scale a CSS `perspective` projection applies to an element at
 * the given translateZ. Mirrors the browser's own projection math exactly
 * (CSS Transforms: scale = perspective / (perspective - z), z negative for
 * "away from the viewer") — used both to compute placements here and, in
 * tests, to verify the height-truth guarantee against the real formula
 * rather than an approximation.
 */
export function apparentScale(translateZPx: number, perspectivePx: number): number {
  if (!(perspectivePx > 0)) return 1;
  return perspectivePx / (perspectivePx - translateZPx);
}

/**
 * Resolve one figure's Z placement. depthMm/pxPerMm may be any finite
 * number (including absurd or degenerate ones — this is fed by MFC-derived
 * data, see the depth-resolution tree) and this never throws or returns a
 * non-finite/positive-Z result: bad inputs just clamp to 0 recession.
 */
export function computeFigureZPlacement(
  depthMm: number,
  pxPerMm: number,
  options: FigureZPlacementOptions,
): FigureZPlacement {
  const rawFootprintPx = Number.isFinite(depthMm) && Number.isFinite(pxPerMm) ? Math.max(0, depthMm * pxPerMm) : 0;
  // Leave room for the front margin at both ends so the footprint never
  // visually merges into the front glass or the back wall.
  const maxFootprintPx = Math.max(0, options.caseDepthPx - options.frontMarginPx * 2);
  const footprintDepthPx = Math.min(rawFootprintPx, maxFootprintPx);

  const recessionPx = options.strategy === 'true-depth' ? footprintDepthPx : footprintDepthPx / 2;
  const billboardZPx = -(options.frontMarginPx + recessionPx);

  return { billboardZPx, footprintDepthPx };
}

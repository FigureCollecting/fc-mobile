/**
 * Converts a figure's resolved footprint depth (mm) into actual 3D
 * placement (px) within a shelf bay — where its billboard sits in Z, and
 * how deep a footprint/shadow to draw on the floor plane.
 *
 * THE MODEL (Ross, final): proportional physical height sets each figure's
 * TRUE pre-perspective size (resolveRelHeights, unchanged). The perspective
 * transform then applies HONESTLY based on where the figure's footprint
 * actually places it in Z — nothing on top, no post-hoc correction. A
 * taller figure seated further back projecting visually smaller than a
 * shorter one up front is CORRECT, not a bug: real vision reconstructs
 * "tall but far away" from exactly that kind of 2D projection, and
 * apparent-height sensitivity naturally scaling with depth (a small
 * difference near the front reads far larger than the same difference deep
 * in the case) is what SELLS the illusion as real. Artificially clamping
 * or compressing depth to preserve flat on-screen height ordering would
 * break that consistency, so this deliberately does NOT guard against it.
 * DEFAULT strategy ('true-depth') seats each billboard at its FULL
 * resolved footprint depth. 'height-truth' — a gentler, front-anchored
 * placement that suppresses most of the perspective shrink — is kept as
 * the alternate, not because height ordering needs protecting, but as a
 * knob in case stronger height precision is ever wanted over parallax.
 *
 * The only clamps that remain are data/FOV hygiene, not height guards: a
 * garbage/huge resolved depthMm can't fling a figure infinitely far back
 * (footprint depth is capped to fit the bay's own depth), and the bay's
 * perspective distance is chosen so even a figure right at the front
 * doesn't balloon. Neither one touches height ordering.
 */

export type PlacementStrategy = 'height-truth' | 'true-depth';

export interface FigureZPlacementOptions {
  strategy: PlacementStrategy;
  /** The bay's own 3D depth (px) — how far back the floor/back-wall
   *  actually recede. Footprint depth used for PLACEMENT is clamped to fit
   *  inside it (FOV hygiene — see the module doc); the RAW resolved
   *  depthMm a caller separately holds onto (CaseShelf's zPlacements map)
   *  is left unclamped, since that's what a fixed-mode fit-check needs to
   *  flag "too deep for the shelf" rather than silently swallowing it. */
  caseDepthPx: number;
  /** Small uniform offset (px) all figures/footprints sit forward of the
   *  true z=0 front-glass plane, so nothing looks pressed against it. */
  frontMarginPx: number;
}

export interface FigureZPlacement {
  /** The billboard's own translateZ (px, <= 0 — negative recedes from the
   *  viewer). Under 'true-depth' (the default) this recedes the figure's
   *  FULL footprint depth — honest perspective shrink included, by
   *  design. Under 'height-truth' it stays close to the front regardless
   *  of footprint depth (gentle parallax, suppressed shrink). */
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
 * tests, to verify that a deeper-seated figure genuinely projects smaller
 * (perspective doing its job) against the real formula, not an
 * approximation.
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

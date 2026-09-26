import { describe, it, expect } from 'vitest';
import { apparentScale, computeFigureZPlacement } from '../figureDepthPlacement';
import { SHELF_BAND } from '../density';

const OPTS = { caseDepthPx: 100, frontMarginPx: 6 };

describe('apparentScale (CSS perspective projection math)', () => {
  it('is 1.0 at zero translateZ (no depth offset)', () => {
    expect(apparentScale(0, 480)).toBe(1);
  });

  it('shrinks below 1.0 as translateZ recedes (more negative)', () => {
    expect(apparentScale(-50, 480)).toBeLessThan(1);
    expect(apparentScale(-100, 480)).toBeLessThan(apparentScale(-50, 480));
  });

  it('matches the CSS spec formula scale = perspective / (perspective - z) exactly', () => {
    expect(apparentScale(-40, 480)).toBeCloseTo(480 / (480 - -40), 10);
  });
});

describe('computeFigureZPlacement (both placement strategies)', () => {
  it('recedes deeper for a figure with more footprint depth', () => {
    const shallow = computeFigureZPlacement(60, 0.5, { strategy: 'height-truth', ...OPTS });
    const deep = computeFigureZPlacement(160, 0.5, { strategy: 'height-truth', ...OPTS });
    expect(deep.billboardZPx).toBeLessThan(shallow.billboardZPx); // more negative = further back
    expect(deep.footprintDepthPx).toBeGreaterThan(shallow.footprintDepthPx);
  });

  it('clamps footprint depth so it never exceeds the case depth minus front/rear clearance', () => {
    const absurdlyDeep = computeFigureZPlacement(5000, 2, { strategy: 'height-truth', ...OPTS });
    expect(absurdlyDeep.footprintDepthPx).toBeLessThanOrEqual(OPTS.caseDepthPx - OPTS.frontMarginPx * 2);
  });

  it("height-truth strategy seats the billboard at the footprint's center depth (gentle parallax), not the full recession", () => {
    const placement = computeFigureZPlacement(80, 1, { strategy: 'height-truth', ...OPTS });
    expect(placement.billboardZPx).toBeCloseTo(-(OPTS.frontMarginPx + placement.footprintDepthPx / 2), 5);
  });

  it("true-depth strategy seats the billboard at the FULL footprint recession (the knob's alternate mode)", () => {
    const placement = computeFigureZPlacement(80, 1, { strategy: 'true-depth', ...OPTS });
    expect(placement.billboardZPx).toBeCloseTo(-(OPTS.frontMarginPx + placement.footprintDepthPx), 5);
  });

  it('never returns a positive (toward-viewer) Z or a non-finite value for any input', () => {
    const cases = [
      [0, 0],
      [-50, -1],
      [Number.NaN, 1],
      [100000, 0.001],
    ] as const;
    for (const [depthMm, pxPerMm] of cases) {
      const p = computeFigureZPlacement(depthMm, pxPerMm, { strategy: 'height-truth', ...OPTS });
      expect(Number.isFinite(p.billboardZPx)).toBe(true);
      expect(p.billboardZPx).toBeLessThanOrEqual(0);
      expect(Number.isFinite(p.footprintDepthPx)).toBe(true);
      expect(p.footprintDepthPx).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('honest perspective (Ross, final): depth genuinely affects apparent size — no height-ordering guard', () => {
  // Real configured values CaseShelf actually uses (not arbitrary test
  // numbers) — the default 'true-depth' strategy, the perspective, and
  // each density's caseD (band * 0.85).
  const PERSPECTIVE_PX = 480;
  const FRONT_MARGIN_PX = 6;

  function apparentHeightPx(depthMm: number, pxPerMm: number, renderedHeightPx: number, caseDepthPx: number): number {
    const placement = computeFigureZPlacement(depthMm, pxPerMm, {
      strategy: 'true-depth',
      caseDepthPx,
      frontMarginPx: FRONT_MARGIN_PX,
    });
    return renderedHeightPx * apparentScale(placement.billboardZPx, PERSPECTIVE_PX);
  }

  for (const density of ['comfortable', 'compact', 'gallery'] as const) {
    it(`a figure seated deeper projects SMALLER than the identical figure seated near the front, at ${density} density`, () => {
      const band = SHELF_BAND[density];
      const caseDepthPx = Math.round(band * 0.85);
      const sameRenderedHeightPx = band; // identical pre-perspective size

      const nearFront = apparentHeightPx(5, 1, sameRenderedHeightPx, caseDepthPx);
      const seatedDeep = apparentHeightPx(caseDepthPx * 2, 1, sameRenderedHeightPx, caseDepthPx); // clamps to max depth

      // This is the point: perspective is NOT suppressed. The same figure,
      // seated deeper, genuinely reads smaller — that honest shrink is
      // what sells the illusion, not something to guard against.
      expect(seatedDeep).toBeLessThan(nearFront);
    });
  }

  it('a materially taller figure can still project smaller than a materially shorter one if seated deep enough — this is intended, not a bug to catch', () => {
    // Explicitly the case the OLD height-ordering guard used to protect
    // against. No longer guarded — documenting the real behavior instead.
    const caseDepthPx = 100;
    const tallDeep = apparentHeightPx(caseDepthPx * 2, 1, 1.0 * 115, caseDepthPx); // tallest figure, max depth
    const shortFront = apparentHeightPx(1, 1, 0.25 * 115, caseDepthPx); // shortest figure, front
    // Not asserting a direction here on purpose — the real-world outcome
    // depends on how extreme the depth range is. What matters is that
    // BOTH values come out sane (finite, positive) with no artificial
    // correction forcing one particular ordering.
    expect(Number.isFinite(tallDeep)).toBe(true);
    expect(Number.isFinite(shortFront)).toBe(true);
    expect(tallDeep).toBeGreaterThan(0);
    expect(shortFront).toBeGreaterThan(0);
  });
});

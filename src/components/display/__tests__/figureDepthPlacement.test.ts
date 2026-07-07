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

describe('computeFigureZPlacement (height-truth-preserving default placement)', () => {
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

describe('height-truth guard: a tall figure at max depth never renders shorter than a short figure near the front', () => {
  // Real configured values CaseShelf actually uses (not arbitrary test
  // numbers) — the perspective, and each density's caseD (band * 0.85).
  const PERSPECTIVE_PX = 480;
  const FRONT_MARGIN_PX = 6;
  const MIN_REL_HEIGHT = 0.25; // sizeResolution's floor

  for (const density of ['comfortable', 'compact', 'gallery'] as const) {
    it(`holds at ${density} density`, () => {
      const band = SHELF_BAND[density];
      const caseDepthPx = Math.round(band * 0.85);

      // Tallest figure (relHeight 1.0), worst-case deepest footprint —
      // clamp does the heavy lifting, so feed an intentionally absurd mm
      // value to prove the CLAMP (not luck with "reasonable" test inputs)
      // is what protects the guarantee.
      const tall = computeFigureZPlacement(10000, 1, {
        strategy: 'height-truth',
        caseDepthPx,
        frontMarginPx: FRONT_MARGIN_PX,
      });
      const tallRenderedHeightPx = 1.0 * band;
      const tallApparentHeightPx = tallRenderedHeightPx * apparentScale(tall.billboardZPx, PERSPECTIVE_PX);

      // Shortest figure (the MIN_REL_HEIGHT floor), minimal footprint (near
      // the front, negligible recession).
      const short = computeFigureZPlacement(1, 1, {
        strategy: 'height-truth',
        caseDepthPx,
        frontMarginPx: FRONT_MARGIN_PX,
      });
      const shortRenderedHeightPx = MIN_REL_HEIGHT * band;
      const shortApparentHeightPx = shortRenderedHeightPx * apparentScale(short.billboardZPx, PERSPECTIVE_PX);

      expect(tallApparentHeightPx).toBeGreaterThan(shortApparentHeightPx);
    });
  }
});

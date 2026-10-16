import { describe, it, expect } from 'vitest';
import { CENTRE_IN_DEPTH, REPACK_ON_FILTER, baseDepth } from '../caseInterim';

// CASE-FB2a (Ross 10-16): the case's interim layout rules, each behind one switch a saved-layout mode turns off.

/** A KLINGSBO glass shelf: the 314 mm deep plate, its front 12 mm behind the cabinet front. */
const PLATE = { frontZMm: -12, depthMm: 314 };

describe('CASE-FB2a interim layout rules', () => {
  it('both rules are on until saved layouts and saved positions exist', () => {
    expect(REPACK_ON_FILTER).toBe(true);
    expect(CENTRE_IN_DEPTH).toBe(true);
  });

  it('centred: a base stands in the middle of the usable depth, as far from its front as from its back', () => {
    const b = baseDepth(PLATE, 100);
    expect(b.frontMm).toBeCloseTo(-12 - 107, 9);
    expect(b.backMm).toBeCloseTo(-12 - 207, 9);
    expect(PLATE.frontZMm - b.frontMm).toBeCloseTo(b.backMm - (PLATE.frontZMm - PLATE.depthMm), 9);
  });

  it('a base deeper than its surface stands at the surface front and overhangs behind it; one exactly as deep fills it', () => {
    expect(baseDepth(PLATE, 400)).toEqual({ frontMm: -12, backMm: -412 });
    expect(baseDepth(PLATE, 314)).toEqual({ frontMm: -12, backMm: -326 });
  });

  it('no depth: the picture stands at the middle', () => {
    expect(baseDepth(PLATE, 0)).toEqual({ frontMm: -169, backMm: -169 });
  });

  it('off (a saved-layout mode, or the case before CASE-FB2a): the picture at the middle of the depth, the base behind it', () => {
    expect(baseDepth(PLATE, 100, false)).toEqual({ frontMm: -169, backMm: -269 });
  });
});

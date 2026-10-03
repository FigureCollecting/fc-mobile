import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  CEILING_DEFAULT_MM,
  TOP_CLEARANCE_CAP_MM,
  HEADROOM_MIN_MM,
  STACK_TOLERANCE_MM,
  FIT_EPSILON_MM,
  inchesToMm,
  topClearanceRawMm,
  topClearanceMm,
  fitsOnTop,
  framingHeadroomMm,
  clearHeightsMm,
  stackSumMm,
  checkCabinetProfile,
  checkCabinetRegistry,
  unverifiedFields,
  fixedModeCompartmentMm,
  type CabinetProfile,
  type CabinetSurface,
  type Provenance,
} from '../cabinetProfile';

/** Goldens compare within 1e-6 mm (case-cabinet-design-v3 CC9 rounding rule). */
const GOLDEN_EPS = 1e-6;

const MEASURED: Provenance = { kind: 'measured', source: 'test fixture' };

function surface(name: string, topMm: number, thicknessMm = 18): CabinetSurface {
  return { name, topMm, thicknessMm, material: 'wood', maxLoadKg: null, provenance: MEASURED };
}

/**
 * A small valid mm-native cabinet the broken fixtures are cut from:
 * plinth 50, base floor 68, one shelf 518, top 1000 (18 mm boards), so the
 * clear heights are 432 and 464 and the stack is 50 + 3 x 18 + 432 + 464 = 1000.
 */
function box(patch: Partial<CabinetProfile> = {}): CabinetProfile {
  return {
    id: 'box',
    name: 'Test box',
    preferenceRank: 1,
    frame: 'panels',
    outer: { widthMm: 600, depthMm: 400, heightMm: 1000 },
    interior: { widthMm: 564, depthMm: 394 },
    panels: { sideMm: 18, backMm: 6 },
    materials: { sides: 'wood', back: 'solid', front: 'open' },
    glassMm: null,
    surfaces: [surface('base floor', 68), surface('shelf 2', 518), surface('top', 1000)],
    shelves: { mode: 'fixed' },
    top: { usable: true },
    base: { style: 'plinth', heightMm: 50 },
    provenance: {
      outer: MEASURED,
      interior: MEASURED,
      panels: MEASURED,
      boards: MEASURED,
      shelves: MEASURED,
      base: MEASURED,
    },
    ...patch,
  };
}

/** The box at another outer height, its top surface moved with it (only the clearance changes). */
function boxOfHeight(heightMm: number): CabinetProfile {
  return box({
    outer: { widthMm: 600, depthMm: 400, heightMm },
    surfaces: [surface('base floor', 68), surface('shelf 2', 518), surface('top', heightMm)],
  });
}

describe('inch constants (CC9 rounding rule: exact x 25.4, never rounded)', () => {
  it('pins the 24 in cap and the 96 in default ceiling as exact decimals', () => {
    expect(TOP_CLEARANCE_CAP_MM).toBe(609.6);
    expect(CEILING_DEFAULT_MM).toBe(2438.4);
    expect(inchesToMm(24)).toBe(TOP_CLEARANCE_CAP_MM);
    expect(inchesToMm(96)).toBe(CEILING_DEFAULT_MM);
  });

  it('returns the double nearest the exact product, where a bare multiply drifts by an ulp', () => {
    expect(24 * 25.4).not.toBe(609.6); // why inchesToMm exists
    expect(inchesToMm(72)).toBe(1828.8);
    expect(inchesToMm(12)).toBe(304.8);
    expect(inchesToMm(1.75)).toBe(44.45);
    expect(inchesToMm(20.8125)).toBe(528.6375);
    expect(inchesToMm(1 / 64)).toBe(0.396875);
    // the scaled product lands just under the micrometre (492759999.99999994): rounded, not floored
    expect(inchesToMm(19.4)).toBe(492.76);
  });
});

describe('topClearanceMm / topClearanceRawMm (CC9, G17 goldens from camera-out-v3.json cc9)', () => {
  // camera-out-v3.json (DESIGN-RECOMPUTE, 2026-09-30T01:02Z) cc9.goldens: height, raw, clearance.
  it.each([
    ['Detolf', 1630, 609.6, 609.6],
    ['rack (72 in)', 1828.8, 609.6, 609.6],
    ['2000 mm', 2000, 438.4, 438.4],
    ['room height (96 in)', 2438.4, 0, 0],
    ['2500 mm', 2500, -61.6, 0],
  ])('%s: raw %s -> clearance %s within 1e-6 mm', (_label, heightMm, raw, clearance) => {
    const profile = boxOfHeight(heightMm);
    expect(Math.abs(topClearanceRawMm(profile) - raw)).toBeLessThanOrEqual(GOLDEN_EPS);
    expect(Math.abs(topClearanceMm(profile) - clearance)).toBeLessThanOrEqual(GOLDEN_EPS);
  });

  it('defaults the ceiling to 96 in (2438.4 mm)', () => {
    const profile = boxOfHeight(2000);
    expect(topClearanceMm(profile)).toBe(topClearanceMm(profile, 2438.4));
    expect(topClearanceRawMm(profile)).toBe(topClearanceRawMm(profile, 2438.4));
  });

  it('takes a user ceiling: the room binds below the cap, the cap binds above it', () => {
    expect(topClearanceMm(boxOfHeight(1630), 1800)).toBeCloseTo(170, 9);
    expect(topClearanceMm(boxOfHeight(2500), 3000)).toBeCloseTo(500, 9);
    expect(topClearanceMm(boxOfHeight(1630), 3000)).toBe(TOP_CLEARANCE_CAP_MM);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects a non-finite ceiling (%s) instead of returning NaN',
    (ceiling) => {
      expect(() => topClearanceRawMm(boxOfHeight(1630), ceiling)).toThrow(RangeError);
      expect(() => topClearanceMm(boxOfHeight(1630), ceiling)).toThrow(RangeError);
    },
  );

  it('is never negative and never above the cap, for any finite room and cabinet', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -5000, max: 10000, noNaN: true }),
        fc.double({ min: 1, max: 6000, noNaN: true }),
        (ceiling, height) => {
          const profile = boxOfHeight(height);
          const clearance = topClearanceMm(profile, ceiling);
          expect(clearance).toBeGreaterThanOrEqual(0);
          expect(clearance).toBeLessThanOrEqual(TOP_CLEARANCE_CAP_MM);
          expect(clearance).toBe(Math.max(0, topClearanceRawMm(profile, ceiling)));
        },
      ),
    );
  });
});

describe('fitsOnTop (G17: a figure over the clearance is a violator)', () => {
  it('Detolf height: 609.6 mm fits, 610.6 mm (1 mm over) does not', () => {
    const detolfHeight = boxOfHeight(1630);
    expect(fitsOnTop(detolfHeight, 609.6)).toBe(true);
    expect(fitsOnTop(detolfHeight, 610.6)).toBe(false);
    expect(fitsOnTop(detolfHeight, 609.6 + 2 * GOLDEN_EPS)).toBe(false);
  });

  it('the 1e-6 mm tolerance is inclusive at its edge', () => {
    const detolfHeight = boxOfHeight(1630);
    expect(FIT_EPSILON_MM).toBe(GOLDEN_EPS);
    expect(fitsOnTop(detolfHeight, topClearanceMm(detolfHeight) + FIT_EPSILON_MM)).toBe(true);
  });

  it('tolerates float drift within 1e-6 mm (a ceiling typed as 96 * 25.4 on a 72 in rack)', () => {
    const rackHeight = boxOfHeight(1828.8);
    const driftedCeiling = 96 * 25.4; // 2438.3999999999996
    expect(topClearanceMm(rackHeight, driftedCeiling)).toBeLessThan(609.6);
    expect(fitsOnTop(rackHeight, 609.6, driftedCeiling)).toBe(true);
  });

  it('reads the clearance against the ceiling it is given, not the 96 in default (CC9 user ceiling)', () => {
    const detolfHeight = boxOfHeight(1630); // 1800 mm room: clearance 170 mm; the default room allows 609.6
    expect(fitsOnTop(detolfHeight, 170, 1800)).toBe(true);
    expect(fitsOnTop(detolfHeight, 300, 1800)).toBe(false);
    expect(fitsOnTop(detolfHeight, 300)).toBe(true);
  });

  it('a cabinet taller than the room has no usable top: every top figure is a violator', () => {
    expect(fitsOnTop(boxOfHeight(2500), 1)).toBe(false);
  });

  it('a top with no clearance takes nothing, not even a figure inside the 1e-6 mm tolerance', () => {
    for (const height of [0, 5e-7, -10]) {
      expect(fitsOnTop(boxOfHeight(2500), height)).toBe(false);
      expect(fitsOnTop(boxOfHeight(2438.4), height)).toBe(false);
    }
  });

  it('a figure height of zero or less is never reported as fitting', () => {
    expect(fitsOnTop(boxOfHeight(1630), 0)).toBe(false);
    expect(fitsOnTop(boxOfHeight(1630), -10)).toBe(false);
    expect(fitsOnTop(boxOfHeight(1630), 1e-9)).toBe(true);
  });

  it('a profile whose top is not usable takes nothing on top', () => {
    expect(fitsOnTop(box({ top: { usable: false } }), 1)).toBe(false);
  });

  it('an unsized figure (NaN) is never reported as fitting', () => {
    expect(fitsOnTop(boxOfHeight(1630), Number.NaN)).toBe(false);
  });
});

describe('framingHeadroomMm (CC9 headroom goldens from camera-out-v3.json cc9)', () => {
  it.each([
    ['Detolf, new user (nothing on top)', 1630, null, 300],
    ["rack, v2's tallest top figure (417.2 mm)", 1828.8, 417.2, 457.2],
    ['Detolf, a 600 mm top figure (cap binds)', 1630, 600, 609.6],
    ['2200 mm cabinet (clearance under 300 binds)', 2200, null, 238.4],
    ['2500 mm cabinet (no usable top)', 2500, null, 0],
  ])('%s -> %s mm', (_label, heightMm, tallest, headroom) => {
    expect(Math.abs(framingHeadroomMm(boxOfHeight(heightMm), tallest) - headroom)).toBeLessThanOrEqual(GOLDEN_EPS);
  });

  it('keeps the 300 mm minimum for short top figures and pads tall ones by 40 mm', () => {
    expect(framingHeadroomMm(boxOfHeight(1630), 200)).toBe(HEADROOM_MIN_MM);
    expect(framingHeadroomMm(boxOfHeight(1630), 300)).toBe(340);
  });

  it('passes the ceiling through to the clearance cap', () => {
    expect(framingHeadroomMm(boxOfHeight(1630), null, 1830)).toBeCloseTo(200, 9);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])('rejects a non-finite tallest top figure (%s)', (tallest) => {
    expect(() => framingHeadroomMm(boxOfHeight(1630), tallest)).toThrow(RangeError);
  });
});

describe('derived stack: clearHeightsMm and stackSumMm', () => {
  it('derives each compartment from the board under the next surface', () => {
    expect(clearHeightsMm(box())).toEqual([432, 464]);
    expect(stackSumMm(box())).toBe(1000);
  });

  it('a single surface has no compartments; its stack is the base plus its board', () => {
    const topOnly = box({ surfaces: [surface('top', 1000, 950)] });
    expect(clearHeightsMm(topOnly)).toEqual([]);
    expect(stackSumMm(topOnly)).toBe(50 + 950);
  });
});

describe('checkCabinetProfile (G19 registry invariant, every check fails by name)', () => {
  it('passes a consistent profile', () => {
    expect(checkCabinetProfile(box())).toEqual([]);
  });

  it("'ascending': two surfaces at the same height", () => {
    const failures = checkCabinetProfile(
      box({ surfaces: [surface('base floor', 68), surface('shelf 2', 68), surface('top', 1000)] }),
    );
    expect(failures).toContain('ascending');
  });

  it("'ascending': a profile with no surfaces has nothing to stand on", () => {
    expect(checkCabinetProfile(box({ surfaces: [] }))).toContain('ascending');
  });

  it("'gap': a shelf closer to the one below than its own board", () => {
    const tooClose = box({ surfaces: [surface('base floor', 68), surface('shelf 2', 80), surface('top', 1000)] });
    expect(checkCabinetProfile(tooClose)).toEqual(['gap']);
  });

  it("'gap': a shelf exactly one board above the one below is allowed (zero clear)", () => {
    const flush = box({ surfaces: [surface('base floor', 68), surface('shelf 2', 86), surface('top', 1000)] });
    expect(checkCabinetProfile(flush)).toEqual([]);
  });

  it("'top-height': the stack adds up but the top is 10 mm under the outer height", () => {
    const lowTop = box({
      base: { style: 'plinth', heightMm: 60 },
      surfaces: [surface('base floor', 68), surface('shelf 2', 518), surface('top', 990)],
    });
    expect(checkCabinetProfile(lowTop)).toEqual(['top-height']);
  });

  it("'top-height' and 'stack-sum' allow exactly 5 mm and no more", () => {
    expect(STACK_TOLERANCE_MM).toBe(5);
    const at5 = box({
      base: { style: 'plinth', heightMm: 55 },
      surfaces: [surface('base floor', 68), surface('shelf 2', 518), surface('top', 995)],
    });
    expect(checkCabinetProfile(at5)).toEqual([]);
    expect(checkCabinetProfile(box({ base: { style: 'plinth', heightMm: 55 } }))).toEqual([]);
    expect(checkCabinetProfile(box({ base: { style: 'plinth', heightMm: 56 } }))).toEqual(['stack-sum']);
  });

  it("'stack-sum': a plinth 10 mm taller than the base floor allows", () => {
    expect(checkCabinetProfile(box({ base: { style: 'plinth', heightMm: 60 } }))).toEqual(['stack-sum']);
  });

  it("'clearance': a consistent 2500 mm cabinet does not fit the 96 in room", () => {
    expect(checkCabinetProfile(boxOfHeight(2500))).toEqual(['clearance']);
    expect(checkCabinetProfile(boxOfHeight(2438.4))).toEqual([]);
  });

  it("'clearance' uses the ceiling it is given", () => {
    expect(checkCabinetProfile(boxOfHeight(2500), 3000)).toEqual([]);
    expect(checkCabinetProfile(boxOfHeight(1630), 1600)).toEqual(['clearance']);
  });

  it.each<[string, Partial<CabinetProfile>]>([
    ['interior wider than the outer box less its sides', { interior: { widthMm: 565, depthMm: 394 } }],
    ['interior deeper than the outer box less its back', { interior: { widthMm: 564, depthMm: 395 } }],
    ['shelf plate wider than the interior', { plate: { widthMm: 565, depthMm: 300, frontInsetMm: 20 } }],
    ['shelf plate running past the back', { plate: { widthMm: 500, depthMm: 380, frontInsetMm: 20 } }],
    [
      'open rack interior wider than the outer box less its posts',
      {
        frame: 'open-rack',
        panels: { sideMm: 0, backMm: 0 },
        rack: { postMm: 40, beamMm: 18 },
        interior: { widthMm: 530, depthMm: 394 },
      },
    ],
  ])("'interior': %s", (_label, patch) => {
    expect(checkCabinetProfile(box(patch))).toEqual(['interior']);
  });

  it("'interior' accepts a plate and an open rack that fit exactly", () => {
    expect(checkCabinetProfile(box({ plate: { widthMm: 564, depthMm: 374, frontInsetMm: 20 } }))).toEqual([]);
    expect(
      checkCabinetProfile(
        box({
          frame: 'open-rack',
          panels: { sideMm: 0, backMm: 0 },
          rack: { postMm: 40, beamMm: 18 },
          interior: { widthMm: 520, depthMm: 400 },
        }),
      ),
    ).toEqual([]);
  });

  it.each<[string, Partial<CabinetProfile>]>([
    ['preference rank 0', { preferenceRank: 0 }],
    ['fractional preference rank', { preferenceRank: 1.5 }],
    ['negative side panel', { panels: { sideMm: -1, backMm: 6 } }],
    ['negative back panel', { panels: { sideMm: 18, backMm: -1 } }],
    ['zero glass', { glassMm: 0 }],
    [
      // the base floor moves down with it, so only the sign is wrong
      'negative base height',
      {
        base: { style: 'none', heightMm: -1 },
        surfaces: [surface('base floor', 17), surface('shelf 2', 518), surface('top', 1000)],
      },
    ],
    ['zero shelf pin pitch', { shelves: { mode: 'adjustable', pinPitchMm: 0 } }],
    ['zero rack beam', { frame: 'open-rack', rack: { postMm: 0.1, beamMm: 0 } }],
    ['zero rack post', { frame: 'open-rack', rack: { postMm: 0, beamMm: 18 } }],
    ['zero plate depth', { plate: { widthMm: 300, depthMm: 0, frontInsetMm: 20 } }],
    ['negative plate inset', { plate: { widthMm: 300, depthMm: 200, frontInsetMm: -1 } }],
    ['negative top lip', { top: { usable: true, lipMm: -1 } }],
    ['negative leg section', { base: { style: 'plinth', heightMm: 50, leg: { sectionMm: -1 } } }],
    [
      'negative max load',
      {
        surfaces: [
          surface('base floor', 68),
          { ...surface('shelf 2', 518), maxLoadKg: -1 },
          surface('top', 1000),
        ],
      },
    ],
    [
      'zero-thickness middle shelf',
      { surfaces: [surface('base floor', 68), surface('shelf 2', 518, 0), surface('top', 1000)] },
    ],
    ['infinite outer width', { outer: { widthMm: Number.POSITIVE_INFINITY, depthMm: 400, heightMm: 1000 } }],
    ['zero interior width', { interior: { widthMm: 0, depthMm: 394 } }],
    ['zero interior depth', { interior: { widthMm: 564, depthMm: 0 } }],
    [
      'infinite max load',
      {
        surfaces: [
          surface('base floor', 68),
          { ...surface('shelf 2', 518), maxLoadKg: Number.POSITIVE_INFINITY },
          surface('top', 1000),
        ],
      },
    ],
  ])("'dimensions': %s", (_label, patch) => {
    expect(checkCabinetProfile(box(patch))).toEqual(['dimensions']);
  });

  it.each<[string, Partial<CabinetProfile>]>([
    ['infinite side panel', { panels: { sideMm: Number.POSITIVE_INFINITY, backMm: 6 } }],
    ['zero outer depth', { outer: { widthMm: 600, depthMm: 0, heightMm: 1000 } }],
  ])("'dimensions' and 'interior': %s (the interior no longer fits inside it)", (_label, patch) => {
    expect(checkCabinetProfile(box(patch))).toEqual(['dimensions', 'interior']);
  });

  it("'dimensions': non-finite or non-positive outer sizes also fail the checks that use them", () => {
    expect(checkCabinetProfile(box({ outer: { widthMm: 0, depthMm: 400, heightMm: 1000 } }))).toContain('dimensions');
    expect(checkCabinetProfile(box({ outer: { widthMm: 600, depthMm: 400, heightMm: Number.NaN } }))).toEqual(
      expect.arrayContaining(['dimensions', 'top-height', 'stack-sum', 'clearance']),
    );
  });

  it("'dimensions' accepts optional fields that are present and valid", () => {
    expect(
      checkCabinetProfile(
        box({
          glassMm: 5,
          shelves: { mode: 'adjustable', pinPitchMm: 32 },
          top: { usable: true, lipMm: 0 },
          base: { style: 'legs', heightMm: 50, leg: { sectionMm: 40, insetXMm: 0, insetZMm: 0, taper: true } },
          surfaces: [surface('base floor', 68), { ...surface('shelf 2', 518), maxLoadKg: 0 }, surface('top', 1000)],
        }),
      ),
    ).toEqual([]);
  });
});

describe('checkCabinetRegistry', () => {
  const a = box({ id: 'a', preferenceRank: 1 });
  const b = box({ id: 'b', preferenceRank: 2 });

  it('passes unique ids and ranks that include the default', () => {
    expect(checkCabinetRegistry([a, b], 'a')).toEqual([]);
  });

  it('names each registry problem', () => {
    expect(checkCabinetRegistry([a, box({ id: 'a', preferenceRank: 2 })], 'a')).toEqual(['duplicate-id']);
    expect(checkCabinetRegistry([a, box({ id: 'b', preferenceRank: 1 })], 'a')).toEqual(['duplicate-rank']);
    expect(checkCabinetRegistry([a, b], 'c')).toEqual(['missing-default']);
    expect(checkCabinetRegistry([], 'a')).toEqual(['missing-default']);
  });
});

describe('unverifiedFields (what the screen marks: derived = verify, placeholder)', () => {
  it('lists derived and placeholder values, groups first, then surfaces; skips measured, cited and absent groups', () => {
    const profile = box({
      surfaces: [
        surface('base floor', 68),
        { ...surface('shelf 2', 518), provenance: { kind: 'placeholder', source: 'guess' } },
        { ...surface('top', 1000), provenance: { kind: 'cited', source: 'maker' } },
      ],
      provenance: {
        outer: { kind: 'cited', source: 'maker' },
        interior: { kind: 'derived', source: 'outer less panels' },
        panels: MEASURED,
        boards: MEASURED,
        shelves: MEASURED,
        base: MEASURED,
        glass: undefined,
        loads: { kind: 'placeholder', source: 'unknown' },
      },
    });
    expect(unverifiedFields(profile)).toEqual([
      { field: 'interior', kind: 'derived', source: 'outer less panels' },
      { field: 'loads', kind: 'placeholder', source: 'unknown' },
      { field: 'surface:shelf 2', kind: 'placeholder', source: 'guess' },
    ]);
  });

  it('is empty for a fully measured profile', () => {
    expect(unverifiedFields(box())).toEqual([]);
  });
});

describe('fixedModeCompartmentMm (thin adapter for CaseShelf fixed mode)', () => {
  it("returns the smallest interior clear height, so 'fits the band' means fits every compartment", () => {
    expect(fixedModeCompartmentMm(box())).toBe(432);
  });

  it('returns null when the profile has no compartments', () => {
    expect(fixedModeCompartmentMm(box({ surfaces: [surface('top', 1000, 950)] }))).toBeNull();
  });

  it('returns null when the smallest compartment is zero, negative or not a number (it cannot anchor a scale)', () => {
    const flush = box({ surfaces: [surface('base floor', 68), surface('shelf 2', 86), surface('top', 1000)] });
    expect(clearHeightsMm(flush)).toEqual([0, 896]);
    expect(checkCabinetProfile(flush)).toEqual([]); // a valid profile can reach the adapter with a zero gap
    expect(fixedModeCompartmentMm(flush)).toBeNull();
    const overlapping = box({ surfaces: [surface('base floor', 68), surface('shelf 2', 80), surface('top', 1000)] });
    expect(fixedModeCompartmentMm(overlapping)).toBeNull();
    const unsized = box({ surfaces: [surface('base floor', 68), surface('shelf 2', Number.NaN), surface('top', 1000)] });
    expect(fixedModeCompartmentMm(unsized)).toBeNull();
  });

  it('returns a small positive compartment as it is', () => {
    const tight = box({ surfaces: [surface('base floor', 68), surface('shelf 2', 87), surface('top', 1000)] });
    expect(fixedModeCompartmentMm(tight)).toBe(1);
  });
});

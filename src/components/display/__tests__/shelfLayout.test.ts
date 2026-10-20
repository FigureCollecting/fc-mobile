import { describe, it, expect } from 'vitest';
import { STOCK_LAYOUT, checkCabinetProfile, clearHeightsMm, inchesToMm, liftOutShelves, movableShelves, shelfPositionsMm, snapShelfTopMm, withShelfLayout, type CabinetProfile } from '../cabinetProfile';
import { IKEA_DETOLF, IKEA_KLINGSBO, OPEN_STEEL_RACK } from '../cabinetPresets';

// CASE-FB2b (Ross TALL1 10-15, option 1): one cabinet instance's own shelves. A shelf that lifts out (the KLINGSBO's
// and the Detolf's glass) can be taken out; on an adjustable profile (the rack) a shelf moves by its pin pitch. The
// profile as the instance stands is derived from its layout and drawn and packed like any profile.

const tops = (p: { surfaces: readonly { topMm: number }[] }) => p.surfaces.map((s) => s.topMm);

describe('CASE-FB2b shelf layouts: which shelves lift out or move', () => {
  it('the KLINGSBO lifts out its four glass shelves; never its framed floor, its open shelf or its top', () => {
    expect(liftOutShelves(IKEA_KLINGSBO).map((i) => IKEA_KLINGSBO.surfaces[i].name)).toEqual(['glass shelf 2', 'glass shelf 3', 'glass shelf 4', 'glass shelf 5']);
  });

  it("the Detolf lifts out its three glass shelves; never its base board or its top", () => {
    expect(liftOutShelves(IKEA_DETOLF).map((i) => IKEA_DETOLF.surfaces[i].name)).toEqual(['glass shelf 2', 'glass shelf 3', 'glass shelf 4']);
  });

  it("the rack (Ross 10-17, 10-18): every beam, its top one too, moves by the 1.5 in pitch; all but the storage shelf come out; fixed profiles move nothing", () => {
    expect(liftOutShelves(OPEN_STEEL_RACK)).toEqual([1, 2, 3, 4]);
    expect(movableShelves(OPEN_STEEL_RACK)).toEqual([0, 1, 2, 3, 4]);
    expect(movableShelves(IKEA_KLINGSBO)).toEqual([]);
    expect(movableShelves(IKEA_DETOLF)).toEqual([]);
  });

  it('an adjustable profile whose top does not move (no topMoves): every shelf but the top', () => {
    const fixedTop: CabinetProfile = { ...OPEN_STEEL_RACK, shelves: { mode: 'adjustable', pinPitchMm: inchesToMm(2) } };
    expect(movableShelves(fixedTop)).toEqual([0, 1, 2, 3]);
    expect(() => withShelfLayout(fixedTop, { removed: [], moved: [{ index: 4, topMm: inchesToMm(70) }] })).toThrow(RangeError);
  });
});

describe('CASE-FB2b withShelfLayout: the instance as it stands', () => {
  it('the stock layout is the profile itself', () => {
    expect(withShelfLayout(IKEA_KLINGSBO, STOCK_LAYOUT)).toBe(IKEA_KLINGSBO);
  });

  it('a KLINGSBO with glass shelf 3 out: one tier of 532 mm where two of 258 and 257 were, the layout kept on it', () => {
    const one = withShelfLayout(IKEA_KLINGSBO, { removed: [3], moved: [] });
    expect(tops(one)).toEqual([176, 421, 694, 1243, 1519, 1800]);
    expect(clearHeightsMm(one)).toEqual([220, 256, 532, 259, 253]);
    expect(one.layout).toEqual({ removed: [3], moved: [] });
    expect(one.id).toBe(IKEA_KLINGSBO.id);
    // still a sound profile: the stack meets the outer height, the surfaces climb
    expect(checkCabinetProfile(one)).toEqual([]);
    // the preset itself is untouched
    expect(IKEA_KLINGSBO.surfaces).toHaveLength(7);
  });

  it('two glass shelves out next to each other: a tier of 805 mm (Kurumi, over 2 ft, fits)', () => {
    const two = withShelfLayout(IKEA_KLINGSBO, { removed: [2, 3], moved: [] });
    expect(clearHeightsMm(two)).toEqual([220, 805, 259, 253]);
  });

  it('a Detolf with its lowest glass shelf out: the base compartment rises to 787 mm', () => {
    expect(clearHeightsMm(withShelfLayout(IKEA_DETOLF, { removed: [1], moved: [] }))).toEqual([787, 387, 378]);
  });

  it('the rack with shelf 2 moved up three pins (4.5 in): the compartment under it grows, the one above shrinks, both by 4.5 in', () => {
    const moved = withShelfLayout(OPEN_STEEL_RACK, { removed: [], moved: [{ index: 1, topMm: inchesToMm(16.5) }] });
    const before = clearHeightsMm(OPEN_STEEL_RACK);
    const after = clearHeightsMm(moved);
    expect(after[0] - before[0]).toBeCloseTo(inchesToMm(4.5), 6);
    expect(after[1] - before[1]).toBeCloseTo(-inchesToMm(4.5), 6);
    expect(checkCabinetProfile(moved)).toEqual([]);
  });

  it('refuses what the furniture cannot do: a shelf that does not lift out, a move off the pitch, past a neighbour or on a fixed profile, the same shelf twice', () => {
    expect(() => withShelfLayout(IKEA_KLINGSBO, { removed: [1], moved: [] })).toThrow(RangeError); // the framed floor
    expect(() => withShelfLayout(IKEA_KLINGSBO, { removed: [6], moved: [] })).toThrow(RangeError); // the top
    expect(() => withShelfLayout(IKEA_KLINGSBO, { removed: [3, 3], moved: [] })).toThrow(RangeError);
    expect(() => withShelfLayout(IKEA_KLINGSBO, { removed: [], moved: [{ index: 3, topMm: 1000 }] })).toThrow(RangeError);
    expect(() => withShelfLayout(OPEN_STEEL_RACK, { removed: [], moved: [{ index: 1, topMm: inchesToMm(13) }] })).toThrow(RangeError); // 1 in: off the 2 in pitch
    expect(() => withShelfLayout(OPEN_STEEL_RACK, { removed: [], moved: [{ index: 1, topMm: inchesToMm(24) }] })).toThrow(RangeError); // onto shelf 3
    expect(() => withShelfLayout(OPEN_STEEL_RACK, { removed: [1, 2, 3, 4], moved: [] })).toThrow(RangeError); // nothing left to stand on (and no beam in the upper half)
  });
});

describe('CASE-FB2b withShelfLayout: the lowest surface', () => {
  it("may come down to the floor's limit, never below it: the rack's lowest beam (2 in, underside about 2.5 in off the floor) one pin down from 6.5 in to 5 in, not two", () => {
    expect(() => withShelfLayout(OPEN_STEEL_RACK, { removed: [], moved: [{ index: 0, topMm: inchesToMm(5) }] })).not.toThrow();
    expect(() => withShelfLayout(OPEN_STEEL_RACK, { removed: [], moved: [{ index: 0, topMm: inchesToMm(3.5) }] })).toThrow(RangeError);
  });
});

describe("CASE-FB2b the rack's beams (Ross 10-17, 10-18: in 1.5 in steps, within the limits he gave; the storage shelf stays)", () => {
  const tops = OPEN_STEEL_RACK.surfaces.map((x) => x.topMm);

  it('the beams that come out are the display ones whose going leaves two beams in each half (CLEAR-1 stability); the storage shelf never does', () => {
    // the 12 in and 24 in beams: the lower half keeps two; the 47 in and the top: the upper half would keep one
    for (const i of [1, 2]) {
      const without = withShelfLayout(OPEN_STEEL_RACK, { removed: [i], moved: [] });
      expect(without.surfaces.map((x) => x.topMm), `beam ${i}`).toEqual(tops.filter((_, j) => j !== i));
      expect(without.layout?.removed).toEqual([i]);
    }
    for (const i of [0, 3, 4]) expect(() => withShelfLayout(OPEN_STEEL_RACK, { removed: [i], moved: [] }), `beam ${i}`).toThrow(RangeError);
    // shelf 3 out: the 12 in beam's compartment grows to the 47 in beam's underside, 33 in
    expect(clearHeightsMm(withShelfLayout(OPEN_STEEL_RACK, { removed: [2], moved: [] }))[1]).toBeCloseTo(inchesToMm(47 - 2 - 12), 6);
  });

  it('the top beam moves down one notch (1.5 in) at most, never off the pitch, onto shelf 4 or above its posts', () => {
    const lower = withShelfLayout(OPEN_STEEL_RACK, { removed: [], moved: [{ index: 4, topMm: tops[4] - 38.1 }] });
    expect(lower.surfaces[4].topMm).toBeCloseTo(tops[4] - 38.1, 6);
    expect(clearHeightsMm(lower)[3]).toBeCloseTo(clearHeightsMm(OPEN_STEEL_RACK)[3] - 38.1, 6);
    expect(() => withShelfLayout(OPEN_STEEL_RACK, { removed: [], moved: [{ index: 4, topMm: tops[4] - 76.2 }] })).toThrow(RangeError); // two notches
    expect(() => withShelfLayout(OPEN_STEEL_RACK, { removed: [], moved: [{ index: 4, topMm: tops[4] - 25.4 }] })).toThrow(RangeError);
    expect(() => withShelfLayout(OPEN_STEEL_RACK, { removed: [], moved: [{ index: 4, topMm: tops[3] }] })).toThrow(RangeError);
    expect(() => withShelfLayout(OPEN_STEEL_RACK, { removed: [], moved: [{ index: 4, topMm: tops[4] + 38.1 }] })).toThrow(RangeError);
  });

  it('a move that would leave a half of the posts with one beam is refused, as a removal is', () => {
    // the 47 in beam down to 24 in's neighbourhood leaves the upper half with the top only
    expect(() => withShelfLayout(OPEN_STEEL_RACK, { removed: [], moved: [{ index: 3, topMm: inchesToMm(47 - 1.5 * 8) }] })).toThrow(RangeError);
    // the 12 in beam taken out and the 6.5 in one moved up past the middle leaves the lower half with one
    expect(() => withShelfLayout(OPEN_STEEL_RACK, { removed: [2], moved: [{ index: 1, topMm: inchesToMm(12 + 1.5 * 17) }] })).toThrow(RangeError);
    // one that keeps two each side is fine
    expect(() => withShelfLayout(OPEN_STEEL_RACK, { removed: [], moved: [{ index: 2, topMm: inchesToMm(24 + 1.5 * 6) }] })).not.toThrow();
  });

  it('the notches a beam can stand at derive from its own height, the pitch and the limits: the top, the lowest and the grid between', () => {
    const top = shelfPositionsMm(OPEN_STEEL_RACK, 4);
    expect(top).toEqual([tops[4] - 38.1, tops[4]]);
    const lowest = shelfPositionsMm(OPEN_STEEL_RACK, 0);
    expect(lowest[0]).toBeGreaterThanOrEqual(114.3 - 1e-6);
    expect(lowest[0] - 114.3).toBeLessThan(38.1);
    for (const p of lowest) expect(Math.abs((p - tops[0]) / 38.1 - Math.round((p - tops[0]) / 38.1))).toBeLessThan(1e-6);
    expect(lowest).toContain(tops[0]);
    expect(Math.max(...lowest)).toBeLessThanOrEqual(1828.8 + 1e-6);
  });

  it('a wanted height snaps to the nearest notch within the limits', () => {
    expect(snapShelfTopMm(OPEN_STEEL_RACK, 2, inchesToMm(24 + 1.4))).toBeCloseTo(inchesToMm(24 + 1.5), 6);
    expect(snapShelfTopMm(OPEN_STEEL_RACK, 2, inchesToMm(24 - 0.6))).toBeCloseTo(inchesToMm(24), 6);
    expect(snapShelfTopMm(OPEN_STEEL_RACK, 4, inchesToMm(40))).toBeCloseTo(tops[4] - 38.1, 6); // the top: one notch down at most
    expect(snapShelfTopMm(OPEN_STEEL_RACK, 0, 10)).toBeGreaterThanOrEqual(114.3 - 1e-6); // never below the lowest
    expect(snapShelfTopMm(OPEN_STEEL_RACK, 3, 99999)).toBeLessThanOrEqual(1828.8 + 1e-6);
    expect(() => snapShelfTopMm(IKEA_KLINGSBO, 2, 700)).toThrow(RangeError); // a fixed profile moves nothing
  });
});

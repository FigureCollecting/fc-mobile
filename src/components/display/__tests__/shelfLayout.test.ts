import { describe, it, expect } from 'vitest';
import { STOCK_LAYOUT, checkCabinetProfile, clearHeightsMm, inchesToMm, liftOutShelves, movableShelves, withShelfLayout } from '../cabinetProfile';
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

  it('the rack lifts out nothing; its beams move by the 2 in pitch, every one but the top; fixed profiles move nothing', () => {
    expect(liftOutShelves(OPEN_STEEL_RACK)).toEqual([]);
    expect(movableShelves(OPEN_STEEL_RACK)).toEqual([0, 1, 2, 3]);
    expect(movableShelves(IKEA_KLINGSBO)).toEqual([]);
    expect(movableShelves(IKEA_DETOLF)).toEqual([]);
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

  it('the rack with shelf 2 moved up two pins (4 in): the compartment under it grows, the one above shrinks, both by 4 in', () => {
    const moved = withShelfLayout(OPEN_STEEL_RACK, { removed: [], moved: [{ index: 1, topMm: inchesToMm(16) }] });
    const before = clearHeightsMm(OPEN_STEEL_RACK);
    const after = clearHeightsMm(moved);
    expect(after[0] - before[0]).toBeCloseTo(inchesToMm(4), 6);
    expect(after[1] - before[1]).toBeCloseTo(-inchesToMm(4), 6);
    expect(checkCabinetProfile(moved)).toEqual([]);
  });

  it('refuses what the furniture cannot do: a shelf that does not lift out, a move off the pitch, past a neighbour or on a fixed profile, the same shelf twice', () => {
    expect(() => withShelfLayout(IKEA_KLINGSBO, { removed: [1], moved: [] })).toThrow(RangeError); // the framed floor
    expect(() => withShelfLayout(IKEA_KLINGSBO, { removed: [6], moved: [] })).toThrow(RangeError); // the top
    expect(() => withShelfLayout(IKEA_KLINGSBO, { removed: [3, 3], moved: [] })).toThrow(RangeError);
    expect(() => withShelfLayout(IKEA_KLINGSBO, { removed: [], moved: [{ index: 3, topMm: 1000 }] })).toThrow(RangeError);
    expect(() => withShelfLayout(OPEN_STEEL_RACK, { removed: [], moved: [{ index: 1, topMm: inchesToMm(13) }] })).toThrow(RangeError); // 1 in: off the 2 in pitch
    expect(() => withShelfLayout(OPEN_STEEL_RACK, { removed: [], moved: [{ index: 1, topMm: inchesToMm(24) }] })).toThrow(RangeError); // onto shelf 3
    expect(() => withShelfLayout(OPEN_STEEL_RACK, { removed: [], moved: [{ index: 4, topMm: inchesToMm(70) }] })).toThrow(RangeError); // the top
  });
});

describe('CASE-FB2b withShelfLayout: the lowest surface', () => {
  it("may come down to the floor, never below it: the rack's lowest beam (1.75 in) two pins down from 6.5 in, not three", () => {
    expect(() => withShelfLayout(OPEN_STEEL_RACK, { removed: [], moved: [{ index: 0, topMm: inchesToMm(2.5) }] })).not.toThrow();
    expect(() => withShelfLayout(OPEN_STEEL_RACK, { removed: [], moved: [{ index: 0, topMm: inchesToMm(0.5) }] })).toThrow(RangeError);
  });
});

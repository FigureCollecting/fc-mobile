import { describe, it, expect } from 'vitest';
import { STOCK_LAYOUT, checkCabinetProfile, clearHeightsMm, inchesToMm, liftOutShelves, movableShelves, withShelfLayout, type CabinetProfile } from '../cabinetProfile';
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

  it("the rack (Ross 10-17): every beam, its top one too, comes out or moves by the 2 in pitch; fixed profiles move nothing", () => {
    expect(liftOutShelves(OPEN_STEEL_RACK)).toEqual([0, 1, 2, 3, 4]);
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
    expect(() => withShelfLayout(OPEN_STEEL_RACK, { removed: [0, 1, 2, 3, 4], moved: [] })).toThrow(RangeError); // nothing left to stand on
  });
});

describe('CASE-FB2b withShelfLayout: the lowest surface', () => {
  it("may come down to the floor, never below it: the rack's lowest beam (1.75 in) two pins down from 6.5 in, not three", () => {
    expect(() => withShelfLayout(OPEN_STEEL_RACK, { removed: [], moved: [{ index: 0, topMm: inchesToMm(2.5) }] })).not.toThrow();
    expect(() => withShelfLayout(OPEN_STEEL_RACK, { removed: [], moved: [{ index: 0, topMm: inchesToMm(0.5) }] })).toThrow(RangeError);
  });
});

describe("CASE-FB2b the rack's beams (Ross 10-17: all five come out or move, in 2 in steps)", () => {
  const tops = OPEN_STEEL_RACK.surfaces.map((x) => x.topMm);

  it('each beam can come out, the top one too: the one below it is then the top', () => {
    for (let i = 0; i < tops.length; i++) {
      const without = withShelfLayout(OPEN_STEEL_RACK, { removed: [i], moved: [] });
      expect(without.surfaces.map((x) => x.topMm), `beam ${i}`).toEqual(tops.filter((_, j) => j !== i));
      expect(without.layout?.removed).toEqual([i]);
    }
    // shelf 4 out: shelf 3 rises to the top beam, a 46.25 in compartment
    expect(clearHeightsMm(withShelfLayout(OPEN_STEEL_RACK, { removed: [3], moved: [] }))[2]).toBeCloseTo(inchesToMm(72 - 1.75 - 24), 6);
  });

  it('the top beam moves down by whole 2 in (50.8 mm) steps, never off the pitch, onto shelf 4 or above its posts', () => {
    for (const steps of [1, 2, 5]) {
      const lower = withShelfLayout(OPEN_STEEL_RACK, { removed: [], moved: [{ index: 4, topMm: tops[4] - 50.8 * steps }] });
      expect(lower.surfaces[4].topMm).toBeCloseTo(tops[4] - 50.8 * steps, 6);
      expect(clearHeightsMm(lower)[3]).toBeCloseTo(clearHeightsMm(OPEN_STEEL_RACK)[3] - 50.8 * steps, 6);
    }
    expect(() => withShelfLayout(OPEN_STEEL_RACK, { removed: [], moved: [{ index: 4, topMm: tops[4] - 25.4 }] })).toThrow(RangeError);
    expect(() => withShelfLayout(OPEN_STEEL_RACK, { removed: [], moved: [{ index: 4, topMm: tops[3] }] })).toThrow(RangeError);
    expect(() => withShelfLayout(OPEN_STEEL_RACK, { removed: [], moved: [{ index: 4, topMm: tops[4] + 50.8 }] })).toThrow(RangeError);
  });
});

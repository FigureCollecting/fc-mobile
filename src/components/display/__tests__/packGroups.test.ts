import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { Figure } from '@figurecollecting/fc-shared';
import { IKEA_DETOLF, IKEA_KLINGSBO, OPEN_STEEL_RACK } from '../cabinetPresets';
import type { CabinetProfile } from '../cabinetProfile';
import { bareCabinets, fitCheck, packCabinets, PACK_RULES, type CaseFigure, type PackResult } from '../packCabinets';

/**
 * PACK1 (Ross 10-26, Q2 a): the case packs in its arrangement's order, and a gap is filled only with figures of the
 * same group; a later group never takes room an earlier one left behind. A group one shelf could hold is never split
 * across two: it starts on the next shelf when the room left on the shelf it would start on cannot take it whole.
 */

function item(index: number, heightMm: number, widthMm = 100, depthMm = 80): CaseFigure {
  return { figure: { _id: `f${index}`, name: `F${index}` } as Figure, index, heightMm, widthMm, billboardWidthMm: widthMm, depthMm, heightEstimated: false };
}

const TOPS_ONLY = { tallOnOpenedTops: true, shelfRemoval: false } as const;

/** Where each figure stands: [cabinet, its place in the cabinet's reading order (the top first), its order on the surface]. */
function placesOf(result: PackResult): Map<number, [number, number, number]> {
  const at = new Map<number, [number, number, number]>();
  for (const cab of result.cabinets) {
    cab.surfaces.forEach((surf, k) => surf.items.forEach((p, x) => at.set(p.item.index, [cab.index, k, x])));
  }
  return at;
}
const before = (a: readonly number[], b: readonly number[]) => a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])));
const rowsOf = (result: PackResult, cab = 0) => result.cabinets[cab].surfaces.map((s) => s.items.map((p) => p.item.index));

// the Detolf: its 430 mm top first, then 383 mm glass shelves; every figure here 200 mm tall fits all of them
describe('PACK1: gaps are filled only within a group', () => {
  // 250 + 10 leaves 170 mm of the top; the next 250 does not fit it
  const three = [item(0, 200, 250), item(1, 200, 250), item(2, 200, 100)];

  it('a later figure of the same group fills the gap its group left: the 100 mm one stands on the top beside the first', () => {
    const packed = packCabinets(three, [IKEA_DETOLF], undefined, PACK_RULES, ['A', 'A', 'A']);
    expect(rowsOf(packed).slice(0, 2)).toEqual([[0, 2], [1]]);
  });

  it("a later group never fills an earlier group's gap: the top keeps its 170 mm empty, the group starts where its shelf left off", () => {
    const packed = packCabinets(three, [IKEA_DETOLF], undefined, PACK_RULES, ['A', 'A', 'B']);
    expect(rowsOf(packed).slice(0, 2)).toEqual([[0], [1, 2]]);
  });

  it('figures that stand alone (name, date added) keep the strict order: no gap is filled', () => {
    const packed = packCabinets(three, [IKEA_DETOLF], undefined, PACK_RULES, [null, null, null]);
    expect(rowsOf(packed).slice(0, 2)).toEqual([[0], [1, 2]]);
  });

  it("standing alone, every figure packs exactly as today's packer packs that order (the tall ones too)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ h: fc.double({ min: 40, max: 700, noNaN: true }), w: fc.double({ min: 20, max: 400, noNaN: true }) }), { maxLength: 50 }),
        fc.constantFrom<CabinetProfile[]>([IKEA_KLINGSBO], [IKEA_DETOLF], [IKEA_KLINGSBO, IKEA_DETOLF, OPEN_STEEL_RACK]),
        (specs, pattern) => {
          const items = specs.map((s, i) => item(i, s.h, s.w));
          expect(packCabinets(items, pattern, undefined, PACK_RULES, items.map(() => null))).toEqual(packCabinets(items, pattern));
        },
      ),
      { numRuns: 60 },
    );
  });

  describe('where a group starts: a group one shelf holds is never split', () => {
    it('it starts on the room left when it fits there whole', () => {
      // 200 + 10 leaves 220 mm of the top: two 100 mm figures take 210
      const packed = packCabinets([item(0, 200, 200), item(1, 200, 100), item(2, 200, 100)], [IKEA_DETOLF], undefined, PACK_RULES, ['A', 'B', 'B']);
      expect(rowsOf(packed)[0]).toEqual([0, 1, 2]);
    });

    it('it starts on the next shelf, whole, when the room left cannot take it all (not one there and one below)', () => {
      // 300 + 10 leaves 120 mm of the top: one 100 mm figure would fit it, the pair does not
      const packed = packCabinets([item(0, 200, 300), item(1, 200, 100), item(2, 200, 100)], [IKEA_DETOLF], undefined, PACK_RULES, ['A', 'B', 'B']);
      expect(rowsOf(packed).slice(0, 2)).toEqual([[0], [1, 2]]);
    });

    it('a group wider than a shelf starts on the room left: it could never stand whole on one shelf', () => {
      const wide = [item(0, 200, 300), ...Array.from({ length: 5 }, (_, i) => item(i + 1, 200, 100))];
      const packed = packCabinets(wide, [IKEA_DETOLF], undefined, PACK_RULES, ['A', 'B', 'B', 'B', 'B', 'B']);
      expect(rowsOf(packed).slice(0, 2)).toEqual([[0, 1], [2, 3, 4]]);
    });

    it('a figure of the group too tall for the room left: the group starts on the next shelf', () => {
      // after A on the first glass shelf (378 mm high), a 200 mm figure would fit the 123 mm left, its 390 mm partner (only
      // the 396 mm base floor takes it) would not: the group starts on the next shelf, the room left stays empty
      const packed = packCabinets([item(0, 200, 380), item(1, 200, 250), item(2, 200, 50), item(3, 390, 50)], [IKEA_DETOLF], undefined, PACK_RULES, ['A', 'A', 'B', 'B']);
      expect(rowsOf(packed)).toEqual([[0], [1], [2], [], [3]]);
    });

    it('a group with no shelf figures starts where the cursor is', () => {
      const packed = packCabinets([item(0, 200, 300), item(1, 500, 100)], [IKEA_DETOLF], undefined, TOPS_ONLY, ['A', 'B']);
      expect(rowsOf(packed)[0]).toEqual([0, 1]);
    });
  });

  describe('tall figures (a top or a tier) keep to their group too', () => {
    // a 300 mm wide tall figure on the Detolf top leaves 120 mm; 13 shelf figures fill the first Detolf and open a second;
    // then a 100 mm wide tall figure
    const wall = [item(0, 450, 300), ...Array.from({ length: 13 }, (_, i) => item(i + 1, 300, 180)), item(14, 450, 100)];
    const topOf = (packed: PackResult, cab: number) => packed.cabinets[cab].surfaces.find((s) => s.slot.isTop)!.items.map((p) => p.item.index);

    it('of the same group: it fills the room its group left on the first top', () => {
      const packed = packCabinets(wall, [IKEA_DETOLF], undefined, TOPS_ONLY, wall.map(() => 'A'));
      expect(topOf(packed, 0)).toEqual([0, 14]);
    });

    it("of a later group: never the first top's room; it stands from where its group starts on", () => {
      const packed = packCabinets(wall, [IKEA_DETOLF], undefined, TOPS_ONLY, wall.map((_, i) => (i < 14 ? 'A' : 'B')));
      expect(topOf(packed, 0)).toEqual([0]);
      expect(placesOf(packed).get(14)![0]).toBeGreaterThanOrEqual(1);
    });

    it('of a later group: an empty top or tier of the cabinet where its group starts is no gap; it may stand there', () => {
      // the KLINGSBO keeps its top for the 300 mm one (no stock compartment takes it); the shelf figures of the group
      // before it stand inside, so its group starts below the top: it still takes the top kept empty for it
      const items = [item(0, 200, 100), item(1, 200, 100), item(2, 200, 100), item(3, 300, 245)];
      const packed = packCabinets(items, [IKEA_KLINGSBO], undefined, PACK_RULES, ['A', 'A', 'A', 'B']);
      expect(packed.cabinets).toHaveLength(1);
      expect(packed.cabinets[0].surfaces.find((x) => x.slot.isTop)!.items.map((p) => p.item.index)).toEqual([3]);
    });

    it("of a later group: a top holding an earlier group's figures is that group's gap, kept from it", () => {
      const packed = packCabinets(wall, [IKEA_DETOLF], undefined, TOPS_ONLY, wall.map((_, i) => (i < 14 ? 'A' : 'B')));
      expect(packed.cabinets.slice(0, 2).map((c) => c.surfaces.find((x) => x.slot.isTop)!.items.some((p) => p.item.index === 14))).toEqual([false, false]);
    });

    it("standing alone: today's rule, the earliest top with room", () => {
      const packed = packCabinets(wall, [IKEA_DETOLF], undefined, TOPS_ONLY, wall.map(() => null));
      expect(topOf(packed, 0)).toEqual([0, 14]);
    });
  });

  it('on any wall, a figure of a later group never stands before a shelf figure of an earlier one, and every figure stands once or is listed', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            h: fc.double({ min: 40, max: 700, noNaN: true }),
            w: fc.double({ min: 20, max: 450, noNaN: true }),
            d: fc.double({ min: 20, max: 420, noNaN: true }),
            g: fc.constantFrom('a', 'b', 'c', 'd', null),
          }),
          { maxLength: 60 },
        ),
        fc.constantFrom<CabinetProfile[]>([IKEA_KLINGSBO], [IKEA_DETOLF], [OPEN_STEEL_RACK], [IKEA_KLINGSBO, IKEA_DETOLF, OPEN_STEEL_RACK]),
        (specs, pattern) => {
          // the arrangement's order: by group, those standing alone last
          const key = (g: string | null) => g ?? '~';
          const sorted = [...specs].sort((x, y) => (key(x.g) < key(y.g) ? -1 : key(x.g) > key(y.g) ? 1 : 0));
          const items = sorted.map((s, i) => item(i, s.h, s.w, s.d));
          const groups = sorted.map((s) => s.g);
          const packed = packCabinets(items, pattern, undefined, PACK_RULES, groups);
          const at = placesOf(packed);
          expect([...at.keys(), ...packed.violators.map((v) => v.item.index)].sort((a, b) => a - b)).toEqual(items.map((i) => i.index));
          // a shelf figure: one every cabinet of the pattern takes on a stock shelf (it never waits for a tier or a top)
          const placed = (p: [number, number, number]) => packed.cabinets[p[0]].surfaces[p[1]].items[p[2]].item;
          const shelf = (p: [number, number, number]) => pattern.every((profile) => fitCheck(profile, placed(p), undefined, false).verdict === 'fits');
          const rank = (i: number) => (groups[i] === null ? i : groups.indexOf(groups[i]));
          for (const [x, px] of at) {
            if (!shelf(px)) continue;
            for (const [y, py] of at) {
              // every figure of a later group stands after it (a tall one may take a tier or top left empty in its cabinet,
              // never one in an earlier cabinet); one standing alone does when it is a shelf figure too
              if (y <= x || rank(y) <= rank(x) || (groups[y] === null && !shelf(py))) continue;
              if (shelf(py)) expect(before(py, px), `${y} (${groups[y]}) before ${x} (${groups[x]})`).toBe(false);
              else expect(py[0], `${y} (${groups[y]}) in a cabinet before ${x} (${groups[x]})`).toBeGreaterThanOrEqual(px[0]);
            }
          }
        },
      ),
      { numRuns: 150 },
    );
  });
});

// CASE-FB2b packs again with more tiers while a cabinet before the last stands with nothing on its shelves. A grouped wall
// ends with the cabinets opened for tall figures whose group could take no earlier place: no lean changes those, so they
// are its end, not a bare cabinet within it (seven packings of a grouped wall for nothing, measured 4-6x the list's)
describe('bare cabinets (CASE-FB2b, PACK1)', () => {
  const fig0 = item(0, 200);
  /** A KLINGSBO-like cabinet: its top, one shelf; a figure on the shelf, or only one on the top. */
  const cab = (onShelf: boolean) => ({ slots: [{ isTop: true }, { isTop: false }], tall: new Set<number>(), rows: onShelf ? [[], [fig0]] : [[fig0], []] });

  it('without groups: every cabinet before the last with nothing on its shelves, the wall\'s end too', () => {
    expect(bareCabinets([cab(true), cab(false), cab(false), cab(false)], false)).toBe(2);
    expect(bareCabinets([cab(true), cab(false)], false)).toBe(0);
  });

  it('grouped: the tall-only cabinets after the last with a shelf figure are the wall\'s end, not bare', () => {
    expect(bareCabinets([cab(true), cab(true), cab(false), cab(false), cab(false)], true)).toBe(0);
  });

  it('grouped: a cabinet within the wall with nothing on its shelves is still bare', () => {
    expect(bareCabinets([cab(true), cab(false), cab(true), cab(false)], true)).toBe(1);
  });

  it('a tier is no shelf: a cabinet with a figure only in a tier is bare', () => {
    const tiered = { slots: [{ isTop: true }, { isTop: false }], tall: new Set([1]), rows: [[], [fig0]] };
    expect(bareCabinets([tiered, cab(true)], true)).toBe(1);
    expect(bareCabinets([tiered, cab(true)], false)).toBe(1);
  });
});


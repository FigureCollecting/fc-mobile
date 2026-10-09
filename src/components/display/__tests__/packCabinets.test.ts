import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { Figure } from '@figurecollecting/fc-shared';
import { IKEA_DETOLF, OPEN_STEEL_RACK, UNIT_A } from '../cabinetPresets';
import type { CabinetProfile } from '../cabinetProfile';
import {
  DEFAULT_FIGURE_HEIGHT_MM,
  FIGURE_GAP_MM,
  fitCheck,
  measureCaseFigure,
  packCabinets,
  surfaceSlots,
  type CaseFigure,
} from '../packCabinets';
import { UNMATTED_META } from '../displayMeta';

function item(index: number, heightMm: number, widthMm = 100, depthMm = 80): CaseFigure {
  return {
    figure: { _id: `f${index}`, name: `F${index}` } as Figure,
    index,
    heightMm,
    widthMm,
    billboardWidthMm: widthMm,
    depthMm,
    heightEstimated: false,
  };
}

describe('surfaceSlots', () => {
  it('reads the Detolf top first, then the shelves top to bottom, each with its own size limits', () => {
    const slots = surfaceSlots(IKEA_DETOLF);
    expect(slots.map((s) => s.surfaceIndex)).toEqual([4, 3, 2, 1, 0]);
    const [top, shelf4, , , base] = slots;
    expect(top).toMatchObject({ isTop: true, widthMm: 430, depthMm: 370, frontZMm: 0 });
    expect(top.maxHeightMm).toBeCloseTo(609.6, 6);
    // glass shelves carry the 383 x 290 plate, 20 mm back from the front
    expect(shelf4).toMatchObject({ isTop: false, widthMm: 383, depthMm: 290, frontZMm: -20, maxHeightMm: 378 });
    // the base floor is wood: the whole interior
    expect(base).toMatchObject({ widthMm: 389, depthMm: 330, maxHeightMm: 396 });
  });

  it('a profile whose top is not usable has no top slot', () => {
    const closed: CabinetProfile = { ...UNIT_A, top: { usable: false } };
    expect(surfaceSlots(closed).some((s) => s.isTop)).toBe(false);
  });

  it('the rack: open frame, interior between the posts', () => {
    const slots = surfaceSlots(OPEN_STEEL_RACK);
    expect(slots).toHaveLength(5);
    expect(slots[1].widthMm).toBeCloseTo(OPEN_STEEL_RACK.interior.widthMm, 6);
    expect(slots[1].frontZMm).toBeCloseTo(-OPEN_STEEL_RACK.rack!.postMm, 6);
  });
});

describe('fitCheck (FIT-CHECK)', () => {
  it('a figure that fits a Detolf compartment fits', () => {
    expect(fitCheck(IKEA_DETOLF, item(0, 300)).verdict).toBe('fits');
  });

  it('a figure taller than every compartment but within the 24 in clearance goes on the top only', () => {
    expect(fitCheck(IKEA_DETOLF, item(0, 450)).verdict).toBe('top-only');
    expect(fitCheck(IKEA_DETOLF, item(0, 609.6)).verdict).toBe('top-only');
  });

  it('a known too-tall figure is flagged in the Detolf: 1 mm over the 609.6 mm clearance', () => {
    const r = fitCheck(IKEA_DETOLF, item(0, 610.6));
    expect(r.verdict).toBe('too-tall');
    expect(r.tooTall).toBe(true);
  });

  it('a figure deeper than any Detolf surface is too deep; one deeper than the plate only is flagged where placed', () => {
    expect(fitCheck(IKEA_DETOLF, item(0, 200, 100, 371)).verdict).toBe('too-deep');
    const plateOnly = fitCheck(IKEA_DETOLF, item(0, 200, 100, 300));
    expect(plateOnly.verdict).toBe('fits');
    expect(plateOnly.tooDeep).toBe(false);
  });

  it('a figure wider than every surface is too wide', () => {
    expect(fitCheck(IKEA_DETOLF, item(0, 200, 431)).verdict).toBe('too-wide');
  });

  it('a lower ceiling shrinks what the top takes', () => {
    expect(fitCheck(IKEA_DETOLF, item(0, 500), 1630 + 400).verdict).toBe('too-tall');
  });
});

describe('packCabinets', () => {
  it('fills the top first, then the shelves top to bottom, left to right, never scaling a figure', () => {
    const items = [item(0, 200, 105), item(1, 210, 105), item(2, 220, 105), item(3, 230, 105), item(4, 240, 105)];
    const { cabinets, violators } = packCabinets(items, [IKEA_DETOLF]);
    expect(violators).toEqual([]);
    expect(cabinets).toHaveLength(1);
    const top = cabinets[0].surfaces.find((s) => s.surfaceIndex === 4)!;
    // 430 wide top: 3 x 105 + 2 x 10 = 335 fits, a fourth (450) does not
    expect(top.items.map((p) => p.item.index)).toEqual([0, 1, 2]);
    const shelf4 = cabinets[0].surfaces.find((s) => s.surfaceIndex === 3)!;
    expect(shelf4.items.map((p) => p.item.index)).toEqual([3, 4]);
    for (const s of cabinets[0].surfaces) for (const p of s.items) expect(p.heightMm).toBe(p.item.heightMm);
  });

  it('centres each row on its surface with FIGURE_GAP_MM between figures', () => {
    const { cabinets } = packCabinets([item(0, 200), item(1, 200)], [IKEA_DETOLF]);
    const top = cabinets[0].surfaces.find((s) => s.surfaceIndex === 4)!;
    const [a, b] = top.items;
    expect(b.xMm - (a.xMm + 100)).toBeCloseTo(FIGURE_GAP_MM, 9);
    // centred across 430 mm: (430 - 210) / 2 = 110 from the left
    expect(a.xMm).toBeCloseTo((430 - (200 + FIGURE_GAP_MM)) / 2, 9);
    expect(a.zMm).toBeCloseTo(-185, 9); // middle of the 370 mm deep top
  });

  it('overflow opens a new cabinet', () => {
    const items = Array.from({ length: 30 }, (_, i) => item(i, 200, 180));
    const { cabinets } = packCabinets(items, [IKEA_DETOLF]);
    expect(cabinets.length).toBeGreaterThan(1);
    expect(cabinets[1].index).toBe(1);
  });

  it('a figure taller than every compartment goes to its cabinet top even when the reading order has passed it', () => {
    const items = [item(0, 200, 300), item(1, 200, 300), item(2, 500, 120)];
    const { cabinets, violators } = packCabinets(items, [IKEA_DETOLF]);
    expect(violators).toEqual([]);
    const top = cabinets[0].surfaces.find((s) => s.surfaceIndex === 4)!;
    expect(top.items.map((p) => p.item.index)).toEqual([0, 2]);
  });

  it('the top takes a figure of exactly the clearance; 1 mm over is a violator, never placed', () => {
    const { cabinets, violators } = packCabinets([item(0, 609.6), item(1, 610.6)], [IKEA_DETOLF]);
    expect(violators).toEqual([{ item: expect.objectContaining({ index: 1 }), reason: 'too-tall' }]);
    expect(cabinets[0].surfaces.flatMap((s) => s.items.map((p) => p.item.index))).toEqual([0]);
  });

  it('too wide and too deep figures are violators; deeper than a plate is flagged where it stands', () => {
    const { cabinets, violators } = packCabinets(
      [item(0, 200, 500), item(1, 200, 100, 400), item(2, 300, 250, 300), item(3, 300, 250, 300)],
      [IKEA_DETOLF],
    );
    expect(violators.map((v) => [v.item.index, v.reason])).toEqual([
      [0, 'too-wide'],
      [1, 'too-deep'],
    ]);
    const placed = cabinets[0].surfaces.flatMap((s) => s.items);
    // item 2 lands on the top (370 deep: fine); item 3 on the glass shelf below (290 deep: flagged)
    expect(placed.map((p) => [p.item.index, p.tooDeep])).toEqual([
      [2, false],
      [3, true],
    ]);
  });

  it('a wall pattern cycles the profiles: the Detolf with the rack alongside', () => {
    const items = Array.from({ length: 40 }, (_, i) => item(i, 200, 180));
    const { cabinets } = packCabinets(items, [IKEA_DETOLF, OPEN_STEEL_RACK]);
    expect(cabinets.slice(0, 3).map((c) => c.profile.id)).toEqual(['ikea-detolf', 'open-steel-rack', 'ikea-detolf']);
  });

  it('nothing to pack: no cabinets; an empty pattern throws', () => {
    expect(packCabinets([], [IKEA_DETOLF])).toEqual({ cabinets: [], violators: [] });
    expect(() => packCabinets([item(0, 100)], [])).toThrow(RangeError);
  });

  it('every figure is placed once or listed as a violator; rows never overlap or overrun; reading order holds per surface', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            h: fc.double({ min: 40, max: 700, noNaN: true }),
            w: fc.double({ min: 20, max: 450, noNaN: true }),
            d: fc.double({ min: 20, max: 420, noNaN: true }),
          }),
          { maxLength: 60 },
        ),
        fc.constantFrom([IKEA_DETOLF], [OPEN_STEEL_RACK], [IKEA_DETOLF, OPEN_STEEL_RACK]),
        (specs, pattern) => {
          const items = specs.map((s, i) => item(i, s.h, s.w, s.d));
          const { cabinets, violators } = packCabinets(items, pattern);
          const seen = [...violators.map((v) => v.item.index)];
          for (const cab of cabinets) {
            for (const surf of cab.surfaces) {
              const slot = surfaceSlots(cab.profile).find((s) => s.surfaceIndex === surf.surfaceIndex)!;
              let right = -Infinity;
              let lastIndex = -1;
              for (const p of surf.items) {
                expect(p.xMm).toBeGreaterThanOrEqual(-1e-9);
                expect(p.xMm + p.item.widthMm).toBeLessThanOrEqual(slot.widthMm + 1e-9);
                expect(p.xMm).toBeGreaterThanOrEqual(right - 1e-9);
                expect(p.item.heightMm).toBeLessThanOrEqual(slot.maxHeightMm + 1e-6);
                right = p.xMm + p.item.widthMm;
                if (!slot.isTop) expect(p.item.index).toBeGreaterThan(lastIndex);
                lastIndex = p.item.index;
                seen.push(p.item.index);
              }
            }
          }
          expect(seen.sort((a, b) => a - b)).toEqual(items.map((i) => i.index));
        },
      ),
      { numRuns: 150 },
    );
  });

  it("packs 1,144 synthetic figures (Ross's collection size) on the Detolf and on the rack", () => {
    const items = Array.from({ length: 1144 }, (_, i) => item(i, 90 + ((i * 37) % 420), 60 + ((i * 53) % 260), 50 + ((i * 29) % 300)));
    for (const profile of [IKEA_DETOLF, OPEN_STEEL_RACK]) {
      const { cabinets, violators } = packCabinets(items, [profile]);
      const placed = cabinets.reduce((n, c) => n + c.surfaces.reduce((m, s) => m + s.items.length, 0), 0);
      expect(placed + violators.length).toBe(1144);
      expect(cabinets.length).toBeGreaterThan(10);
    }
  });
});

describe('measureCaseFigure', () => {
  const fig = (patch: Partial<Figure>) => ({ _id: 'x', name: 'X', scale: '', ...patch }) as Figure;

  it('a labelled height and width are used as given', () => {
    const m = measureCaseFigure(fig({ dimensions: { heightMm: 250, widthMm: 120, depthMm: 90 } }), 3, UNMATTED_META);
    expect(m).toMatchObject({ index: 3, heightMm: 250, widthMm: 120, depthMm: 90, heightEstimated: false });
    // the picture keeps its own shape: 0.75 x 250
    expect(m.billboardWidthMm).toBeCloseTo(187.5, 9);
  });

  it('a scale estimates the height (flagged); no width comes from the picture', () => {
    const m = measureCaseFigure(fig({ scale: '1/8' }), 0, UNMATTED_META);
    expect(m.heightMm).toBeCloseTo(200, 9);
    expect(m.heightEstimated).toBe(true);
    expect(m.widthMm).toBeCloseTo(150, 9);
  });

  it('with nothing to go on, a default height (flagged)', () => {
    const m = measureCaseFigure(fig({}), 0, UNMATTED_META);
    expect(m.heightMm).toBe(DEFAULT_FIGURE_HEIGHT_MM);
    expect(m.heightEstimated).toBe(true);
  });

  it('a corrupt height is capped at 2500 mm', () => {
    expect(measureCaseFigure(fig({ dimensions: { heightMm: 660580570 } }), 0, UNMATTED_META).heightMm).toBe(2500);
  });
});

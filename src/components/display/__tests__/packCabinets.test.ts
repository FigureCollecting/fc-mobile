import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { Figure } from '@figurecollecting/fc-shared';
import { IKEA_DETOLF, IKEA_KLINGSBO, OPEN_STEEL_RACK } from '../cabinetPresets';
import type { CabinetProfile } from '../cabinetProfile';
import {
  DEFAULT_FIGURE_HEIGHT_MM,
  FIGURE_GAP_MM,
  fitCheck,
  measureCaseFigure,
  packCabinets,
  surfaceSlots,
  wallLayout,
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

  it('the KLINGSBO: the glass shelves are the plate; the cabinet floor and the open shelf below the door span the interior', () => {
    const slots = surfaceSlots(IKEA_KLINGSBO);
    expect(slots.map((s) => s.surfaceIndex)).toEqual([6, 5, 4, 3, 2, 1, 0]);
    expect(slots[0]).toMatchObject({ isTop: true, widthMm: 450, depthMm: 400, frontZMm: 0 });
    expect(slots[1]).toMatchObject({ widthMm: 359, depthMm: 314, frontZMm: -12, maxHeightMm: 253 });
    expect(slots[5]).toMatchObject({ widthMm: 382, depthMm: 335, frontZMm: -4, maxHeightMm: 256 });
    // the open shelf has no door in front of it
    expect(slots[6]).toMatchObject({ widthMm: 382, depthMm: 335, frontZMm: 0, maxHeightMm: 220 });
  });

  it('a profile whose top is not usable has no top slot', () => {
    const closed: CabinetProfile = { ...IKEA_KLINGSBO, top: { usable: false } };
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

  it('the KLINGSBO default: a 610.6 mm figure is too tall, a 401 mm deep one too deep, a 300 mm one only on the top, a 259 mm one inside', () => {
    expect(fitCheck(IKEA_KLINGSBO, item(0, 610.6)).verdict).toBe('too-tall');
    expect(fitCheck(IKEA_KLINGSBO, item(0, 200, 100, 401)).verdict).toBe('too-deep');
    expect(fitCheck(IKEA_KLINGSBO, item(0, 300)).verdict).toBe('top-only');
    expect(fitCheck(IKEA_KLINGSBO, item(0, 259)).verdict).toBe('fits');
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
    // CASE-FB2a: its 80 mm base centred in the 370 mm deep top, the picture at the base's front
    expect(a.base).toEqual({ frontMm: -145, backMm: -225 });
    expect(a.zMm).toBeCloseTo(-145, 9);
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

  it('the comparison wall cycles KLINGSBO, Detolf, rack (Ross 10-11: KLINGSBO first, the Detolf and the rack alongside)', () => {
    const items = Array.from({ length: 60 }, (_, i) => item(i, 200, 180));
    const { cabinets } = packCabinets(items, [IKEA_KLINGSBO, IKEA_DETOLF, OPEN_STEEL_RACK]);
    expect(cabinets.slice(0, 4).map((c) => c.profile.id)).toEqual(['ikea-klingsbo', 'ikea-detolf', 'open-steel-rack', 'ikea-klingsbo']);
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

describe('wallLayout (side by side, the adjacency gap between neighbours)', () => {
  it('stands two KLINGSBOs 95 mm apart, a Detolf 47.5 mm from a KLINGSBO and touching the rack', () => {
    const wall = wallLayout([IKEA_KLINGSBO, IKEA_KLINGSBO, IKEA_DETOLF, OPEN_STEEL_RACK]);
    expect(wall.cabinets.map((c) => [c.leftMm, c.rightMm])).toEqual([
      [0, 450],
      [545, 995],
      [1042.5, 1472.5],
      [1472.5, 1472.5 + 914.4],
    ]);
    expect(wall.cabinets.map((c) => c.centerMm)).toEqual([225, 770, 1257.5, 1472.5 + 457.2]);
    expect(wall.cabinets.map((c) => c.gapBeforeMm)).toEqual([0, 95, 47.5, 0]);
  });

  it("reaches out to the first and last cabinet's feet", () => {
    const wall = wallLayout([IKEA_KLINGSBO, IKEA_DETOLF]);
    expect(wall.leftMm).toBe(-47.5);
    expect(wall.rightMm).toBe(450 + 47.5 + 430);
    expect(wallLayout([IKEA_DETOLF]).leftMm).toBe(0);
    expect(wallLayout([IKEA_DETOLF]).rightMm).toBe(430);
  });

  it('an empty wall is empty', () => {
    expect(wallLayout([])).toEqual({ cabinets: [], leftMm: 0, rightMm: 0 });
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

  describe("with the picture's alpha known (cut-out and masked art): packed by what it draws, never narrower", () => {
    // a picture as wide as it is tall, a third clear above the figure and a tenth on each side: at 200 mm the figure draws 240 mm wide
    const drawn = { top: 1 / 3, bottom: 0, left: 0.1, right: 0.1 };
    const square = { ...UNMATTED_META, aspect: 1 };

    it('a label narrower than the figure draws: the drawn width (the real cut-outs: Madoka 86 mm labelled, 155 mm drawn)', () => {
      const m = measureCaseFigure(fig({ dimensions: { heightMm: 200, widthMm: 120 } }), 0, square, drawn);
      expect(m.widthMm).toBeCloseTo(240, 9);
    });

    it('a label wider than the figure draws: the label (its base, its pose)', () => {
      expect(measureCaseFigure(fig({ dimensions: { heightMm: 200, widthMm: 300 } }), 0, square, drawn).widthMm).toBe(300);
    });

    it('no label: the drawn width, not the picture at its height', () => {
      const m = measureCaseFigure(fig({ dimensions: { heightMm: 200 } }), 0, square, drawn);
      expect(m.widthMm).toBeCloseTo(240, 9);
      expect(m.billboardWidthMm).toBeCloseTo(200, 9);
      // and narrower than the picture when its sides are clear and its rows are not
      expect(measureCaseFigure(fig({ dimensions: { heightMm: 200 } }), 0, square, { top: 0, bottom: 0, left: 0.25, right: 0.25 }).widthMm).toBeCloseTo(100, 9);
    });

    it('alpha not known yet: as before, the label or the picture at its height', () => {
      expect(measureCaseFigure(fig({ dimensions: { heightMm: 200, widthMm: 120 } }), 0, square).widthMm).toBe(120);
      expect(measureCaseFigure(fig({ dimensions: { heightMm: 200 } }), 0, square).widthMm).toBeCloseTo(200, 9);
    });

    it('a picture that draws nothing wide does not take away the label', () => {
      const none = { top: 0, bottom: 0, left: 0.6, right: 0.6 };
      expect(measureCaseFigure(fig({ dimensions: { heightMm: 200, widthMm: 120 } }), 0, square, none).widthMm).toBe(120);
      expect(measureCaseFigure(fig({ dimensions: { heightMm: 200 } }), 0, square, none).widthMm).toBeCloseTo(200, 9);
    });
  });

  it('a corrupt height is capped at 2500 mm', () => {
    expect(measureCaseFigure(fig({ dimensions: { heightMm: 660580570 } }), 0, UNMATTED_META).heightMm).toBe(2500);
  });
});

describe("CASE-FB2a: where each surface's lip is drawn, and figures centred in depth", () => {
  it("each surface's lip (the front edge the case draws for it): a glass plate's own front, else the cabinet front", () => {
    // the KLINGSBO: top, four glass plates 12 mm in, the cabinet floor and the open shelf, framed at the front
    expect(surfaceSlots(IKEA_KLINGSBO).map((s) => s.lipZMm)).toEqual([0, -12, -12, -12, -12, 0, 0]);
    // the Detolf: top, three glass plates 20 mm in, the base board
    expect(surfaceSlots(IKEA_DETOLF).map((s) => s.lipZMm)).toEqual([0, -20, -20, -20, 0]);
    // the rack: its beams are its fronts
    expect(surfaceSlots(OPEN_STEEL_RACK).map((s) => s.lipZMm)).toEqual([0, 0, 0, 0, 0]);
  });

  it('the usable depth starts behind the door, the lip may not: the KLINGSBO floor\'s usable front is 4 mm in, its lip at the front', () => {
    const floor = surfaceSlots(IKEA_KLINGSBO)[5];
    expect(floor.frontZMm).toBe(-4);
    expect(floor.lipZMm).toBe(0);
  });

  it("every figure's base stands centred in its surface's usable depth, each on its own, its picture at its front", () => {
    const items = [item(0, 200, 100, 60), item(1, 200, 100, 120), item(2, 200, 100, 200)];
    const { cabinets } = packCabinets(items, [IKEA_KLINGSBO]);
    const placed = cabinets[0].surfaces.flatMap((s) => s.items.map((p) => ({ p, slot: s.slot })));
    expect(placed).toHaveLength(3);
    for (const { p, slot } of placed) {
      const middle = slot.frontZMm - slot.depthMm / 2;
      expect((p.base.frontMm + p.base.backMm) / 2, p.item.figure.name).toBeCloseTo(middle, 9);
      expect(p.base.frontMm - p.base.backMm).toBeCloseTo(p.item.depthMm, 9);
      expect(p.zMm).toBe(p.base.frontMm);
    }
    // deeper bases stand nearer the front: not one line at the middle
    expect(new Set(placed.map(({ p }) => p.zMm)).size).toBe(3);
  });

  it('a figure deeper than its surface stands at its front and overhangs behind, still flagged', () => {
    // two 220 mm figures fill the KLINGSBO's top; the third, 330 mm deep (the 335 mm floor takes it), goes on in
    // reading order to the first 314 mm glass plate
    const { cabinets } = packCabinets([item(0, 200, 220), item(1, 200, 220), item(2, 200, 100, 330)], [IKEA_KLINGSBO]);
    const [p] = cabinets[0].surfaces[1].items;
    expect(p.item.index).toBe(2);
    expect(p.tooDeep).toBe(true);
    expect(p.base).toEqual({ frontMm: -12, backMm: -342 });
  });
});

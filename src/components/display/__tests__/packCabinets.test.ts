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
import { TALL_ON_OPENED_TOPS, TALL_SHELF_REMOVAL_DEFAULT } from '../caseInterim';
import { DEFAULT_CLEARANCE_MM, clearHeightsMm, inchesToMm, liftOutShelves, stableLayout, withClearance, withShelfLayout } from '../cabinetProfile';

/** The rules before CASE-FB2a and FB2b: tall figures on the first top from the shelf cursor on, no shelf taken out. */
const AS_BEFORE = { tallOnOpenedTops: false, shelfRemoval: false } as const;

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
    expect(top.maxHeightMm).toBeCloseTo(757.6, 6);
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
    // the top and the four display beams: the lowest shelf is storage (CLEAR-1)
    expect(slots).toHaveLength(4);
    expect(slots[1].widthMm).toBeCloseTo(OPEN_STEEL_RACK.interior.widthMm, 6);
    expect(slots[1].frontZMm).toBeCloseTo(-OPEN_STEEL_RACK.rack!.postMm, 6);
  });
});

describe('fitCheck (FIT-CHECK)', () => {
  it('a figure that fits a Detolf compartment fits', () => {
    expect(fitCheck(IKEA_DETOLF, item(0, 300)).verdict).toBe('fits');
  });

  // (the stock shelves: CASE-FB2b's taken-out shelves, on by default, have their own tests below)
  it('a figure taller than every compartment but within the room above goes on the top only (no 24 in cap)', () => {
    expect(fitCheck(IKEA_DETOLF, item(0, 450), undefined, false).verdict).toBe('top-only');
    expect(fitCheck(IKEA_DETOLF, item(0, 609.6), undefined, false).verdict).toBe('top-only');
    expect(fitCheck(IKEA_DETOLF, item(0, 757.6), undefined, false).verdict).toBe('top-only');
  });

  it('a known too-tall figure is flagged in the Detolf: 1 mm over the 757.6 mm the room leaves', () => {
    const r = fitCheck(IKEA_DETOLF, item(0, 758.6), undefined, false);
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
    expect(fitCheck(IKEA_KLINGSBO, item(0, 610.6), undefined, false).verdict).toBe('too-tall');
    expect(fitCheck(IKEA_KLINGSBO, item(0, 200, 100, 401)).verdict).toBe('too-deep');
    expect(fitCheck(IKEA_KLINGSBO, item(0, 300), undefined, false).verdict).toBe('top-only');
    expect(fitCheck(IKEA_KLINGSBO, item(0, 259)).verdict).toBe('fits');
  });

  it('a lower ceiling shrinks what the top takes', () => {
    expect(fitCheck(IKEA_DETOLF, item(0, 500), 1630 + 400, false).verdict).toBe('too-tall');
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
    const { cabinets, violators } = packCabinets(items, [IKEA_DETOLF], undefined, AS_BEFORE);
    expect(violators).toEqual([]);
    const top = cabinets[0].surfaces.find((s) => s.surfaceIndex === 4)!;
    expect(top.items.map((p) => p.item.index)).toEqual([0, 2]);
  });

  it('the top takes a figure of exactly the clearance; 1 mm over is a violator, never placed', () => {
    const { cabinets, violators } = packCabinets([item(0, 757.6), item(1, 758.6)], [IKEA_DETOLF], undefined, AS_BEFORE);
    expect(violators).toEqual([{ item: expect.objectContaining({ index: 1 }), reason: 'too-tall' }]);
    expect(cabinets[0].surfaces.flatMap((s) => s.items.map((p) => p.item.index))).toEqual([0]);
  });

  it('too wide and too deep figures are violators; deeper than a plate is flagged where it stands', () => {
    const { cabinets, violators } = packCabinets(
      [item(0, 200, 500), item(1, 200, 100, 500), item(2, 300, 250, 300), item(3, 300, 250, 300)],
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

  describe("with the picture's alpha known (cut-out and masked art): packed by what it draws; a listed width wins over it (FIT1)", () => {
    // a picture as wide as it is tall, a third clear above the figure and a tenth on each side: at 200 mm the figure draws 240 mm wide
    const drawn = { top: 1 / 3, bottom: 0, left: 0.1, right: 0.1 };
    const square = { ...UNMATTED_META, aspect: 1 };

    it('a label narrower than the figure draws (the real cut-outs: Madoka 86 mm labelled, 155 mm drawn): the label wins, the figure drawn smaller to fit it (FIT1)', () => {
      const m = measureCaseFigure(fig({ dimensions: { heightMm: 200, widthMm: 120 } }), 0, square, drawn);
      expect(m.widthMm).toBe(120);
      expect(m.heightMm).toBeCloseTo(100, 9);
    });

    it('a label wider than the figure draws: the label (its base, its pose), the figure at its listed height', () => {
      const m = measureCaseFigure(fig({ dimensions: { heightMm: 200, widthMm: 300 } }), 0, square, drawn);
      expect(m.widthMm).toBe(300);
      expect(m.heightMm).toBe(200);
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

  // FIT1 (Ross 10-19): a LISTED width wins over the photo. The cut-out is scaled uniformly to fit inside the listed box (no
  // stretch: the binding dimension decides), where it was drawn as wide as its photo said when that was wider than the
  // listing (Kato Megumi a8df0a43: listed H360 W227, drawn 280 wide). A mismatch over 15 % between the photo's width at the
  // figure's height and the listed width is flagged (photoFit), on both sides.
  describe('FIT1: a listed width wins over the photo; a mismatch over 15 % is flagged', () => {
    const none = { top: 0, bottom: 0, left: 0, right: 0 };
    /** A picture whose figure fills it, wide enough to draw `mm` wide at `at` mm tall. */
    const drawing = (mm: number, at: number) => ({ ...UNMATTED_META, aspect: mm / at });

    it('Kato Megumi (listed H360 W227, her photo 280 wide at 360): drawn 227 wide, 23 % less tall, uniformly; flagged 23 % wider', () => {
      const m = measureCaseFigure(fig({ dimensions: { heightMm: 360, widthMm: 227 } }), 0, drawing(280, 360), none);
      expect(m.widthMm).toBe(227);
      expect(m.heightMm).toBeCloseTo((360 * 227) / 280, 9);
      // not stretched: the picture keeps its shape at the new height
      expect(m.billboardWidthMm / m.heightMm).toBeCloseTo(280 / 360, 9);
      expect(m.billboardWidthMm).toBeCloseTo(227, 9);
      expect(m.photoFit).toEqual({ dir: 'wider', pct: 23 });
      expect(m.heightEstimated).toBe(false);
    });

    it('a photo narrower than the listing: drawn at the listed height (it binds), the width the label, flagged narrower', () => {
      const m = measureCaseFigure(fig({ dimensions: { heightMm: 360, widthMm: 227 } }), 0, drawing(180, 360), none);
      expect(m.heightMm).toBe(360);
      expect(m.widthMm).toBe(227);
      expect(m.billboardWidthMm).toBeCloseTo(180, 9);
      expect(m.photoFit).toEqual({ dir: 'narrower', pct: 21 });
    });

    it.each([
      ['14 % wider', 227 * 1.14, undefined],
      ['16 % wider', 227 * 1.16, { dir: 'wider', pct: 16 }],
      ['14 % narrower', 227 * 0.86, undefined],
      ['16 % narrower', 227 * 0.84, { dir: 'narrower', pct: 16 }],
    ])('the flag is over 15 %%, both sides: %s', (_name, photoMm, flag) => {
      const m = measureCaseFigure(fig({ dimensions: { heightMm: 360, widthMm: 227 } }), 0, drawing(photoMm, 360), none);
      expect(m.photoFit).toEqual(flag);
    });

    it('exactly 15 % is not flagged', () => {
      expect(measureCaseFigure(fig({ dimensions: { heightMm: 360, widthMm: 200 } }), 0, drawing(230, 360), none).photoFit).toBeUndefined();
    });

    it('a photo a little wider than the listing (under 15 %) is still drawn to the listing, unflagged', () => {
      const m = measureCaseFigure(fig({ dimensions: { heightMm: 360, widthMm: 227 } }), 0, drawing(250, 360), none);
      expect(m.widthMm).toBe(227);
      expect(m.heightMm).toBeCloseTo((360 * 227) / 250, 9);
      expect(m.photoFit).toBeUndefined();
    });

    it('the figure the photo draws, not the whole picture: clear margins do not count as wide', () => {
      // the picture is 300 wide at 360 but its figure fills only 60 % of that: 180, narrower than the 227 listed
      const m = measureCaseFigure(fig({ dimensions: { heightMm: 360, widthMm: 227 } }), 0, drawing(300, 360), { top: 0, bottom: 0, left: 0.2, right: 0.2 });
      expect(m.heightMm).toBe(360);
      expect(m.widthMm).toBe(227);
      expect(m.photoFit).toEqual({ dir: 'narrower', pct: 21 });
    });

    it('no listed width: unchanged, whatever the photo says (the photo is all there is)', () => {
      const m = measureCaseFigure(fig({ dimensions: { heightMm: 360 } }), 0, drawing(280, 360), none);
      expect(m.heightMm).toBe(360);
      expect(m.widthMm).toBeCloseTo(280, 9);
      expect(m.photoFit).toBeUndefined();
      const bare = measureCaseFigure(fig({}), 0, drawing(150, DEFAULT_FIGURE_HEIGHT_MM), none);
      expect(bare.heightMm).toBe(DEFAULT_FIGURE_HEIGHT_MM);
      expect(bare.photoFit).toBeUndefined();
    });

    it('the picture not read yet (no alpha): unchanged, the listing as the footprint, no flag', () => {
      const m = measureCaseFigure(fig({ dimensions: { heightMm: 360, widthMm: 227 } }), 0, drawing(280, 360));
      expect(m.heightMm).toBe(360);
      expect(m.widthMm).toBe(227);
      expect(m.photoFit).toBeUndefined();
    });

    it('a listed width with an estimated height: the measurement still wins over the photo, with no flag (the height is a guess)', () => {
      const m = measureCaseFigure(fig({ scale: '1/8', dimensions: { widthMm: 227 } }), 0, drawing(280, 200), none);
      expect(m.heightEstimated).toBe(true);
      expect(m.widthMm).toBe(227);
      expect(m.heightMm).toBeCloseTo((200 * 227) / 280, 9);
      expect(m.photoFit).toBeUndefined();
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
    // the rack: its beams are its fronts (its storage shelf is no place)
    expect(surfaceSlots(OPEN_STEEL_RACK).map((s) => s.lipZMm)).toEqual([0, 0, 0, 0]);
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

describe('CASE-FB2a: tall figures fill the tops of cabinets already on the wall, the rest only at its end (TALL_ON_OPENED_TOPS)', () => {
  /** The KLINGSBO's tallest compartment: a figure over it stands only on a top. */
  const TIER_MM = Math.max(...surfaceSlots(IKEA_KLINGSBO).filter((s) => !s.isTop).map((s) => s.maxHeightMm));
  /** A collection like Ross's: `n` figures, about 40 % taller than every KLINGSBO tier, in a fixed order. */
  function mix(n: number): CaseFigure[] {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    return Array.from({ length: n }, (_, i) => {
      const tall = rnd() < 0.4;
      const h = Math.round(tall ? 270 + rnd() * 180 : 90 + rnd() * 160);
      return item(i, h, Math.round(h * (0.35 + rnd() * 0.25)));
    });
  }
  const isTall = (i: CaseFigure) => i.heightMm > TIER_MM;
  /** The tops rule alone, as FB2a carried it: shelves never taken out. */
  const TOPS_ONLY = { tallOnOpenedTops: true, shelfRemoval: false } as const;
  const shelfItems = (c: { surfaces: { slot: { isTop: boolean }; items: { item: CaseFigure }[] }[] }) => c.surfaces.filter((s) => !s.slot.isTop).flatMap((s) => s.items);
  const topOf = (c: { surfaces: { slot: { isTop: boolean; widthMm: number }; items: { item: CaseFigure }[] }[] }) => c.surfaces.find((s) => s.slot.isTop)!;
  const room = (top: ReturnType<typeof topOf>) => top.slot.widthMm - top.items.reduce((w, p) => w + p.item.widthMm + FIGURE_GAP_MM, 0);

  it('is on until saved layouts exist', () => {
    expect(TALL_ON_OPENED_TOPS).toBe(true);
  });

  it('a 1,200-figure wall, 40 % taller than every tier: the shelves fill cabinet by cabinet with no empty-shelf cabinet among them, every top among them full before the wall\'s end takes a tall figure', () => {
    const items = mix(1200);
    expect(items.filter(isTall).length / items.length).toBeGreaterThan(0.35);
    const { cabinets, violators } = packCabinets(items, [IKEA_KLINGSBO], undefined, TOPS_ONLY);
    expect(violators).toEqual([]);
    const withShelves = cabinets.map((c) => shelfItems(c).length > 0);
    const last = withShelves.lastIndexOf(true);
    // no cabinet with empty shelves before the last one holding shelf figures
    expect.soft(withShelves.slice(0, last + 1).every(Boolean)).toBe(true);
    // as many cabinets as the shelf figures need on the shelves alone (their capacity: the tops are the tall ones'), one more at most
    const shelvesOnly: CabinetProfile = { ...IKEA_KLINGSBO, top: { usable: false } };
    const need = packCabinets(items.filter((i) => !isTall(i)), [shelvesOnly]).cabinets.length;
    expect.soft(last + 1, `${need} cabinets of shelves`).toBeLessThanOrEqual(need + 1);
    // past them, the wall's end: tops only, of tall figures, none of which an earlier top had room for
    const tail = cabinets.slice(last + 1);
    expect.soft(tail.every((c) => topOf(c).items.every((p) => isTall(p.item)))).toBe(true);
    const narrowest = Math.min(...tail.flatMap((c) => topOf(c).items.map((p) => p.item.widthMm)));
    const roomy = cabinets.slice(0, last + 1).filter((c) => room(topOf(c)) >= narrowest).map((c) => c.index);
    expect.soft(roomy, `tops on the shelves' cabinets with room for a ${narrowest} mm figure the wall's end took`).toEqual([]);
  });

  it("a tall figure takes the earliest top already on the wall with room, not the shelf cursor's cabinet's", () => {
    // a 300 mm tall figure on the Detolf's 430 mm top leaves 120 mm; shelf figures fill the Detolf and open a second;
    // then a 100 mm wide tall figure: the first top has room for it
    const items = [item(0, 450, 300), ...Array.from({ length: 13 }, (_, i) => item(i + 1, 300, 180)), item(14, 450, 100)];
    const { cabinets } = packCabinets(items, [IKEA_DETOLF], undefined, TOPS_ONLY);
    expect(cabinets.length).toBe(2);
    expect(topOf(cabinets[0]).items.map((p) => p.item.index)).toEqual([0, 14]);
  });

  it('a tall figure no top on the wall has room for waits for the next cabinet the shelves open, and takes its top first', () => {
    // two 200 mm wide tall figures fill a Detolf top; the third waits; the shelf figures after it open the second
    // Detolf, whose top it then takes before a shelf figure may
    const items = [item(0, 450, 200), item(1, 450, 200), item(2, 450, 200), ...Array.from({ length: 13 }, (_, i) => item(i + 3, 300, 180))];
    const { cabinets } = packCabinets(items, [IKEA_DETOLF], undefined, TOPS_ONLY);
    expect(cabinets.length).toBe(2);
    expect(topOf(cabinets[1]).items[0].item.index).toBe(2);
    expect(shelfItems(cabinets[1]).length).toBeGreaterThan(0);
  });

  it("the shelf figures run out first: the tall figures left open cabinets at the wall's end, two to a Detolf top", () => {
    const items = [item(0, 450, 200), item(1, 450, 200), item(2, 300, 180), ...Array.from({ length: 4 }, (_, i) => item(i + 3, 450, 200))];
    const { cabinets, violators } = packCabinets(items, [IKEA_DETOLF], undefined, TOPS_ONLY);
    expect(violators).toEqual([]);
    expect(cabinets.map((c) => topOf(c).items.map((p) => p.item.index))).toEqual([[0, 1], [3, 4], [5, 6]]);
    expect(cabinets.map((c) => shelfItems(c).map((p) => p.item.index))).toEqual([[2], [], []]);
  });

  it('a cabinet with no usable top in the wall pattern: the waiting tall figures pass it by for the next top', () => {
    const closed: CabinetProfile = { ...IKEA_KLINGSBO, id: 'closed', top: { usable: false } };
    // a Detolf, then a closed cabinet: the third tall figure waits through the closed one for the next Detolf's top
    const items = [item(0, 450, 200), item(1, 450, 200), item(2, 450, 200), ...Array.from({ length: 30 }, (_, i) => item(i + 3, 200, 180))];
    const { cabinets } = packCabinets(items, [IKEA_DETOLF, closed], undefined, TOPS_ONLY);
    expect(cabinets[1].surfaces.some((s) => s.slot.isTop)).toBe(false);
    expect(cabinets.findIndex((c) => c.surfaces.some((s) => s.slot.isTop && s.items.some((p) => p.item.index === 2)))).toBe(2);
  });

  it('off (as before CASE-FB2a): a tall figure takes the first top from the shelf cursor on, opening cabinets ahead', () => {
    const items = [item(0, 450, 300), ...Array.from({ length: 13 }, (_, i) => item(i + 1, 300, 180)), item(14, 450, 100)];
    const { cabinets } = packCabinets(items, [IKEA_DETOLF], undefined, { tallOnOpenedTops: false, shelfRemoval: false });
    // the second Detolf's top is full of shelf figures: it opens a third, its shelves empty
    expect(cabinets.length).toBe(3);
    expect(topOf(cabinets[2]).items.map((p) => p.item.index)).toEqual([14]);
    expect(shelfItems(cabinets[2])).toEqual([]);
  });
});

describe('CASE-FB2b: tall figures in tiers the next cabinet opens by taking shelves out (TALL_SHELF_REMOVAL_DEFAULT)', () => {
  /** The KLINGSBO's tallest stock compartment; a figure over it needs a shelf out (or a top). */
  const STOCK_MM = Math.max(...surfaceSlots(IKEA_KLINGSBO).filter((s) => !s.isTop).map((s) => s.maxHeightMm));
  /**
   * Ross's 1,146 copies by height (the size audit, 10-16): 743 at most 256 mm, 312 at 257-400, 46 at 401-525 and 45
   * over 525 (here up to 900), shuffled into one fixed list order, each as wide as 35-60 % of its height, at most 330.
   */
  function rossMix(): CaseFigure[] {
    let seed = 1146;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const buckets: [number, number, number][] = [[743, 90, 256], [312, 257, 400], [46, 401, 525], [45, 526, 900]];
    const heights = buckets.flatMap(([n, lo, hi]) => Array.from({ length: n }, () => Math.round(lo + rnd() * (hi - lo))));
    for (let i = heights.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [heights[i], heights[j]] = [heights[j], heights[i]];
    }
    return heights.map((h, i) => item(i, h, Math.min(330, Math.round(h * (0.35 + rnd() * 0.25)))));
  }
  type Packed = ReturnType<typeof packCabinets>['cabinets'][number];
  /**
   * The fewest KLINGSBOs any mix of layouts (each set of glass shelves out, its top kept for tall figures or not)
   * could hold `items` in, counting widths only: a two-resource covering bound (tall places, shelves), whose best is
   * one layout or a pair of them.
   */
  function lowerBound(items: readonly CaseFigure[]): number {
    const span = (i: CaseFigure) => i.widthMm + FIGURE_GAP_MM;
    const tw = items.filter((i) => i.heightMm > STOCK_MM).reduce((w, i) => w + span(i), 0);
    const sw = items.filter((i) => i.heightMm <= STOCK_MM).reduce((w, i) => w + span(i), 0);
    const out = liftOutShelves(IKEA_KLINGSBO);
    const caps: [number, number][] = [];
    for (let mask = 0; mask < 1 << out.length; mask++) {
      const p = withShelfLayout(IKEA_KLINGSBO, { removed: out.filter((_, b) => mask & (1 << b)), moved: [] });
      const slots = surfaceSlots(p);
      const top = slots.find((x) => x.isTop)!.widthMm;
      const tiers = slots.filter((x) => !x.isTop && x.maxHeightMm > STOCK_MM).reduce((w, x) => w + x.widthMm, 0);
      const glass = slots.filter((x) => !x.isTop && x.maxHeightMm <= STOCK_MM).reduce((w, x) => w + x.widthMm, 0);
      caps.push([tiers, glass + top], [tiers + top, glass]);
    }
    let best = Infinity;
    for (const [t, g] of caps) if (t > 0 && g > 0) best = Math.min(best, Math.max(tw / t, sw / g));
    for (const [t1, g1] of caps) {
      for (const [t2, g2] of caps) {
        const det = t1 * g2 - t2 * g1;
        if (Math.abs(det) < 1e-9) continue;
        const x1 = (tw * g2 - t2 * sw) / det;
        const x2 = (t1 * sw - tw * g1) / det;
        if (x1 >= 0 && x2 >= 0) best = Math.min(best, x1 + x2);
      }
    }
    return Math.ceil(best);
  }
  /** A cabinet's compartments taller than its stock tallest: the tiers its taken-out shelves make. */
  const tiers = (c: Packed) => c.surfaces.filter((s) => !s.slot.isTop && s.slot.maxHeightMm > STOCK_MM + 1e-6);
  /** Its shelves the figures of a stock height stand on (no tier, no top). */
  const glass = (c: Packed) => c.surfaces.filter((s) => !s.slot.isTop && s.slot.maxHeightMm <= STOCK_MM + 1e-6);

  it('is the default until saved layouts exist', () => {
    expect(TALL_SHELF_REMOVAL_DEFAULT).toBe(true);
  });

  it("Ross's mix: every figure placed, every cabinet but the last with figures on its shelves, shelves out only where a tall figure needs them, about as few cabinets as the figures fill", () => {
    const items = rossMix();
    expect(items.filter((i) => i.heightMm > 256)).toHaveLength(403);
    const { cabinets, violators } = packCabinets(items, [IKEA_KLINGSBO]);
    expect(violators).toEqual([]);
    // no empty glass before the wall's last cabinet
    const bare = cabinets.slice(0, -1).filter((c) => !glass(c).some((s) => s.items.length > 0)).map((c) => c.index);
    expect.soft(bare, 'cabinets before the last with nothing on their shelves').toEqual([]);
    // a shelf comes out only for a tall figure: every tier holds one that no stock compartment takes
    const idle = cabinets.flatMap((c) => tiers(c).filter((t) => !t.items.some((p) => p.heightMm > STOCK_MM)).map((t) => `${c.index}@${t.slot.topMm}`));
    expect.soft(idle, 'tiers holding no tall figure').toEqual([]);
    expect.soft(cabinets.every((c) => (c.profile.layout?.removed.length ?? 0) === 0 || tiers(c).length > 0)).toBe(true);
    // about as few cabinets as the figures fill: within half again of the fewest any mix of layouts could hold them in,
    // counting only widths (lowerBound), and far fewer than with the tops alone, where 36 stood nowhere
    const bound = lowerBound(items);
    expect.soft(cabinets.length, `the width bound is ${bound}`).toBeLessThanOrEqual(Math.ceil(bound * 1.5));
    const topsOnly = packCabinets(items, [IKEA_KLINGSBO], undefined, { tallOnOpenedTops: true, shelfRemoval: false });
    expect.soft(topsOnly.violators).toHaveLength(36);
    expect.soft(cabinets.length, `${topsOnly.cabinets.length} with the tops alone`).toBeLessThan(topsOnly.cabinets.length * 0.7);
  });

  it('the 1,200-figure mix (40 % taller than the tier), strictly: no cabinet before the last without figures on its shelves', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const items = Array.from({ length: 1200 }, (_, i) => {
      const tall = rnd() < 0.4;
      const h = Math.round(tall ? 270 + rnd() * 180 : 90 + rnd() * 160);
      return item(i, h, Math.round(h * (0.35 + rnd() * 0.25)));
    });
    const { cabinets, violators } = packCabinets(items, [IKEA_KLINGSBO]);
    expect(violators).toEqual([]);
    expect(cabinets.slice(0, -1).filter((c) => !glass(c).some((s) => s.items.length > 0)).map((c) => c.index)).toEqual([]);
  });

  it('a 1/6 and a 1/4 among shelf figures, a top with room for them: they stand on it, no shelf comes out', () => {
    const items = [...Array.from({ length: 20 }, (_, i) => item(i, 200, 100)), item(20, 270, 120), item(21, 425, 160), ...Array.from({ length: 6 }, (_, i) => item(22 + i, 200, 100))];
    const { cabinets, violators } = packCabinets(items, [IKEA_KLINGSBO]);
    expect(violators).toEqual([]);
    expect(cabinets.every((c) => c.profile.layout === undefined)).toBe(true);
    const onTops = cabinets.flatMap((c) => c.surfaces.filter((s) => s.slot.isTop).flatMap((s) => s.items.map((p) => p.item.index)));
    expect(onTops).toEqual(expect.arrayContaining([20, 21]));
    expect(cabinets.slice(0, -1).every((c) => glass(c).some((s) => s.items.length > 0))).toBe(true);
  });

  it('more 1/6 and 1/4 figures than the tops hold: a cabinet takes out one glass shelf, and they stand in that tier', () => {
    const tall = (i: number) => (i % 2 === 0 ? item(i, 270, 120) : item(i, 425, 160));
    const items = [...Array.from({ length: 20 }, (_, i) => item(i, 200, 100)), ...Array.from({ length: 10 }, (_, i) => tall(20 + i)), ...Array.from({ length: 16 }, (_, i) => item(30 + i, 200, 100))];
    const { cabinets, violators } = packCabinets(items, [IKEA_KLINGSBO]);
    expect(violators).toEqual([]);
    const withTier = cabinets.filter((c) => tiers(c).length > 0);
    expect(withTier.length).toBeGreaterThan(0);
    const one = withTier.find((c) => c.profile.layout?.removed.length === 1)!;
    expect(one).toBeDefined();
    const inTier = tiers(one).flatMap((t) => t.items.map((p) => p.heightMm));
    expect(inTier).toEqual(expect.arrayContaining([270, 425]));
    expect(cabinets.slice(0, -1).every((c) => glass(c).some((s) => s.items.length > 0))).toBe(true);
  });

  // EYE-1 (Ross 10-18): the pair made highest (803 mm tier; the lowest pair made an 805 mm one)
  it('Kurumi, over 2 ft: two glass shelves out next to each other, an 803 mm tier', () => {
    const items = [...Array.from({ length: 6 }, (_, i) => item(i, 200, 100)), item(6, 640, 200)];
    const { cabinets, violators } = packCabinets(items, [IKEA_KLINGSBO]);
    expect(violators).toEqual([]);
    const c = cabinets.find((x) => x.surfaces.some((s) => s.items.some((p) => p.item.index === 6)))!;
    const removed = c.profile.layout!.removed;
    expect(removed).toHaveLength(2);
    expect(Math.abs(removed[0] - removed[1])).toBe(1);
    expect(clearHeightsMm(c.profile)).toContain(803);
  });

  it('a figure taller than any tier the cabinet can make is too tall: listed, never placed', () => {
    const { violators } = packCabinets([item(0, 200, 100), item(1, 1400, 200)], [IKEA_KLINGSBO]);
    expect(violators.map((v) => [v.item.index, v.reason])).toEqual([[1, 'too-tall']]);
  });

  it('fitCheck says a figure fits once shelves come out', () => {
    expect(fitCheck(IKEA_KLINGSBO, item(0, 425, 160)).verdict).toBe('needs-tier');
    expect(fitCheck(IKEA_KLINGSBO, item(0, 200, 100)).verdict).toBe('fits');
    // the rack: a beam out makes room for it too (Ross 10-17); off, its top only
    expect(fitCheck(OPEN_STEEL_RACK, item(0, 600, 160)).verdict).toBe('needs-tier');
    expect(fitCheck(OPEN_STEEL_RACK, item(0, 600, 160), undefined, false).verdict).toBe('too-tall');
    // off: as before CASE-FB2b
    expect(fitCheck(IKEA_KLINGSBO, item(0, 425, 160), undefined, false).verdict).toBe('top-only');
    // the rack's top takes 558.8 mm (the room less 2 in), less than its tallest compartment: 600 mm is a tier's or nothing's
  });

  it('the Detolf takes out its glass too; the rack sends a tall figure its top holds there, taking nothing out', () => {
    // 780 mm: over the Detolf's top (757.6 mm, the room less 2 in) and its tallest compartment (396 mm): one shelf out (787 mm) takes it
    const detolf = packCabinets([...Array.from({ length: 4 }, (_, i) => item(i, 200, 100)), item(4, 780, 200)], [IKEA_DETOLF]);
    expect(detolf.cabinets.some((c) => (c.profile.layout?.removed.length ?? 0) === 1)).toBe(true);
    // 700 mm: over its tallest compartment, within its top's room: the top takes it, nothing comes out
    const detolfTop = packCabinets([...Array.from({ length: 4 }, (_, i) => item(i, 200, 100)), item(4, 700, 200)], [IKEA_DETOLF]);
    expect(detolfTop.cabinets[0].surfaces.find((s) => s.slot.isTop)!.items.map((p) => p.item.index)).toContain(4);
    expect(detolfTop.cabinets.every((c) => c.profile.layout === undefined)).toBe(true);
    // the rack's tallest compartment (590.55 mm under its top) is over its top's room (558.8 mm): a figure one takes, the other does
    const rack = packCabinets([item(0, 200, 100), item(1, 575, 200)], [OPEN_STEEL_RACK]);
    expect(rack.cabinets[0].surfaces.find((s) => !s.slot.isTop && s.items.some((p) => p.item.index === 1))).toBeDefined();
    expect(rack.cabinets.every((c) => c.profile.layout === undefined)).toBe(true);
  });

  it("a figure taller than the rack's top takes and its tallest compartment: one beam comes out, the figure in the tier", () => {
    const { cabinets, violators } = packCabinets([item(0, 200, 100), item(1, 700, 200)], [OPEN_STEEL_RACK]);
    expect(violators).toEqual([]);
    expect(cabinets).toHaveLength(1);
    expect(cabinets[0].profile.layout?.removed).toHaveLength(1);
    // the tier: taller than the rack's tallest stock compartment (584.2 mm, the 2 in beam)
    const rackTiers = cabinets[0].surfaces.filter((x) => !x.slot.isTop && x.slot.maxHeightMm > inchesToMm(72 - 2 - 47) + 1e-6);
    expect(rackTiers.flatMap((t) => t.items.map((p) => p.item.index))).toEqual([1]);
  });

  it('off (a saved layout that keeps its shelves): tall figures go to the tops, as before', () => {
    const items = [...Array.from({ length: 20 }, (_, i) => item(i, 200, 100)), item(20, 270, 120), item(21, 425, 160)];
    const { cabinets } = packCabinets(items, [IKEA_KLINGSBO], undefined, { tallOnOpenedTops: true, shelfRemoval: false });
    expect(cabinets.every((c) => c.profile.layout === undefined)).toBe(true);
    expect(cabinets.flatMap((c) => c.surfaces.filter((s) => s.slot.isTop).flatMap((s) => s.items.map((p) => p.item.index)))).toEqual(expect.arrayContaining([20, 21]));
  });
});

describe('EYE-1 (Ross 10-18): the tall tier is made highest, closer to a standing viewpoint', () => {
  /** The lift-out shelves that, taken out alone, leave a compartment this figure stands in. */
  const doing = (profile: CabinetProfile, fig: CaseFigure) =>
    liftOutShelves(profile).filter((s) => {
      if (!stableLayout(profile, { removed: [s], moved: [] })) return false;
      const derived = withShelfLayout(profile, { removed: [s], moved: [] });
      return surfaceSlots(derived).some((slot) => !slot.isTop && fig.heightMm <= slot.maxHeightMm && fig.widthMm <= slot.widthMm && fig.depthMm <= slot.depthMm);
    });
  const one = (cabinets: ReturnType<typeof packCabinets>['cabinets']) => cabinets.filter((c) => c.profile.layout?.removed.length === 1).map((c) => c.profile.layout!.removed[0]);

  it('the KLINGSBO: more tall figures than its tops hold, one glass shelf out each time, and it is the highest one that makes room', () => {
    const tall = (i: number) => (i % 2 === 0 ? item(i, 270, 120) : item(i, 425, 160));
    const items = [...Array.from({ length: 20 }, (_, i) => item(i, 200, 100)), ...Array.from({ length: 10 }, (_, i) => tall(20 + i)), ...Array.from({ length: 16 }, (_, i) => item(30 + i, 200, 100))];
    const cands = doing(IKEA_KLINGSBO, item(0, 425, 160));
    expect(cands.length, 'more than one shelf would do').toBeGreaterThan(1);
    const removed = one(packCabinets(items, [IKEA_KLINGSBO]).cabinets);
    expect(removed.length).toBeGreaterThan(0);
    for (const r of removed) expect(r).toBe(Math.max(...cands));
  });

  it('the Detolf: more tall figures than its top holds, one glass shelf out each time, and it is the highest one that makes room', () => {
    const tall = (i: number) => (i % 2 === 0 ? item(i, 270, 120) : item(i, 425, 160));
    const items = [...Array.from({ length: 10 }, (_, i) => item(i, 200, 100)), ...Array.from({ length: 14 }, (_, i) => tall(10 + i)), ...Array.from({ length: 6 }, (_, i) => item(24 + i, 200, 100))];
    const cands = doing(IKEA_DETOLF, item(0, 425, 160));
    expect(cands.length, 'more than one shelf would do').toBeGreaterThan(1);
    const removed = one(packCabinets(items, [IKEA_DETOLF]).cabinets);
    expect(removed.length).toBeGreaterThan(0);
    for (const r of removed) expect(r).toBe(Math.max(...cands));
  });

  it('the rack: a 700 mm figure takes the 24 in beam out, the one beam the storage shelf and the posts\' bracing leave that makes room', () => {
    // the storage shelf is no place and the upper half keeps two beams: of the beams, only the 12 in and the 24 in may
    // come out, and the 12 in one makes a compartment on the storage shelf, no place for a figure
    const cands = doing(OPEN_STEEL_RACK, item(1, 700, 100));
    expect(cands).toEqual([2]);
    const removed = one(packCabinets([item(0, 200, 100), item(1, 700, 100)], [OPEN_STEEL_RACK]).cabinets);
    expect(removed).toEqual([2]);
  });

  it('fewest shelves out stays the first rule: two out only where one cannot make the room, and then the highest two', () => {
    // Kurumi, 640 mm: over any one-shelf tier of the KLINGSBO, so two come out, next to each other, the highest pair that does it
    const kurumi = item(6, 640, 200);
    const pairs = liftOutShelves(IKEA_KLINGSBO).flatMap((a, i, all) => all.slice(i + 1).map((b) => [a, b] as const)).filter(([a, b]) => {
      const derived = withShelfLayout(IKEA_KLINGSBO, { removed: [a, b], moved: [] });
      return surfaceSlots(derived).some((slot) => !slot.isTop && kurumi.heightMm <= slot.maxHeightMm && kurumi.widthMm <= slot.widthMm);
    });
    expect(doing(IKEA_KLINGSBO, kurumi)).toEqual([]);
    expect(pairs.length).toBeGreaterThan(1);
    const { cabinets } = packCabinets([...Array.from({ length: 6 }, (_, i) => item(i, 200, 100)), kurumi], [IKEA_KLINGSBO]);
    const c = cabinets.find((x) => x.surfaces.some((sf) => sf.items.some((p) => p.item.index === 6)))!;
    const removed = c.profile.layout!.removed;
    expect(removed).toHaveLength(2);
    const top = pairs.reduce((best, p) => (Math.max(...p) > Math.max(...best) ? p : best));
    expect([...removed].sort()).toEqual([...top].sort());
  });

  it('a figure the stock compartments take makes no tier: nothing comes out', () => {
    for (const profile of [IKEA_KLINGSBO, IKEA_DETOLF, OPEN_STEEL_RACK]) {
      const { cabinets } = packCabinets([item(0, 150, 100), item(1, 180, 100)], [profile]);
      expect(cabinets.every((c) => c.profile.layout === undefined), profile.id).toBe(true);
    }
  });
});

describe('CLEAR-1 (Ross 10-18): the rack\'s storage shelf, its bracing, and the clearance kept above a figure', () => {
  const halves = (p: CabinetProfile) => {
    const mid = p.outer.heightMm / 2;
    const lower = p.surfaces.filter((s) => s.topMm <= mid).length;
    return [lower, p.surfaces.length - lower];
  };

  it('the storage shelf is no place: the rack\'s slots are its top and the four display beams above it', () => {
    const slots = surfaceSlots(OPEN_STEEL_RACK);
    expect(slots.map((s) => s.surfaceIndex)).toEqual([4, 3, 2, 1]);
    expect(OPEN_STEEL_RACK.surfaces[0].role).toBe('storage');
  });

  it('no figure is ever packed on the storage shelf, however many there are', () => {
    const items = Array.from({ length: 60 }, (_, i) => item(i, 150 + (i % 5) * 20, 100));
    const { cabinets } = packCabinets(items, [OPEN_STEEL_RACK]);
    expect(cabinets.length).toBeGreaterThan(1);
    for (const c of cabinets) expect(c.surfaces.filter((s) => s.slot.surfaceIndex === 0 || c.profile.surfaces[s.slot.surfaceIndex]?.role === 'storage')).toEqual([]);
    expect(cabinets.flatMap((c) => c.surfaces.flatMap((s) => s.items)).length).toBe(60);
  });

  it('the storage shelf never comes out and the 47 in beam and the top never do: the posts keep two beams in each half, in every layout the packer makes', () => {
    const mixes = [[700], [700, 650], [700, 700, 720], [610, 640]];
    for (const tall of mixes) {
      const items = [...Array.from({ length: 12 }, (_, i) => item(i, 200, 100)), ...tall.map((h, i) => item(20 + i, h, 100))];
      for (const c of packCabinets(items, [OPEN_STEEL_RACK]).cabinets) {
        const [lower, upper] = halves(c.profile);
        expect(lower, JSON.stringify(c.profile.layout)).toBeGreaterThanOrEqual(2);
        expect(upper, JSON.stringify(c.profile.layout)).toBeGreaterThanOrEqual(2);
        expect(c.profile.surfaces.some((s) => s.role === 'storage')).toBe(true);
      }
    }
  });

  it('a figure exactly at a compartment\'s old height fails without a shelf out at 1 in, and at 0.25 in; one a quarter inch short passes at 0.25 in, not at 1 in', () => {
    const tallest = Math.max(...clearHeightsMm(IKEA_DETOLF)); // 396 mm
    const at = (h: number, clearance: number) => fitCheck(withClearance(IKEA_DETOLF, clearance), item(0, h, 100), undefined, false).verdict;
    expect(at(tallest, 0)).toBe('fits');
    expect(at(tallest, DEFAULT_CLEARANCE_MM)).not.toBe('fits');
    expect(at(tallest, 6.35)).not.toBe('fits');
    expect(at(tallest - 6.35, 6.35)).toBe('fits');
    expect(at(tallest - 6.35, DEFAULT_CLEARANCE_MM)).not.toBe('fits');
  });

  it('changing the clearance changes placement: figures that stand on the Detolf\'s shelves with none need a tier, a top or another cabinet with 1 in', () => {
    const items = Array.from({ length: 8 }, (_, i) => item(i, 385, 100));
    const none = packCabinets(items, [IKEA_DETOLF]);
    const inch = packCabinets(items, [withClearance(IKEA_DETOLF, DEFAULT_CLEARANCE_MM)]);
    const onShelves = (r: ReturnType<typeof packCabinets>) => r.cabinets.flatMap((c) => c.surfaces.filter((s) => !s.slot.isTop && s.slot.maxHeightMm < 400).flatMap((s) => s.items)).length;
    expect(onShelves(none)).toBeGreaterThan(0);
    expect(onShelves(inch)).toBe(0);
    expect(inch.cabinets.some((c) => (c.profile.layout?.removed.length ?? 0) > 0) || inch.cabinets.length > none.cabinets.length || inch.violators.length > 0).toBe(true);
  });

  it('the clearance applies to a tier as to a stock compartment: a tier\'s room is its clear height less the clearance', () => {
    const tier = withShelfLayout(IKEA_DETOLF, { removed: [1], moved: [] });
    expect(clearHeightsMm(withClearance(tier, DEFAULT_CLEARANCE_MM))[0]).toBeCloseTo(787 - 25.4, 6);
  });
});


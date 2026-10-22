// SIZE-L2 (Ross, via the lead 10-21): the spine's "the larger of an mfc W and L is the width" is NOT shipped. Among mfc listings with a
// W and an L and no H and a photo, L > W has 16 tall photos, 5 wide and 13 square (the same count here at a 5 % square tolerance:
// 19 / 5 / 13), so L is the height of a standing figure, as in SIZE-L3. The app lets the PHOTO decide, for a listed W and a longer L
// with no height (the spine keeps W as the width and L as the depth):
//   tall photo    height = L, width = W (the depth follows Ross's ratio of the width)
//   wide photo    width = L (the longer), depth = W (the shorter), the height follows from the picture
//   square photo  as listed: W the width, L the depth
// And the tiny-axis rule (Ross: "best guess erring on the smallish side"): on a FIGURE-kind product an axis listed under 5 mm
// (an H1, a W1: MFC's unknown written as 1) is read as missing and estimated, so Batman is no longer 1 mm tall nor Spinosaurus
// 1 mm wide; goods are really thin and keep theirs. A dropped height takes the SMALLER of the photo's estimate and the scale's.
import { describe, expect, it } from 'vitest';
import { ProductKind } from '@figurecollecting/fc-api-contract';
import type { Figure } from '@figurecollecting/fc-shared';
import { UNMATTED_META } from '../displayMeta';
import { CM_READ_BELOW_MM, DEPTH_WIDTH_RATIO, SQUARE_PHOTO_TOLERANCE, TINY_AXIS_MM, readListedSize, resolveHeightMm } from '../sizeResolution';
import { measureCaseFigure } from '../packCabinets';
import { describeSize } from '../sizeBasis';

const fig = (over: Partial<Figure> = {}): Figure =>
  ({ _id: 'f', name: 'F', manufacturer: 'M', scale: '', userId: 'u', createdAt: '', updatedAt: '', ...over }) as Figure;
const listed = (dimensions: Figure['dimensions'], scale = '', kind?: ProductKind): Figure =>
  fig({ dimensions, scale, ...(kind === undefined ? {} : { local: { productKind: kind } }) } as Partial<Figure>);
const figure = (dimensions: Figure['dimensions'], scale = '') => listed(dimensions, scale, ProductKind.FIGURE);
const meta = (aspect: number) => ({ ...UNMATTED_META, aspect });
// Ikaruga 1354992, "Linens": W450 L900 and a square 600 x 600 photo (the spine keeps L as the depth)
const IKARUGA = { widthMm: 450, depthMm: 900 };

describe('readListedSize: a listed W and a longer L, no H, placed by the photo', () => {
  it('a tall photo: L is the height, W the width, no depth listed', () => {
    const r = readListedSize(listed(IKARUGA), 0.5);
    expect(r.placed).toBe('standing');
    expect(r.figure.dimensions).toEqual({ heightMm: 900, widthMm: 450 });
  });

  it('a wide photo: the longer is the width, the shorter the depth, no height listed', () => {
    const r = readListedSize(listed(IKARUGA), 2);
    expect(r.placed).toBe('lying');
    expect(r.figure.dimensions).toEqual({ widthMm: 900, depthMm: 450 });
  });

  it('a square photo keeps the listing: W the width, L the depth (Ikaruga\'s real 600 x 600)', () => {
    const f = listed(IKARUGA);
    const r = readListedSize(f, 1);
    expect(r.placed).toBeUndefined();
    expect(r.figure).toBe(f);
  });

  it('square is within 5 % of as wide as tall, and the edge is the tolerance', () => {
    expect(SQUARE_PHOTO_TOLERANCE).toBe(0.05);
    for (const p of [0.95, 0.97, 1, 1.03, 1.05]) expect(readListedSize(listed(IKARUGA), p).placed, String(p)).toBeUndefined();
    expect(readListedSize(listed(IKARUGA), 0.949).placed).toBe('standing');
    expect(readListedSize(listed(IKARUGA), 1.051).placed).toBe('lying');
  });

  it('only a LONGER L: an L no longer than W already reads as a footprint, so it keeps its reading', () => {
    for (const p of [0.5, 2]) {
      const f = listed({ widthMm: 900, depthMm: 450 });
      expect(readListedSize(f, p).figure).toBe(f);
      const same = listed({ widthMm: 450, depthMm: 450 });
      expect(readListedSize(same, p).figure).toBe(same);
    }
  });

  it('only with no listed height, and only with a picture shape to place it by', () => {
    const withHeight = listed({ ...IKARUGA, heightMm: 300 });
    expect(readListedSize(withHeight, 0.5).figure).toBe(withHeight);
    const f = listed(IKARUGA);
    for (const bad of [undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(readListedSize(f, bad).figure).toBe(f);
  });

  it('a lone W, a lone L (SIZE-L3), or nothing listed is not this rule', () => {
    for (const dims of [{ widthMm: 450 }, { depthMm: 900 }, {}, undefined]) {
      const f = listed(dims as Figure['dimensions']);
      expect(readListedSize(f, 0.5).figure).toBe(f);
    }
  });
});

describe('readListedSize: the tiny-axis rule', () => {
  it('drops an axis listed under 5 mm on a FIGURE, and says which and what was listed', () => {
    expect(TINY_AXIS_MM).toBe(5);
    const r = readListedSize(figure({ heightMm: 1, widthMm: 471, depthMm: 362 }), 0.75);
    expect(r.figure.dimensions).toEqual({ widthMm: 471, depthMm: 362 });
    expect(r.dropped).toEqual([{ axis: 'height', mm: 1 }]);
  });

  it('5 mm is kept, 4.99 is not; each axis alike', () => {
    expect(readListedSize(figure({ heightMm: 5, widthMm: 300, depthMm: 300 }), 0.75).dropped).toEqual([]);
    expect(readListedSize(figure({ heightMm: 300, widthMm: 5, depthMm: 300 }), 0.75).dropped).toEqual([]);
    expect(readListedSize(figure({ heightMm: 4.99, widthMm: 4.99, depthMm: 4.99 }), 0.75).dropped.map((d) => d.axis)).toEqual(['height', 'width', 'depth']);
  });

  it('goods, media and a card that states no kind keep their thin axes', () => {
    for (const kind of [ProductKind.GOODS, ProductKind.MEDIA, undefined]) {
      const f = listed({ heightMm: 1, widthMm: 471, depthMm: 362 }, '', kind);
      expect(readListedSize(f, 0.75).figure).toBe(f);
    }
  });

  it('a dropped height is a listed one: a W and an L beside it are not placed as a W+L with no height', () => {
    const r = readListedSize(figure({ heightMm: 1, widthMm: 300, depthMm: 500 }), 0.5);
    expect(r.placed).toBeUndefined();
    expect(r.figure.dimensions).toEqual({ widthMm: 300, depthMm: 500 });
  });

  it('an L that was tiny is no longer an L to place: W alone stays a width', () => {
    const r = readListedSize(figure({ widthMm: 300, depthMm: 2 }), 0.5);
    expect(r.placed).toBeUndefined();
    expect(r.figure.dimensions).toEqual({ widthMm: 300 });
  });
});

describe('readListedSize: a listing whose every axis is under 20 mm is read as centimetres (Zuko, Toph and the like)', () => {
  it('Zuko 3797841 and Toph Beifong 3797875 (H6 W3 D4): 60 x 30 x 40 mm, and it says what was read as what', () => {
    expect(CM_READ_BELOW_MM).toBe(20);
    const r = readListedSize(figure({ heightMm: 6, widthMm: 3, depthMm: 4 }), 0.75);
    expect(r.figure.dimensions).toEqual({ heightMm: 60, widthMm: 30, depthMm: 40 });
    expect(r.cm).toEqual([{ axis: 'height', mm: 6 }, { axis: 'width', mm: 3 }, { axis: 'depth', mm: 4 }]);
    expect(r.dropped).toEqual([]);
  });

  it('the figures the catalogue lists this way: Madoka 15 x 8 x 8, Gojira 12, Pochita 13 x 14 x 14, a 1/12 trading 10', () => {
    expect(readListedSize(figure({ heightMm: 15, widthMm: 8, depthMm: 8 })).figure.dimensions).toEqual({ heightMm: 150, widthMm: 80, depthMm: 80 });
    expect(readListedSize(figure({ heightMm: 12 })).figure.dimensions).toEqual({ heightMm: 120 });
    expect(readListedSize(figure({ heightMm: 13, widthMm: 14, depthMm: 14 })).figure.dimensions).toEqual({ heightMm: 130, widthMm: 140, depthMm: 140 });
    expect(readListedSize(figure({ heightMm: 10 }, '1/12')).figure.dimensions).toEqual({ heightMm: 100 });
  });

  it('only when EVERY listed axis is under 20 mm: one at 20 or more is a real size, and the tiny axes beside it are dropped', () => {
    const r = readListedSize(figure({ heightMm: 19.99, widthMm: 8 }));
    expect(r.figure.dimensions).toEqual({ heightMm: 199.9, widthMm: 80 });
    const real = readListedSize(figure({ heightMm: 20, widthMm: 3 }));
    expect(real.cm).toEqual([]);
    expect(real.figure.dimensions).toEqual({ heightMm: 20 });
    expect(real.dropped).toEqual([{ axis: 'width', mm: 3 }]);
  });

  it('not for the placeholder: a listing whose largest axis is under 5 mm (an H1, a 1 x 1 x 1, Varang 3 x 2 x 2) is MFC\'s unknown, so it is dropped, not read as cm', () => {
    for (const dims of [{ heightMm: 1 }, { heightMm: 1, widthMm: 1, depthMm: 1 }, { heightMm: 3, widthMm: 2, depthMm: 2 }, { heightMm: 4.99 }]) {
      const r = readListedSize(figure(dims));
      expect(r.cm, JSON.stringify(dims)).toEqual([]);
      expect(r.figure.dimensions).toEqual({});
      expect(r.dropped.length).toBe(Object.keys(dims).length);
    }
  });

  it('only on a FIGURE: goods, media and a card with no kind are read as listed', () => {
    for (const kind of [ProductKind.GOODS, ProductKind.MEDIA, undefined]) {
      const f = listed({ heightMm: 6, widthMm: 3, depthMm: 4 }, '', kind);
      expect(readListedSize(f, 0.75).figure).toBe(f);
    }
  });

  it('is read before a W and a longer L are placed: the scaled values are the ones placed', () => {
    const r = readListedSize(figure({ widthMm: 8, depthMm: 12 }), 0.5);
    expect(r.placed).toBe('standing');
    expect(r.figure.dimensions).toEqual({ heightMm: 120, widthMm: 80 });
  });

  it('measureCaseFigure: Zuko is 60 x 30 x 40 mm, an inference, not a measurement', () => {
    const m = measureCaseFigure(figure({ heightMm: 6, widthMm: 3, depthMm: 4 }), 0, meta(0.75));
    expect([m.heightMm, m.widthMm, m.depthMm]).toEqual([60, 30, 40]);
    expect(m.heightEstimated).toBe(true);
  });

  it('describeSize says what was read as what, and never calls it measured', () => {
    const zuko = describeSize(figure({ heightMm: 6, widthMm: 3, depthMm: 4 }), undefined, 0.75);
    expect(zuko.line).toBe('60 mm tall · 30 mm wide · 40 mm deep · listed in mm but read as cm (6 → 60 mm, 3 → 30 mm, 4 → 40 mm)');
    expect(zuko.estimated).toBe(true);
    expect(describeSize(figure({ heightMm: 12 }), undefined, 0.75).line).toBe('120 mm tall · width from the photo · depth from the width · listed in mm but read as cm (12 → 120 mm)');
  });
});

describe('resolveHeightMm: a dropped height takes the smaller of the photo\'s estimate and the scale\'s', () => {
  const f = listed({ widthMm: 300 }, '1/7');
  it('the scale is smaller: the scale', () => {
    expect(resolveHeightMm(f, 0.5, true)?.source).toBe('scale-estimate');
    expect(resolveHeightMm(f, 0.5, true)?.heightMm).toBeCloseTo(1600 / 7, 9);
  });

  it('the photo is smaller: the photo', () => {
    expect(resolveHeightMm(listed({ widthMm: 300 }, '1/2'), 0.5, true)).toEqual({ heightMm: 600, source: 'width-photo' });
  });

  it('only one estimate: that one; without the flag the photo wins over the scale as before', () => {
    expect(resolveHeightMm(listed({ widthMm: 300 }), 0.5, true)?.source).toBe('width-photo');
    expect(resolveHeightMm(listed({}, '1/7'), 0.5, true)?.source).toBe('scale-estimate');
    expect(resolveHeightMm(f, 0.5)).toEqual({ heightMm: 600, source: 'width-photo' });
  });
});

describe('measureCaseFigure: the real listings', () => {
  it('Ikaruga 1354992 (W450 L900, a square 600 x 600 photo): as listed, 450 wide and 900 deep, 450 tall', () => {
    const m = measureCaseFigure(listed(IKARUGA), 0, meta(1));
    expect([m.widthMm, m.depthMm, m.heightMm]).toEqual([450, 900, 450]);
  });

  it('Ikaruga\'s numbers on a TALL photo: 900 tall and 450 wide, the depth Ross\'s ratio of the width', () => {
    const m = measureCaseFigure(listed(IKARUGA), 0, meta(0.5));
    expect([m.heightMm, m.widthMm]).toEqual([900, 450]);
    expect(m.depthMm).toBeCloseTo(DEPTH_WIDTH_RATIO * 450, 9);
    expect(m.heightEstimated).toBe(true);
  });

  it('Ikaruga\'s numbers on a WIDE photo: 900 wide and 450 deep, 450 tall from the picture', () => {
    const m = measureCaseFigure(listed(IKARUGA), 0, meta(2));
    expect([m.widthMm, m.depthMm, m.heightMm]).toEqual([900, 450, 450]);
    expect(m.widthBasis).toBe('length');
  });

  it('Batman 354823, Superman 354824, Wonder Woman 355649 (H1 W471 D362, no scale, the placeholder picture): 628 tall, not 1 mm', () => {
    const m = measureCaseFigure(figure({ heightMm: 1, widthMm: 471, depthMm: 362 }), 0, meta(0.75));
    expect([m.heightMm, m.widthMm, m.depthMm]).toEqual([628, 471, 362]);
    expect(m.heightEstimated).toBe(true);
  });

  it('Spinosaurus 3792319 (H950 W1 D940, no scale, the placeholder picture): 950 tall and as wide as the picture, not 1 mm', () => {
    const m = measureCaseFigure(figure({ heightMm: 950, widthMm: 1, depthMm: 940 }), 0, meta(0.75));
    expect([m.heightMm, m.widthMm, m.depthMm]).toEqual([950, 712.5, 940]);
    expect(m.widthBasis).toBe('photo');
  });

  it('Yan 1968757 (H900 W1 D800, a wide 600 x 400 photo): 900 tall, 1350 wide by the picture; before, a cut-out was scaled down to its 1 mm width', () => {
    const f = figure({ heightMm: 900, widthMm: 1, depthMm: 800 });
    const m = measureCaseFigure(f, 0, meta(1.5));
    expect([m.heightMm, m.widthMm, m.depthMm]).toEqual([900, 1350, 800]);
    const drawn = { top: 0.1, bottom: 0.05, left: 0.1, right: 0.1 };
    const cut = measureCaseFigure(f, 0, meta(1.5), drawn);
    expect(cut.heightMm).toBe(900);
    expect(cut.widthMm).toBeGreaterThan(900);
  });

  it('a depth under 5 mm (AAA Wunder 3056055: H203 W814 D1) is Ross\'s ratio of the width', () => {
    const m = measureCaseFigure(figure({ heightMm: 203, widthMm: 814, depthMm: 1 }), 0, meta(0.75));
    expect([m.heightMm, m.widthMm]).toEqual([203, 814]);
    expect(m.depthMm).toBeCloseTo(DEPTH_WIDTH_RATIO * 814, 9);
  });

  it('a dropped height with a scale: the smaller of the photo\'s 600 and the scale\'s 229', () => {
    const m = measureCaseFigure(figure({ heightMm: 1, widthMm: 300, depthMm: 200 }, '1/7'), 0, meta(0.5));
    expect(m.heightMm).toBeCloseTo(1600 / 7, 9);
    expect(m.widthMm).toBe(300);
  });

  it('goods keep their thin axis: H1 stays 1 mm', () => {
    expect(measureCaseFigure(listed({ heightMm: 1, widthMm: 300, depthMm: 200 }, '', ProductKind.GOODS), 0, meta(0.75)).heightMm).toBe(1);
  });

  it('SIZE-L3 and SIZE-L1 readings are untouched: a lone L, a lone W, a listed H with L', () => {
    expect(measureCaseFigure(listed({ depthMm: 240 }, '1/7'), 0, meta(0.375)).heightMm).toBeCloseTo(240, 6);
    expect(measureCaseFigure(listed({ widthMm: 240 }, '1/7'), 0, meta(0.375)).heightMm).toBeCloseTo(640, 6);
    const hl = measureCaseFigure(listed({ heightMm: 240, depthMm: 100 }, '1/7'), 0, meta(0.5));
    expect([hl.heightMm, hl.depthMm]).toEqual([240, 100]);
    const wl = measureCaseFigure(listed({ widthMm: 900, depthMm: 450 }), 0, meta(2));
    expect([wl.widthMm, wl.heightMm, wl.depthMm]).toEqual([900, 450, 450]);
  });
});

describe('describeSize: the Info card says what was read as what', () => {
  it('a W and a longer L on a tall photo: the length is the height', () => {
    const s = describeSize(listed(IKARUGA), undefined, 0.5);
    expect(s.line).toBe('900 mm tall · from the listed length · 450 mm wide · depth from the width');
    expect([s.heightBasis, s.widthBasis, s.depthBasis, s.estimated]).toEqual(['length', 'labeled', 'width', true]);
  });

  it('on a wide photo: the length is the width, the listed width the depth', () => {
    const s = describeSize(listed(IKARUGA), undefined, 2);
    expect(s.line).toBe('≈ 450 mm tall · from the listed width and the photo · 900 mm wide (the listed length) · 450 mm deep');
    expect([s.heightBasis, s.widthBasis, s.depthBasis]).toEqual(['photo', 'length', 'labeled']);
  });

  it('on a square photo, or with no picture shape: as listed', () => {
    expect(describeSize(listed(IKARUGA), undefined, 1).line).toBe('≈ 450 mm tall · from the listed width and the photo · 450 mm wide · 900 mm deep');
    expect(describeSize(listed(IKARUGA)).line).toBe('height from the listed width and the photo · 450 mm wide · 900 mm deep');
  });

  it('a dropped height says what was listed and what the height rests on', () => {
    expect(describeSize(figure({ heightMm: 1, widthMm: 471, depthMm: 362 }), undefined, 0.75).line).toBe(
      '≈ 628 mm tall · from the listed width and the photo · 471 mm wide · 362 mm deep · listed height of 1 mm ignored',
    );
    const withScale = describeSize(figure({ heightMm: 1, widthMm: 300, depthMm: 200 }, '1/7'), undefined, 0.5);
    expect(withScale.line).toBe('≈ 229 mm tall · from scale 1/7 · 300 mm wide · 200 mm deep · listed height of 1 mm ignored');
    expect(withScale.heightBasis).toBe('scale');
  });

  it('a dropped width and a dropped depth say so too', () => {
    expect(describeSize(figure({ heightMm: 900, widthMm: 1, depthMm: 800 }), undefined, 1.5).line).toBe('900 mm tall · width from the photo · 800 mm deep · listed width of 1 mm ignored');
    expect(describeSize(figure({ heightMm: 203, widthMm: 814, depthMm: 1 }), undefined, 0.75).line).toBe('203 mm tall · 814 mm wide · depth from the width · listed depth of 1 mm ignored');
  });

  it('goods are described as listed', () => {
    expect(describeSize(listed({ heightMm: 1, widthMm: 300, depthMm: 200 }, '', ProductKind.GOODS), undefined, 0.75).line).toBe('1 × 300 × 200 mm · measured');
  });
});

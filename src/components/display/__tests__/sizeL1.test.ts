// SIZE-L1 (Ross 10-20, desk (a)): "laying prize figure lists just L or W but not H". The spine now materializes an mfc L with no
// H and no W as the figure's WIDTH. With a width and no height the case no longer takes the scale's nominal height (1600 mm / n):
// a measured width and the photo's proportions beat a nominal character height, so the height is the width over the picture's
// width per mm of height. A labeled height still stands, a figure with no width keeps the scale, and a cut-out is read by the
// clear part of its picture.
import { describe, expect, it } from 'vitest';
import type { Figure } from '@figurecollecting/fc-shared';
import { UNMATTED_META } from '../displayMeta';
import { measureCaseFigure } from '../packCabinets';
import { describeSize } from '../sizeBasis';
import { MAX_PLAUSIBLE_HEIGHT_MM, resolveHeightMm } from '../sizeResolution';

const fig = (over: Partial<Figure> = {}): Figure =>
  ({ _id: 'f', name: 'F', manufacturer: 'M', scale: '', userId: 'u', createdAt: '', updatedAt: '', ...over }) as Figure;
const meta = (aspect: number) => ({ ...UNMATTED_META, aspect });
const listed = (dimensions: Figure['dimensions'], scale = ''): Figure => fig({ dimensions, scale });

describe('resolveHeightMm: a labeled width and the photo give the height', () => {
  it('a width, no height, a photo: the height is the width over the picture width per mm of height, whatever the scale says', () => {
    expect(resolveHeightMm(listed({ widthMm: 240 }, '1/7'), 0.375)).toEqual({ heightMm: 640, source: 'width-photo' });
  });

  it('a labeled height stands, width or not', () => {
    expect(resolveHeightMm(listed({ heightMm: 100, widthMm: 240 }, '1/7'), 0.375)).toEqual({ heightMm: 100, source: 'labeled' });
  });

  it('no width: the scale\'s nominal height, as before', () => {
    expect(resolveHeightMm(listed({}, '1/7'), 0.375)?.source).toBe('scale-estimate');
    expect(resolveHeightMm(listed({ depthMm: 240 }, '1/7'), 0.375)?.source).toBe('scale-estimate');
  });

  it('no picture shape to go by (none, zero, negative, not a number): the scale, then nothing', () => {
    for (const bad of [undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveHeightMm(listed({ widthMm: 240 }, '1/7'), bad)?.source).toBe('scale-estimate');
    }
    expect(resolveHeightMm(listed({ widthMm: 240 }), undefined)).toBeNull();
  });

  it('an unusable width (zero, negative, not a number) is no width', () => {
    for (const w of [0, -5, Number.NaN]) expect(resolveHeightMm(listed({ widthMm: w }, '1/7'), 0.5)?.source).toBe('scale-estimate');
  });

  it('a two-argument call is the old one (the scale)', () => {
    expect(resolveHeightMm(listed({ widthMm: 240 }, '1/7'))?.source).toBe('scale-estimate');
  });
});

describe('measureCaseFigure: the real listings (L became the width in the spine)', () => {
  // the picture shapes are Ross's own: Megumi drew 86 x 229 mm at the scale's height, so her picture is 86/229 wide per mm of height
  const cases: Array<[string, Figure, number, number, number]> = [
    // name, figure, picture aspect, expected height, expected width
    ['Megumi 676026 (W240, 1/7; drew 86 x 229)', listed({ widthMm: 240 }, '1/7'), 86 / 229, 240 / (86 / 229), 240],
    ['Kurumi 945990 (W230, 1/7)', listed({ widthMm: 230 }, '1/7'), 0.5, 460, 230],
    ['Kurumi 1226170 (W230, 1/7)', listed({ widthMm: 230 }, '1/7'), 0.5, 460, 230],
    ['Koakuma 868090 (W200, no scale; the 200 mm default before)', listed({ widthMm: 200 }), 1, 200, 200],
    ['Satellizer 61425 (W450, 1/4; not drawn before)', listed({ widthMm: 450 }, '1/4'), 1.6, 281.25, 450],
    ['Togame 124233 (W900; not drawn before)', listed({ widthMm: 900 }), 2, 450, 900],
    ['Boa 342723 (W150 curated)', listed({ widthMm: 150 }), 1.5, 100, 150],
  ];
  for (const [name, figure, aspect, height, width] of cases) {
    it(name, () => {
      const m = measureCaseFigure(figure, 0, meta(aspect));
      expect(m.heightMm).toBeCloseTo(height, 6);
      expect(m.widthMm).toBe(width);
      expect(m.billboardWidthMm).toBeCloseTo(width, 6);
      expect(m.heightEstimated).toBe(true);
      expect(m.widthBasis).toBe('labeled');
    });
  }

  it('Ikaruga 1354992 (W450 D900, no H): the listed width and the photo, the depth as listed', () => {
    const m = measureCaseFigure(listed({ widthMm: 450, depthMm: 900 }), 0, meta(2));
    expect([m.heightMm, m.widthMm, m.depthMm]).toEqual([225, 450, 900]);
  });

  it('a labeled height is never replaced: H and W listed give H and W', () => {
    const m = measureCaseFigure(listed({ heightMm: 240, widthMm: 100 }, '1/7'), 0, meta(0.375));
    expect([m.heightMm, m.widthMm, m.heightEstimated]).toEqual([240, 100, false]);
  });

  it('no width and a scale is the nominal height still; the width is held to the scale or the length (CASE-FB3b)', () => {
    const m = measureCaseFigure(listed({}, '1/7'), 0, meta(0.375));
    expect(m.heightMm).toBeCloseTo(229, 0);
  });

  it('a height derived from a very tall picture is read as the most any figure is', () => {
    const m = measureCaseFigure(listed({ widthMm: 900 }), 0, meta(0.2));
    expect(m.heightMm).toBe(MAX_PLAUSIBLE_HEIGHT_MM);
  });

  it('a cut-out: the height is the one at which the CLEAR part of the picture is the listed width', () => {
    // a square picture, a third clear above the figure and a tenth on each side: at 200 mm the figure draws 240 mm wide (1.2 per mm)
    const drawn = { top: 1 / 3, bottom: 0, left: 0.1, right: 0.1 };
    const m = measureCaseFigure(listed({ widthMm: 240 }, '1/7'), 0, meta(1), drawn);
    expect(m.widthMm).toBe(240);
    expect(m.heightMm).toBeCloseTo(200, 6);
  });
});

describe('describeSize: the Info card says where the height came from', () => {
  it('a width and no height: from the listed width and the photo, not from the scale', () => {
    const s = describeSize(fig({ ...listed({ widthMm: 240 }, '1/7') }));
    expect(s.heightBasis).toBe('photo');
    expect(s.estimated).toBe(true);
    expect(s.line).toBe('height from the listed width and the photo · 240 mm wide · depth from the width');
  });

  it('with the picture shape known, it says the height too', () => {
    const s = describeSize(fig({ ...listed({ widthMm: 240 }, '1/7') }), undefined, 0.375);
    expect(s.heightMm).toBe(640);
    expect(s.line).toBe('≈ 640 mm tall · from the listed width and the photo · 240 mm wide · depth from the width');
  });

  it('a height listed: unchanged', () => {
    expect(describeSize(fig({ ...listed({ heightMm: 245, widthMm: 170 }) }), undefined, 0.5).line).toBe('245 mm tall · 170 mm wide · depth from the width');
  });

  it('no width: the scale\'s height, unchanged', () => {
    expect(describeSize(fig({ scale: '1/7' }), undefined, 0.5).heightBasis).toBe('scale');
  });
});

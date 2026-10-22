// SIZE-L3 (desk SIZE-L3, pre-built): an mfc "L" with no H and no W is the figure's LONGEST extent. The spine keeps it as the depth
// (MFC's L lands in depth); the app places it by the photo: a wide picture is a figure lying down, so L is its width and the
// height follows from the picture's proportions; a tall one is standing, so L is its height and the width follows. The scale's
// nominal height is ignored either way. Evidence (Fold8 shots, 10-20): taking L as the width stood Megumi (L240, a standing 1/7)
// up to 637 mm; as the longest side she is 240 tall.
import { describe, expect, it } from 'vitest';
import type { Figure } from '@figurecollecting/fc-shared';
import { UNMATTED_META } from '../displayMeta';
import { DEPTH_WIDTH_RATIO, MAX_PLAUSIBLE_HEIGHT_MM, resolveHeightMm, resolveLoneLength } from '../sizeResolution';
import { measureCaseFigure } from '../packCabinets';
import { describeSize } from '../sizeBasis';

const fig = (over: Partial<Figure> = {}): Figure =>
  ({ _id: 'f', name: 'F', manufacturer: 'M', scale: '', userId: 'u', createdAt: '', updatedAt: '', ...over }) as Figure;
const listed = (dimensions: Figure['dimensions'], scale = ''): Figure => fig({ dimensions, scale });
const meta = (aspect: number) => ({ ...UNMATTED_META, aspect });

describe('resolveLoneLength: the longest extent, placed by the photo', () => {
  it('a tall picture: L is the height, the width follows', () => {
    const r = resolveLoneLength(listed({ depthMm: 240 }, '1/7'), 0.375);
    expect(r).toMatchObject({ longest: 'height', heightMm: 240, lengthMm: 240 });
    expect(r!.widthMm).toBeCloseTo(90, 9);
  });

  it('a wide picture: L is the width, the height follows', () => {
    const r = resolveLoneLength(listed({ depthMm: 450 }), 2.8);
    expect(r).toMatchObject({ longest: 'width', widthMm: 450 });
    expect(r!.heightMm).toBeCloseTo(450 / 2.8, 9);
  });

  it('a square picture reads as lying (the length is the width): the boundary is a picture as wide as it is tall', () => {
    expect(resolveLoneLength(listed({ depthMm: 200 }), 1)).toMatchObject({ longest: 'width', widthMm: 200, heightMm: 200 });
    expect(resolveLoneLength(listed({ depthMm: 200 }), 0.999)!.longest).toBe('height');
  });

  it('only a LONE length: a listed height or a listed width is something else', () => {
    expect(resolveLoneLength(listed({ depthMm: 240, heightMm: 100 }), 0.5)).toBeNull();
    expect(resolveLoneLength(listed({ depthMm: 240, widthMm: 100 }), 0.5)).toBeNull();
  });

  it('nothing to place it by: no length, a bad length, no picture shape', () => {
    expect(resolveLoneLength(listed({}), 0.5)).toBeNull();
    for (const bad of [0, -3, Number.NaN]) expect(resolveLoneLength(listed({ depthMm: bad }), 0.5)).toBeNull();
    for (const bad of [undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(resolveLoneLength(listed({ depthMm: 240 }), bad)).toBeNull();
  });
});

describe('resolveHeightMm: the rung between a listed width and the scale', () => {
  it('a lone length: the height of the figure placed by the photo, not the scale', () => {
    expect(resolveHeightMm(listed({ depthMm: 240 }, '1/7'), 0.375)).toEqual({ heightMm: 240, source: 'length' });
    expect(resolveHeightMm(listed({ depthMm: 450 }, '1/4'), 2.8)?.source).toBe('length');
  });

  it('a listed height or a listed width still comes first', () => {
    expect(resolveHeightMm(listed({ depthMm: 240, heightMm: 100 }, '1/7'), 0.375)?.source).toBe('labeled');
    expect(resolveHeightMm(listed({ depthMm: 240, widthMm: 100 }, '1/7'), 0.375)?.source).toBe('width-photo');
  });

  it('no picture shape: the scale, as before', () => {
    expect(resolveHeightMm(listed({ depthMm: 240 }, '1/7'))?.source).toBe('scale-estimate');
  });
});

describe('measureCaseFigure: Ross\'s real listings (L is the depth in the spine, as today)', () => {
  it('Megumi 676026 (L240, 1/7, a standing photo 86 x 229): 240 tall and as wide as the photo is, not 637 tall', () => {
    const aspect = 86 / 229;
    const m = measureCaseFigure(listed({ depthMm: 240 }, '1/7'), 0, meta(aspect));
    expect(m.heightMm).toBeCloseTo(240, 6);
    expect(m.widthMm).toBeCloseTo(240 * aspect, 6);
    expect(m.depthMm).toBeCloseTo(DEPTH_WIDTH_RATIO * 240 * aspect, 6);
    expect([m.heightEstimated, m.widthBasis]).toEqual([true, 'photo']);
  });

  it('Kurumi 945990 and 1226170 (L230, 1/7, a standing photo): 230 tall', () => {
    const m = measureCaseFigure(listed({ depthMm: 230 }, '1/7'), 0, meta(0.757));
    expect(m.heightMm).toBeCloseTo(230, 6);
    expect(m.widthMm).toBeCloseTo(230 * 0.757, 6);
  });

  it('Satellizer 61425 (L450, 1/4, a reclining photo about 2.83 wide per tall): 450 wide, about 159 tall; not drawn before', () => {
    const m = measureCaseFigure(listed({ depthMm: 450 }, '1/4'), 0, meta(2.83));
    expect(m.widthMm).toBeCloseTo(450, 6);
    expect(m.heightMm).toBeCloseTo(450 / 2.83, 6);
    expect(m.widthBasis).toBe('length');
    expect(m.billboardWidthMm).toBeCloseTo(450, 6);
  });

  it('Koakuma 868090, Togame 124233 and the other L-only figures follow the same rule, scale or none', () => {
    const lying = measureCaseFigure(listed({ depthMm: 900 }), 0, meta(2));
    expect([lying.widthMm, lying.heightMm]).toEqual([900, 450]);
    const standing = measureCaseFigure(listed({ depthMm: 200 }), 0, meta(0.5));
    expect([standing.heightMm, standing.widthMm]).toEqual([200, 100]);
    const withScale = measureCaseFigure(listed({ depthMm: 200 }, '1/6'), 0, meta(0.5));
    expect([withScale.heightMm, withScale.widthMm]).toEqual([200, 100]);
  });

  it('the length is no longer the footprint\'s depth: Ross\'s ratio of the width is', () => {
    const m = measureCaseFigure(listed({ depthMm: 450 }), 0, meta(2.83));
    expect(m.depthMm).toBeCloseTo(DEPTH_WIDTH_RATIO * 450, 6);
  });

  it('a cut-out is read by its clear part: at the picture\'s own proportions', () => {
    // a square picture with a third clear above and a tenth either side draws 1.2 wide per mm of height: wide, so L is the width
    const drawn = { top: 1 / 3, bottom: 0, left: 0.1, right: 0.1 };
    const m = measureCaseFigure(listed({ depthMm: 240 }, '1/7'), 0, meta(1), drawn);
    expect(m.widthMm).toBeCloseTo(240, 6);
    expect(m.heightMm).toBeCloseTo(200, 6);
  });

  it('a length with a listed height or width is not this rule: H and L, W and L keep their readings', () => {
    const hl = measureCaseFigure(listed({ heightMm: 240, depthMm: 100 }, '1/7'), 0, meta(0.5));
    expect([hl.heightMm, hl.depthMm]).toEqual([240, 100]);
    const wl = measureCaseFigure(listed({ widthMm: 900, depthMm: 450 }), 0, meta(2));
    expect([wl.widthMm, wl.heightMm, wl.depthMm]).toEqual([900, 450, 450]);
  });

  it('a corrupt length is read as the most any figure is', () => {
    expect(measureCaseFigure(listed({ depthMm: 9000 }), 0, meta(0.5)).heightMm).toBe(MAX_PLAUSIBLE_HEIGHT_MM);
  });

  it('no length, no width, no height: the scale (or the default) as ever', () => {
    expect(measureCaseFigure(listed({}, '1/7'), 0, meta(0.5)).heightMm).toBeCloseTo(229, 0);
  });
});

describe('describeSize: the Info card says what the length was read as', () => {
  const lone = (depthMm: number) => fig({ dimensions: { depthMm }, scale: '1/7' });

  it('a tall picture: the length is the height', () => {
    const s = describeSize(lone(240), undefined, 0.375);
    expect(s.line).toBe('240 mm tall · from the listed length · width from the photo · depth from the width');
    expect([s.heightBasis, s.widthBasis, s.depthBasis, s.estimated]).toEqual(['length', 'photo', 'width', true]);
    expect(s.heightMm).toBe(240);
  });

  it('a wide picture: the length is the width', () => {
    const s = describeSize(lone(450), undefined, 2.8);
    expect(s.line).toBe('≈ 161 mm tall · from the photo · 450 mm wide (the listed length) · depth from the width');
    expect([s.heightBasis, s.widthBasis]).toEqual(['photo', 'length']);
  });

  it('without the picture\'s shape: the card does not guess which way the length lies', () => {
    const s = describeSize(lone(240));
    expect(s.line).toBe('size from the listed length and the photo · depth from the width');
    expect([s.heightBasis, s.widthBasis, s.estimated]).toEqual(['photo', 'photo', true]);
  });

  it('a height listed with the length: unchanged, the length is the depth', () => {
    expect(describeSize(fig({ dimensions: { heightMm: 245, depthMm: 100 } }), undefined, 0.5).line).toBe('245 mm tall · width from the photo · 100 mm deep');
  });
});

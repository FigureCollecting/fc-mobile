import { describe, it, expect } from 'vitest';
import type { Figure } from '@figurecollecting/fc-shared';
import { MAX_MARGIN_FRAC, figureArt, imageRefFromProductImage, pictureBox } from '../figureArt';
import { UNMATTED_META } from '../displayMeta';
import type { FigureDisplayMeta } from '../displayMeta';

const BASE = 'https://images.example';
const MATTED: FigureDisplayMeta = { ...UNMATTED_META, matted: true, baseRecovered: true, bottomMarginFrac: 0.04 };
const fig = (patch: Partial<Figure> = {}) => ({ _id: 'p1', name: 'P', scale: '', ...patch }) as Figure;

describe('figureArt (CASE-ADAPT)', () => {
  it('an image with a separate mask composites: masked, grounded on the mask', () => {
    const art = figureArt(fig(), UNMATTED_META, { url: '/d/abc.webp', maskUrl: '/m/abc.png', bottomMarginFrac: 0.07, contactBand: { centerXFrac: 0.4, widthFrac: 0.5 } }, BASE);
    expect(art).toEqual({
      kind: 'masked',
      url: '/d/abc.webp',
      maskUrl: '/m/abc.png',
      alphaUrl: '/m/abc.png',
      bottomMarginFrac: 0.07,
      contactBand: { centerXFrac: 0.4, widthFrac: 0.5 },
    });
  });

  it('a mask with no image is no picture: the plate', () => {
    expect(figureArt(fig(), UNMATTED_META, { url: '', maskUrl: '/m/abc.png' }, BASE).kind).toBe('plate');
  });

  it('a matted picture is its own cut-out, grounded on its own alpha', () => {
    const art = figureArt(fig({ imageUrl: '/fx/rem.png' }), MATTED, undefined, BASE);
    expect(art).toEqual({ kind: 'cutout', url: '/fx/rem.png', alphaUrl: '/fx/rem.png', bottomMarginFrac: 0.04, contactBand: undefined });
  });

  it('the matte derivative is served by resolveFigureImageUrl when the figure carries one', () => {
    const art = figureArt(fig({ imageUrl: '/plain.jpg', displayMeta: { matted: true, matteImageId: 'i', matteVersionId: 'v' } }), MATTED, undefined, BASE);
    expect(art.url).toBe(`${BASE}/serve/i@v`);
  });

  it('a clean copy without matting stands as a framed picture; no grounding fields', () => {
    expect(figureArt(fig({ imageUrl: '/plain.jpg' }), UNMATTED_META, undefined, BASE)).toEqual({ kind: 'framed', url: '/plain.jpg' });
    expect(figureArt(fig(), UNMATTED_META, { url: '/d/x.webp' }, BASE)).toEqual({ kind: 'framed', url: '/d/x.webp' });
  });

  it('no picture at all: the plate', () => {
    expect(figureArt(fig(), UNMATTED_META, undefined, BASE)).toEqual({ kind: 'plate' });
  });

  it("the image list's picture wins over the figure's own matte: without a mask it stands framed, never as the matte's cut-out", () => {
    expect(figureArt(fig({ imageUrl: '/fx/rem.png' }), MATTED, { url: '/d/x.webp' }, BASE)).toEqual({ kind: 'framed', url: '/d/x.webp' });
  });
});

describe('pictureBox: the picture sized so the figure in it stands at its labelled height (true scale)', () => {
  it("a cut-out with clear margins above and below: its opaque rows span exactly the labelled height, the lowest on the surface", () => {
    const b = pictureBox('cutout', 180, 0.843, { top: 0.25, bottom: 0.05 }, 152);
    expect(b.heightMm).toBeCloseTo(180 / 0.7, 9);
    expect(b.heightMm * (1 - 0.25 - 0.05)).toBeCloseTo(180, 9);
    expect(b.belowMm).toBeCloseTo(0.05 * (180 / 0.7), 9);
    // its sides are clear: a cut-out keeps its own shape, never narrowed to the footprint
    expect(b.widthMm).toBeCloseTo((0.843 * 180) / 0.7, 9);
  });

  it('masked art the same way: the margins are the mask\'s', () => {
    const b = pictureBox('masked', 230, 0.688, { top: 0.18, bottom: 0.03 }, 100);
    expect(b.heightMm * (1 - 0.18 - 0.03)).toBeCloseTo(230, 9);
    expect(b.widthMm).toBeCloseTo(0.688 * b.heightMm, 9);
  });

  it('no margins: the picture is the figure', () => {
    expect(pictureBox('cutout', 200, 0.5, { top: 0, bottom: 0 }, 100)).toEqual({ widthMm: 100, heightMm: 200, belowMm: 0 });
  });

  it(`a margin past ${MAX_MARGIN_FRAC * 100} % of the picture is not believed; a negative one or none is 0`, () => {
    expect(MAX_MARGIN_FRAC).toBe(0.45);
    const top = pictureBox('cutout', 100, 1, { top: 0.9, bottom: 0 }, 100);
    expect(top.heightMm).toBeCloseTo(100 / (1 - MAX_MARGIN_FRAC), 9);
    const bottom = pictureBox('cutout', 100, 1, { top: 0, bottom: 0.7 }, 100);
    expect(bottom.heightMm).toBeCloseTo(100 / (1 - MAX_MARGIN_FRAC), 9);
    expect(bottom.belowMm).toBeCloseTo(MAX_MARGIN_FRAC * bottom.heightMm, 9);
    expect(pictureBox('cutout', 100, 1, { top: -0.2, bottom: -0.1 }, 100)).toEqual({ widthMm: 100, heightMm: 100, belowMm: 0 });
    expect(pictureBox('cutout', 100, 1, { top: Number.NaN, bottom: Number.NaN }, 100)).toEqual({ widthMm: 100, heightMm: 100, belowMm: 0 });
  });

  it('framed and plate art are opaque boxes: never wider than the footprint, so neighbours never overlap', () => {
    expect(pictureBox('framed', 230, 0.75, { top: 0, bottom: 0 }, 100)).toEqual({ widthMm: 100, heightMm: 230, belowMm: 0 });
    expect(pictureBox('plate', 230, 0.75, { top: 0, bottom: 0 }, 100)).toEqual({ widthMm: 100, heightMm: 230, belowMm: 0 });
    // narrower than the footprint: their own shape
    expect(pictureBox('framed', 100, 0.75, { top: 0, bottom: 0 }, 300).widthMm).toBeCloseTo(75, 9);
    expect(pictureBox('plate', 100, 0.75, { top: 0, bottom: 0 }, 300).widthMm).toBeCloseTo(75, 9);
  });
});

describe('imageRefFromProductImage', () => {
  it('takes the URL, the mask and the grounding of a GetProductImages entry', () => {
    expect(
      imageRefFromProductImage({
        url: '/d/1.webp',
        width: 600,
        height: 800,
        mask: { url: '/m/1.png' },
        bottomMarginFrac: 0.02,
        contactBand: { centerXFrac: 0.5, widthFrac: 0.6 },
      }),
    ).toEqual({ url: '/d/1.webp', maskUrl: '/m/1.png', width: 600, height: 800, bottomMarginFrac: 0.02, contactBand: { centerXFrac: 0.5, widthFrac: 0.6 } });
  });

  it('a size is taken only when both sides are known', () => {
    expect(imageRefFromProductImage({ url: '/d/3.webp', width: 600, height: 0 })).toEqual({ url: '/d/3.webp' });
    expect(imageRefFromProductImage({ url: '/d/3.webp', width: 0, height: 800 })).toEqual({ url: '/d/3.webp' });
  });

  it('an empty URL (no public media base) or an empty mask URL is no image or no mask', () => {
    expect(imageRefFromProductImage({ url: '', width: 0, height: 0 })).toBeUndefined();
    expect(imageRefFromProductImage({ url: '/d/2.webp', width: 0, height: 0, mask: { url: '' } })).toEqual({ url: '/d/2.webp' });
  });
});

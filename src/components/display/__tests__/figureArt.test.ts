import { describe, it, expect } from 'vitest';
import type { Figure } from '@figurecollecting/fc-shared';
import { figureArt, imageRefFromProductImage } from '../figureArt';
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

  it('an empty URL (no public media base) or an empty mask URL is no image or no mask', () => {
    expect(imageRefFromProductImage({ url: '', width: 0, height: 0 })).toBeUndefined();
    expect(imageRefFromProductImage({ url: '/d/2.webp', width: 0, height: 0, mask: { url: '' } })).toEqual({ url: '/d/2.webp' });
  });
});

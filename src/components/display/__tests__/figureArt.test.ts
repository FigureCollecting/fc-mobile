import { describe, it, expect } from 'vitest';
import type { Figure } from '@figurecollecting/fc-shared';
import { MAX_MARGINS_FRAC, drawnWidthMm, figureArt, imageRefFromProductImage, pictureBox, pictureOffsetMm } from '../figureArt';
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

  it('a large clear margin is believed: the figure still stands its full height (a tall picture, a small figure in it)', () => {
    // 60 % clear above the head, 5 % under the feet: the box is 100 / 0.35 tall, the figure in it 100
    const b = pictureBox('cutout', 100, 0.75, { top: 0.6, bottom: 0.05 }, 75);
    expect(b.heightMm).toBeCloseTo(100 / 0.35, 9);
    expect(b.heightMm * (1 - 0.6 - 0.05)).toBeCloseTo(100, 9);
    expect(b.belowMm).toBeCloseTo(0.05 * b.heightMm, 9);
    expect(pictureBox('cutout', 100, 1, { top: 0, bottom: 0.7 }, 100).heightMm).toBeCloseTo(100 / 0.3, 9);
  });

  it(`the two margins together are believed up to ${MAX_MARGINS_FRAC * 100} % of the picture (a box at most 10x the figure): the feet keep the surface, the top gives way`, () => {
    expect(MAX_MARGINS_FRAC).toBe(0.9);
    // exactly at the cap: believed as it is
    const at = pictureBox('cutout', 100, 1, { top: 0.85, bottom: 0.05 }, 100);
    expect(at.heightMm).toBeCloseTo(1000, 6);
    expect(at.belowMm).toBeCloseTo(50, 6);
    // past it: the bottom margin stays, so the lowest opaque row is still on the surface; the top is cut to fit
    const over = pictureBox('cutout', 100, 1, { top: 0.93, bottom: 0.05 }, 100);
    expect(over.heightMm).toBeCloseTo(1000, 6);
    expect(over.belowMm).toBeCloseTo(0.05 * over.heightMm, 6);
    // a bottom margin past the cap alone: capped, nothing left for the top
    const low = pictureBox('cutout', 100, 1, { top: 0.04, bottom: 0.95 }, 100);
    expect(low.heightMm).toBeCloseTo(1000, 6);
    expect(low.belowMm).toBeCloseTo(900, 6);
    // never more than 10x the figure, whatever the margins say
    for (const [top, bottom] of [[0.5, 0.5], [0.99, 0], [0, 0.99], [1, 1], [0.45, 0.45]]) {
      expect(pictureBox('cutout', 100, 1, { top, bottom }, 100).heightMm, `${top} ${bottom}`).toBeLessThanOrEqual(1000 + 1e-6);
    }
  });

  it('a negative margin or none is 0', () => {
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

describe('drawnWidthMm: how wide the figure in a cut-out or masked picture draws at true scale (its opaque columns)', () => {
  it('the picture drawn so the figure stands its labelled height, less its clear columns left and right', () => {
    const margins = { top: 0.25, bottom: 0.05, left: 0.1, right: 0.2 };
    expect(drawnWidthMm(180, 0.843, margins)).toBeCloseTo(((0.843 * 180) / 0.7) * 0.7, 9);
    expect(drawnWidthMm(180, 0.843, margins)).toBeCloseTo(pictureBox('cutout', 180, 0.843, margins, 1).widthMm * (1 - 0.1 - 0.2), 9);
  });

  it('wider than the picture at its labelled height when the clear rows are tall (Madoka: wings over a small figure)', () => {
    // a third of the picture clear above the head: the figure draws 1.5x as wide as aspect x height
    expect(drawnWidthMm(100, 1, { top: 1 / 3, bottom: 0, left: 0, right: 0 })).toBeCloseTo(150, 9);
  });

  it('no side margins known (none, negative, or none measured): the whole picture width', () => {
    expect(drawnWidthMm(200, 0.5, { top: 0, bottom: 0 })).toBeCloseTo(100, 9);
    expect(drawnWidthMm(200, 0.5, { top: 0, bottom: 0, left: -0.2, right: Number.NaN })).toBeCloseTo(100, 9);
  });

  it(`keeps the ${MAX_MARGINS_FRAC * 100} % cap on the rows, and never goes below 0 however clear the sides say they are`, () => {
    expect(drawnWidthMm(100, 1, { top: 0.95, bottom: 0.05, left: 0, right: 0 })).toBeCloseTo(1000, 6);
    expect(drawnWidthMm(100, 1, { top: 0, bottom: 0, left: 0.7, right: 0.6 })).toBe(0);
  });
});

describe('pictureOffsetMm: a picture moved so the figure in it, not the picture, stands centred on its slot', () => {
  /** Where the figure's opaque columns sit along the wall when its picture, widthMm wide, is drawn at slot centre cx and moved by the offset. */
  const opaque = (cx: number, widthMm: number, sides: { left: number; right: number }) => {
    const x = cx + pictureOffsetMm(widthMm, { top: 0, bottom: 0, ...sides });
    return { x0: x - widthMm / 2 + sides.left * widthMm, x1: x + widthMm / 2 - sides.right * widthMm };
  };

  it('a figure leaning right in its picture moves the picture left by half the difference of its clear sides', () => {
    expect(pictureOffsetMm(200, { top: 0.2, bottom: 0.03, left: 0.38, right: 0.02 })).toBeCloseTo(-36, 9);
    const o = opaque(500, 200, { left: 0.38, right: 0.02 });
    expect((o.x0 + o.x1) / 2).toBeCloseTo(500, 9);
  });

  it('one leaning left moves it right', () => {
    expect(pictureOffsetMm(100, { top: 0, bottom: 0, left: 0.1, right: 0.7 })).toBeCloseTo(30, 9);
    const o = opaque(-40, 100, { left: 0.1, right: 0.7 });
    expect((o.x0 + o.x1) / 2).toBeCloseTo(-40, 9);
  });

  it('centres every figure, whatever its clear sides', () => {
    for (let left = 0; left < 0.9; left += 0.05) {
      for (let right = 0; left + right < 0.95; right += 0.05) {
        const o = opaque(120, 250, { left, right });
        expect((o.x0 + o.x1) / 2, `${left} ${right}`).toBeCloseTo(120, 9);
      }
    }
  });

  it('a centred figure, or sides not known (framed, plate, not read yet): not moved', () => {
    expect(pictureOffsetMm(180, { top: 0.1, bottom: 0.1, left: 0.25, right: 0.25 })).toBe(0);
    expect(pictureOffsetMm(180, { top: 0.1, bottom: 0.1 })).toBe(0);
  });

  it('a negative clear side, or none measured (NaN), is 0', () => {
    expect(pictureOffsetMm(100, { top: 0, bottom: 0, left: -0.2, right: Number.NaN })).toBe(0);
    expect(pictureOffsetMm(100, { top: 0, bottom: 0, left: 0.3, right: -0.1 })).toBeCloseTo(-15, 9);
    expect(pictureOffsetMm(100, { top: 0, bottom: 0, left: Number.NaN, right: 0.3 })).toBeCloseTo(15, 9);
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

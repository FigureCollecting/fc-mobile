// SIZE-BASIS-1 (Ross 10-18, "makes me wonder if they got the size data or if they assumed height or scale"): what the case
// draws a figure at, and what that size rests on. Read off the packer's own resolution (sizeResolution), so the card can
// never say a size is measured when the case guessed it.
import { describe, expect, it } from 'vitest';
import type { Figure } from '@figurecollecting/fc-shared';
import { countEstimated, describeSize } from '../sizeBasis';
import { photoFitNote } from '../photoFit';
import { DEFAULT_FIGURE_HEIGHT_MM } from '../packCabinets';
import { MAX_PLAUSIBLE_HEIGHT_MM } from '../sizeResolution';

const fig = (over: Partial<Figure> = {}): Figure =>
  ({ _id: 'f', name: 'F', manufacturer: 'M', scale: '', userId: 'u', createdAt: '', updatedAt: '', ...over }) as Figure;
const dims = (heightMm?: number, widthMm?: number, depthMm?: number) => ({ dimensions: { heightMm, widthMm, depthMm } }) as Partial<Figure>;

describe('describeSize: what each size rests on', () => {
  it('all three from the listing: one line, "measured"', () => {
    const s = describeSize(fig({ ...dims(245, 170, 190), scale: '1/7' }));
    expect(s.line).toBe('245 × 170 × 190 mm · measured');
    expect([s.heightBasis, s.widthBasis, s.depthBasis, s.estimated]).toEqual(['labeled', 'labeled', 'labeled', false]);
  });

  it('a height and a width, no depth: the depth is said to come from the width, and the figure is not estimated', () => {
    const s = describeSize(fig(dims(245, 170)));
    expect(s.line).toBe('245 mm tall · 170 mm wide · depth from the width');
    expect(s.estimated).toBe(false);
  });

  it('a height only: the width is from the photo, so the figure is sized from an estimate', () => {
    const s = describeSize(fig(dims(245)));
    expect(s.line).toBe('245 mm tall · width from the photo · depth from the width');
    expect([s.heightBasis, s.widthBasis, s.estimated]).toEqual(['labeled', 'photo', true]);
  });

  it('no size but a scale: the height is the scale\'s nominal one (1600 mm / n), and the width is held to that', () => {
    const s = describeSize(fig({ scale: '1/7' }));
    expect(s.line).toBe('≈ 229 mm tall · from scale 1/7 · width from the photo, at most 229 mm (its scale\'s height) · depth from the width');
    expect([s.heightBasis, s.heightMm, s.widthCapOf, s.widthCapMm, s.estimated]).toEqual(['scale', 229, 'scale', 229, true]);
  });

  it('a scale and a labelled length (MFC\'s L lands in depth): the longest side, placed by the photo (SIZE-L3); the scale is ignored', () => {
    const s = describeSize(fig({ scale: '1/8', ...dims(undefined, undefined, 190) }));
    expect(s.line).toBe('size from the listed length and the photo · depth from the width');
    expect(s.widthCapOf).toBeUndefined();
  });

  it('nothing at all: the default height, said to be a default', () => {
    const s = describeSize(fig());
    expect(s.line).toBe(`≈ ${DEFAULT_FIGURE_HEIGHT_MM} mm · default, no size data · width from the photo · depth from the width`);
    expect([s.heightBasis, s.heightMm, s.widthCapOf, s.estimated]).toEqual(['default', DEFAULT_FIGURE_HEIGHT_MM, undefined, true]);
  });

  it('a labelled height stands: the width is never held to a cap, whatever else is known', () => {
    const s = describeSize(fig({ scale: '1/7', ...dims(245, undefined, 190) }));
    expect(s.line).toBe('245 mm tall · width from the photo · 190 mm deep');
    expect(s.widthCapOf).toBeUndefined();
  });

  it('a labelled width beside an estimated height: the width is measured, the height rests on the photo (SIZE-L1, not the scale), and the figure is still estimated', () => {
    const s = describeSize(fig({ scale: '1/7', ...dims(undefined, 150) }));
    expect(s.line).toBe('height from the listed width and the photo · 150 mm wide · depth from the width');
    expect([s.heightBasis, s.widthBasis, s.estimated]).toEqual(['photo', 'labeled', true]);
  });

  it.each([
    ['zero', 0],
    ['a negative', -5],
    ['not a number', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
  ])('a %s height is no height: the scale or the default stands in, as the case draws', (_label, h) => {
    expect(describeSize(fig({ scale: '1/7', ...dims(h) })).heightBasis).toBe('scale');
    expect(describeSize(fig(dims(h))).heightBasis).toBe('default');
  });

  it.each(['', '1:7', 'one seventh', '2/7', '1/0'])('a scale that is not 1/n (%j) gives no height', (scale) => {
    expect(describeSize(fig({ scale })).heightBasis).toBe('default');
  });

  it('a width or a depth of zero is no measurement: from the photo, from the width', () => {
    const s = describeSize(fig(dims(245, 0, 0)));
    expect(s.line).toBe('245 mm tall · width from the photo · depth from the width');
  });

  it('a scraper-corrupted height past what any figure is: said so, and read as the case reads it', () => {
    const s = describeSize(fig(dims(660580570, 100, 100)));
    expect(s.heightMm).toBe(MAX_PLAUSIBLE_HEIGHT_MM);
    expect(s.line).toBe(`660580570 mm tall, read as ${MAX_PLAUSIBLE_HEIGHT_MM} mm · 100 mm wide · 100 mm deep`);
    expect(s.estimated).toBe(false);
  });

  it('rounds to whole millimetres', () => {
    expect(describeSize(fig(dims(244.6, 170.4, 190.5))).line).toBe('245 × 170 × 191 mm · measured');
  });
});

describe('countEstimated', () => {
  it('counts the figures whose height or width is not from the listing', () => {
    const figures = [fig(dims(245, 170, 190)), fig(dims(245)), fig({ scale: '1/7' }), fig(), fig(dims(245, 170))];
    expect(countEstimated(figures)).toBe(3);
    expect(countEstimated([])).toBe(0);
  });
});

describe('FIT1: a photo more than 15 % off the listed width is said so in the Size row', () => {
  it('wider than listed: says by how much and that it is drawn to the listing', () => {
    const s = describeSize(fig(dims(360, 227, 160)), { dir: 'wider', pct: 23 });
    expect(s.line).toBe('360 × 227 × 160 mm · measured · photo 23 % wider than listed: drawn to the listing');
    expect(s.photoFit).toEqual({ dir: 'wider', pct: 23 });
    // the size is still the listing's: nothing in it is an estimate
    expect(s.estimated).toBe(false);
  });

  it('narrower than listed: says it is drawn at the listed height', () => {
    expect(describeSize(fig(dims(360, 227)), { dir: 'narrower', pct: 21 }).line).toBe(
      '360 mm tall · 227 mm wide · depth from the width · photo 21 % narrower than listed: drawn at the listed height',
    );
  });

  it('no flag: the line as it was, and no photoFit', () => {
    const s = describeSize(fig(dims(360, 227, 160)));
    expect(s.line).toBe('360 × 227 × 160 mm · measured');
    expect(s.photoFit).toBeUndefined();
  });

  it('the wording lives with the flag', () => {
    expect(photoFitNote({ dir: 'wider', pct: 16 })).toBe('photo 16 % wider than listed: drawn to the listing');
  });
});

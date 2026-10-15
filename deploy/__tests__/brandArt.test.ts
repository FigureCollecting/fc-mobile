import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ICON_BG,
  ICON_FIGURE_SCALE,
  ICON_SIZES,
  figureLayout,
  iconFigureFraction,
  parseFigureArt,
  roundPathData,
  splashArtMarkup,
} from '../brandArt';
import { decodePng, encodeRgbPng } from '../png';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string): Buffer => readFileSync(path.join(ROOT, rel));

describe('the generated app icons', () => {
  it('draws the figure at ICON_FIGURE_SCALE times the old 59 % of the icon height', () => {
    expect(ICON_FIGURE_SCALE).toBe(1.4);
    expect(iconFigureFraction()).toBeCloseTo(0.826, 3);
  });

  for (const size of ICON_SIZES) {
    it(`${size}px: figure bounding box height is within 2 % of the scale target, centred, on the brand background`, () => {
      const png = decodePng(read(`public/icons/icon-${size}.png`));
      expect([png.width, png.height]).toEqual([size, size]);
      const bg = png.pixel(0, 0);
      expect(`#${bg.map((v) => v.toString(16).padStart(2, '0')).join('')}`).toBe(ICON_BG);
      let [x0, y0, x1, y1] = [size, size, -1, -1];
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const p = png.pixel(x, y);
          if (Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]) > 60) {
            x0 = Math.min(x0, x);
            x1 = Math.max(x1, x);
            y0 = Math.min(y0, y);
            y1 = Math.max(y1, y);
          }
        }
      }
      const height = y1 - y0 + 1;
      const target = iconFigureFraction() * size;
      expect(Math.abs(height - target) / target).toBeLessThanOrEqual(0.02);
      // Same centre as before: horizontally in the middle, a little below it (the plinth is the heavy end).
      expect(Math.abs((x0 + x1 + 1) / 2 - size / 2)).toBeLessThanOrEqual(size * 0.01);
      expect(Math.abs((y0 + y1 + 1) / 2 / size - 0.5127)).toBeLessThanOrEqual(0.01);
    });
  }
});

describe('figure layout', () => {
  const bbox = { x: 40, y: 30, width: 100, height: 400 };

  it('scales the figure to the fraction of the icon height and centres its box on the given point', () => {
    const { scale, tx, ty } = figureLayout(bbox, 512, 0.5, { x: 0.5, y: 0.5 });
    expect(scale).toBeCloseTo(0.64);
    // The scaled box is 64 x 256, centred on (256, 256): left 224, top 128.
    expect(40 * scale + tx).toBeCloseTo(224);
    expect(30 * scale + ty).toBeCloseTo(128);
  });
});

describe('PNG helpers', () => {
  it('round-trips an opaque RGB image', () => {
    const rgb = Uint8Array.from([1, 2, 3, 10, 20, 30, 100, 110, 120, 250, 251, 252]);
    const png = decodePng(encodeRgbPng(2, 2, rgb));
    expect([png.width, png.height]).toEqual([2, 2]);
    expect(png.pixel(0, 0)).toEqual([1, 2, 3]);
    expect(png.pixel(1, 1)).toEqual([250, 251, 252]);
  });

  it('decodes the committed RGB icons and the RGBA badge (every filter type in use)', () => {
    expect(decodePng(read('public/icons/icon-192.png')).pixel(0, 0)).toHaveLength(3);
    const badge = decodePng(read('public/icons/badge-72.png'));
    expect(badge.width).toBe(72);
    expect(badge.pixel(0, 0)).toHaveLength(3);
  });

  it('rejects data that is not a PNG', () => {
    expect(() => decodePng(Buffer.from('nope'))).toThrow(/PNG/);
  });
});

describe('the figure art', () => {
  const svg = read('src/assets/brand/final-E.svg').toString('utf8');

  it('reads the single path and its translate from the vector source', () => {
    const art = parseFigureArt(svg);
    expect(art.d.startsWith('M0 0 C')).toBe(true);
    expect(art.tx).toBeCloseTo(170.14, 1);
    expect(art.ty).toBeCloseTo(39.01, 1);
  });

  it('rejects an svg without a translated path', () => {
    expect(() => parseFigureArt('<svg><rect/></svg>')).toThrow(/path/);
  });

  it('rounds path data to one decimal and drops trailing zeros', () => {
    expect(roundPathData('M0 0 C3.017110371896905 -0.04 4.0 5.25 Z')).toBe('M0 0 C3 0 4 5.3 Z');
  });

  it('inlines into index.html exactly the art the generator would write (no drift from final-E.svg)', () => {
    const html = read('index.html').toString('utf8');
    const m = html.match(/<!-- brand:splash-art -->\s*([\s\S]*?)\s*<!-- \/brand:splash-art -->/);
    expect(m, 'brand:splash-art markers').not.toBeNull();
    const inline = m?.[1] as string;
    const vb = inline.match(/viewBox="([-\d. ]+)"/)?.[1]?.split(' ').map(Number) as number[];
    expect(vb).toHaveLength(4);
    const [x, y, width, height] = vb as [number, number, number, number];
    expect(inline).toBe(splashArtMarkup(parseFigureArt(svg), { x, y, width, height }));
  });

  it('keeps the inline art small enough to ship in the document', () => {
    const html = read('index.html').toString('utf8');
    expect(html.length).toBeLessThan(24_000);
  });
});

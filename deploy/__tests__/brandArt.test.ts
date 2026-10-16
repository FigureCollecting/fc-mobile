import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ICON_BG,
  ICON_FIGURE_CENTER,
  ICON_RING_RADIUS,
  ICON_SIZES,
  boundsOf,
  figureLayout,
  iconFigureFraction,
  iconFigureScale,
  outlinePoints,
  parseFigureArt,
  ringFitFraction,
  roundPathData,
  splashArtMarkup,
  type Point,
} from '../brandArt';
import { decodePng, encodeRgbPng } from '../png';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string): Buffer => readFileSync(path.join(ROOT, rel));

const art = parseFigureArt(read('src/assets/brand/final-E.svg').toString('utf8'));

/** The icon's figure pixels: each with its coverage (0 = the background, 1 = the figure's colour). */
function figurePixels(size: number): { x: number; y: number; coverage: number }[] {
  const png = decodePng(read(`public/icons/icon-${size}.png`));
  expect([png.width, png.height]).toEqual([size, size]);
  const bg = png.pixel(0, 0);
  expect(`#${bg.map((v) => v.toString(16).padStart(2, '0')).join('')}`).toBe(ICON_BG);
  const out: { x: number; y: number; coverage: number }[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p = png.pixel(x, y);
      const diff = Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]);
      if (diff > 0) out.push({ x, y, coverage: diff / (0xee - 0x14 + 0xec - 0x16 + 0xe6 - 0x1a) });
    }
  }
  return out;
}

describe('the generated app icons', () => {
  it('draws the figure at the largest scale its outline fits inside the 90 % ring, centred like the first icons', () => {
    expect(ICON_RING_RADIUS).toBe(0.45);
    const scale = iconFigureScale(art);
    // Bigger than the 1.4 that fitted the plinth to the 80 % ring.
    expect(scale).toBeGreaterThan(1.4);
    const fraction = iconFigureFraction(scale);
    const outline = outlinePoints(art.d).map(([x, y]): Point => [x + art.tx, y + art.ty]);
    const box = boundsOf(outline);
    const k = fraction / box.height;
    const far = Math.max(
      ...outline.map(([x, y]) =>
        Math.hypot(ICON_FIGURE_CENTER.x + k * (x - box.x - box.width / 2) - 0.5, ICON_FIGURE_CENTER.y + k * (y - box.y - box.height / 2) - 0.5),
      ),
    );
    expect(far).toBeCloseTo(ICON_RING_RADIUS, 6);
  });

  for (const size of ICON_SIZES) {
    it(`${size}px: figure bounding box height is within 2 % of the scale target, centred, on the brand background`, () => {
      let [x0, y0, x1, y1] = [size, size, -1, -1];
      for (const { x, y, coverage } of figurePixels(size)) {
        if (coverage <= 60 / 636) continue;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
      const height = y1 - y0 + 1;
      const target = iconFigureFraction(iconFigureScale(art)) * size;
      expect(Math.abs(height - target) / target).toBeLessThanOrEqual(0.02);
      // Same centre as before: horizontally in the middle, a little below it (the plinth is the heavy end).
      expect(Math.abs((x0 + x1 + 1) / 2 - size / 2)).toBeLessThanOrEqual(size * 0.01);
      expect(Math.abs((y0 + y1 + 1) / 2 / size - 0.5127)).toBeLessThanOrEqual(0.01);
    });

    it(`${size}px: the figure fills the 90 % ring: its farthest opaque pixel from the centre is 0.45 x size, within 1 px`, () => {
      const ring = ICON_RING_RADIUS * size;
      // An opaque pixel: at least half of it the figure. Distances are to the pixel's centre.
      const distances = figurePixels(size)
        .filter((p) => p.coverage >= 0.5)
        .map((p) => Math.hypot(p.x + 0.5 - size / 2, p.y + 0.5 - size / 2));
      const farthest = Math.max(...distances);
      expect(farthest).toBeLessThanOrEqual(ring + 1);
      expect(distances.some((d) => Math.abs(d - ring) <= 1)).toBe(true);
    });
  }
});

describe('the 90 % ring fit', () => {
  it('reads the outline of an absolute M/C/Z path: each move, every curve sampled, ends included', () => {
    const points = outlinePoints('M0 0 C0 10 10 10 10 0 Z M20 20 C20 30 30 30 30 20 Z', 4);
    expect(points).toHaveLength(10);
    expect(points[0]).toEqual([0, 0]);
    // the curve's middle: (0 + 3*0 + 3*10 + 10) / 8, (0 + 3*10 + 3*10 + 0) / 8
    expect(points[2]).toEqual([5, 7.5]);
    expect(points[4]).toEqual([10, 0]);
    expect(points[5]).toEqual([20, 20]);
    expect(boundsOf(points)).toEqual({ x: 0, y: 0, width: 30, height: 27.5 });
  });

  it('rejects a path command it does not read', () => {
    expect(() => outlinePoints('M0 0 L10 10 Z')).toThrow(/L/);
    expect(() => outlinePoints('M0 0 c1 1 2 2 3 3 Z')).toThrow(/c/);
  });

  it("fits a square centred in the icon by its corners: half its diagonal is the ring's radius", () => {
    const square: Point[] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    expect(ringFitFraction(square, { x: 0, y: 0, width: 1, height: 1 }, { x: 0.5, y: 0.5 }, 0.45)).toBeCloseTo(0.9 / Math.SQRT2, 9);
  });

  it('fits a square centred below the middle by its bottom corners', () => {
    const square: Point[] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const f = ringFitFraction(square, { x: 0, y: 0, width: 1, height: 1 }, { x: 0.5, y: 0.6 }, 0.45);
    // a bottom corner at (h, 0.1 + h) from the centre, h = f / 2: 2h^2 + 0.2h + 0.01 = 0.2025
    const h = (-0.2 + Math.sqrt(0.04 + 8 * 0.1925)) / 4;
    expect(f).toBeCloseTo(2 * h, 9);
  });

  it('ignores a point at the centre of the box (it never moves) and refuses a centre outside the ring', () => {
    const pts: Point[] = [[0.5, 0.5], [0, 0], [1, 1]];
    expect(ringFitFraction(pts, { x: 0, y: 0, width: 1, height: 1 }, { x: 0.5, y: 0.5 }, 0.45)).toBeCloseTo(0.9 / Math.SQRT2, 9);
    expect(() => ringFitFraction(pts, { x: 0, y: 0, width: 1, height: 1 }, { x: 0.5, y: 0.96 }, 0.45)).toThrow(/ring/);
  });
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

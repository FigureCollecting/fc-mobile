import { describe, it, expect } from 'vitest';
import { UNZOOMED, clampImageZoom, containBox, imageZoomTransform, panImageZoom, pinchImageZoom, zoomAtPoint } from '../imageZoom';

const SQUARE = { width: 400, height: 400 };
const PORTRAIT = { width: 600, height: 900 };
const LANDSCAPE = { width: 1200, height: 600 };

/** Where the picture's point under the frame point p at 1x shows under zoom z. */
const shown = (z: { k: number; x: number; y: number }, p: { x: number; y: number }) => ({ x: p.x * z.k + z.x, y: p.y * z.k + z.y });

describe('containBox: the picture as object-fit: contain lays it in the frame', () => {
  it('a portrait picture in a square frame: full height, centred across', () => {
    const box = containBox(SQUARE, PORTRAIT);
    expect(box.height).toBeCloseTo(400);
    expect(box.width).toBeCloseTo(266.667, 2);
    expect(box.x).toBeCloseTo(66.667, 2);
    expect(box.y).toBe(0);
  });

  it('a landscape picture in a portrait frame: full width, centred down', () => {
    const box = containBox({ width: 400, height: 800 }, LANDSCAPE);
    expect(box).toEqual({ x: 0, y: 300, width: 400, height: 200 });
  });

  it('a picture of no known size fills the frame', () => {
    expect(containBox(SQUARE, { width: 0, height: 0 })).toEqual({ x: 0, y: 0, ...SQUARE });
  });
});

describe('clampImageZoom: within 1x to 4x, and never a bar the picture could cover', () => {
  it('1x is always the picture as laid out', () => {
    expect(clampImageZoom({ k: 0.5, x: 30, y: -10 }, SQUARE, PORTRAIT)).toEqual(UNZOOMED);
  });

  it('at most 4x', () => {
    expect(clampImageZoom({ k: 9, x: 0, y: 0 }, SQUARE, SQUARE).k).toBe(4);
  });

  it('zoomed, the picture is held so it fills the frame along an axis it is longer on, centred along one it is shorter on', () => {
    // landscape in a portrait frame at 2x: 800 x 400 across a 400 x 800 frame
    const z = clampImageZoom({ k: 2, x: 500, y: 500 }, { width: 400, height: 800 }, LANDSCAPE);
    const box = containBox({ width: 400, height: 800 }, LANDSCAPE);
    const left = box.x * z.k + z.x;
    const top = box.y * z.k + z.y;
    expect(left).toBe(0);
    // 400 tall in an 800 frame: centred, 200 above and below
    expect(top).toBe(200);
  });
});

describe('zoomAtPoint: a double-tap at a point zooms there', () => {
  it('the picture point under the tap stays under it', () => {
    const p = { x: 180, y: 150 };
    const z = zoomAtPoint(UNZOOMED, p, 2, SQUARE, SQUARE);
    expect(z.k).toBe(2);
    expect(shown(z, p).x).toBeCloseTo(p.x);
    expect(shown(z, p).y).toBeCloseTo(p.y);
  });

  it('a tap near a letterboxed picture\'s edge is held: no bar opens where the picture could cover it', () => {
    // 1200 x 600 in a square: 400 x 200 at y = 100; at 2x it is exactly the frame's height, so it stands at its top
    const z = zoomAtPoint(UNZOOMED, { x: 200, y: 110 }, 2, SQUARE, LANDSCAPE);
    expect(z).toEqual({ k: 2, x: -200, y: -200 });
  });
});

describe('pinchImageZoom and panImageZoom', () => {
  it('fingers twice as far apart double the zoom about their midpoint', () => {
    const z = pinchImageZoom(UNZOOMED, { x: 150, y: 200 }, { x: 250, y: 200 }, { x: 100, y: 200 }, { x: 300, y: 200 }, SQUARE, SQUARE);
    expect(z.k).toBeCloseTo(2);
    expect(shown(z, { x: 200, y: 200 }).x).toBeCloseTo(200);
  });

  it('two fingers at one point change nothing', () => {
    const p = { x: 10, y: 10 };
    expect(pinchImageZoom(UNZOOMED, p, p, p, p, SQUARE, SQUARE)).toBe(UNZOOMED);
  });

  it('while the fingers are down a pinch may go under 1x, to 0.8x at the least', () => {
    const z = pinchImageZoom(UNZOOMED, { x: 100, y: 200 }, { x: 300, y: 200 }, { x: 199, y: 200 }, { x: 201, y: 200 }, SQUARE, SQUARE);
    expect(z.k).toBeCloseTo(0.8);
  });

  it('one finger pans a zoomed picture, up to its edges', () => {
    const z = panImageZoom({ k: 2, x: -200, y: -200 }, 500, -50, SQUARE, SQUARE);
    expect(z).toEqual({ k: 2, x: 0, y: -250 });
  });
});

describe('imageZoomTransform', () => {
  it('none at 1x; a translate and a scale about the top-left otherwise', () => {
    expect(imageZoomTransform(UNZOOMED)).toBe('');
    expect(imageZoomTransform({ k: 2, x: -10, y: -20 })).toBe('translate(-10px, -20px) scale(2)');
  });
});

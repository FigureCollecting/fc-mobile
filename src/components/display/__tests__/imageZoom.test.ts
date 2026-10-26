import { describe, it, expect } from 'vitest';
import { FACE_ANCHOR, UNZOOMED, anchorOffset, clampImageZoom, containBox, faceZoom, imageZoomTransform, panImageZoom, pinchImageZoom, zoomAtPoint, zoomToPoint } from '../imageZoom';

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

// CARD-VIEW-1 part 2 (Ross 10-25: "should favor zooming card view towards 1/3 from top and midpoint horizontally of image")
describe('the face anchor: the first zoom step centres half across and a third down the PICTURE, held so it still fills the frame', () => {
  const FRAME = { width: 400, height: 600 };
  /** Where the picture's anchor shows, for a zoomed picture `size` whose top-left is at `at`. */
  const anchorAt = (at: { x: number; y: number }, size: { width: number; height: number }) => ({ x: at.x + size.width * FACE_ANCHOR.x, y: at.y + size.height * FACE_ANCHOR.y });

  it('is half across and a third down', () => {
    expect(FACE_ANCHOR).toEqual({ x: 0.5, y: 1 / 3 });
  });

  it('portrait: the face stands in the middle of the frame', () => {
    const size = { width: 800, height: 1200 };
    const at = anchorOffset(FRAME, size);
    expect(at).toEqual({ x: -200, y: -100 });
    expect(anchorAt(at, size)).toEqual({ x: 200, y: 300 });
  });

  it('landscape: across, the face in the middle; down, the picture held at its top, where the face cannot come to the middle without a bar', () => {
    const size = { width: 1600, height: 800 };
    const at = anchorOffset(FRAME, size);
    expect(at.x).toBe(-600);
    expect(at.y).toBe(0);
    expect(anchorAt(at, size).x).toBe(200);
  });

  it('a tiny picture, still smaller than the frame zoomed: centred, never pushed to the face', () => {
    expect(anchorOffset(FRAME, { width: 100, height: 150 })).toEqual({ x: 150, y: 225 });
  });

  it('held at the bottom as well as the top: a face anchor low on a picture just taller than the frame never opens a bar below it', () => {
    expect(anchorOffset(FRAME, { width: 400, height: 640 }, { x: 0.5, y: 0.95 }).y).toBe(-40);
  });

  it('letterboxed: the anchor is the picture\'s, not the frame\'s (a square picture in a tall frame, at 3x)', () => {
    // 600 x 600 in 400 x 800: laid out 400 x 400 at y = 200; at 3x 1200 x 1200
    const tall = { width: 400, height: 800 };
    const z = faceZoom(tall, { width: 600, height: 600 }, 3);
    const box = containBox(tall, { width: 600, height: 600 });
    // the picture's own third, not the frame's third (y = 266.7, inside the bar above it), stands in the middle
    expect((box.y + box.height / 3) * z.k + z.y).toBeCloseTo(400);
    expect((box.x + box.width / 2) * z.k + z.x).toBeCloseTo(200);
    expect(z).toEqual({ k: 3, x: -400, y: -600 });
  });

  it('letterboxed portrait in a square frame (the figure page), at 2x: the face in the middle', () => {
    const z = faceZoom(SQUARE, PORTRAIT, 2);
    expect(z.k).toBe(2);
    expect(z.x).toBeCloseTo(-200);
    expect(z.y).toBeCloseTo(-66.667, 2);
    const box = containBox(SQUARE, PORTRAIT);
    expect((box.x + box.width / 2) * 2 + z.x).toBeCloseTo(200);
    expect((box.y + box.height / 3) * 2 + z.y).toBeCloseTo(200);
  });

  it('letterboxed landscape in a square frame: the picture fills across and is centred down (it is the frame\'s height at 2x)', () => {
    expect(faceZoom(SQUARE, LANDSCAPE, 2)).toEqual({ k: 2, x: -200, y: -200 });
  });

  it('agrees with the clamp: a face zoom is already held to the frame', () => {
    for (const natural of [PORTRAIT, LANDSCAPE, SQUARE, { width: 50, height: 400 }]) {
      const z = faceZoom(SQUARE, natural, 2);
      const held = clampImageZoom(z, SQUARE, natural);
      expect(held.x).toBeCloseTo(z.x);
      expect(held.y).toBeCloseTo(z.y);
    }
  });
});

describe('zoomToPoint: the still point that takes a zoom from one pan to another (PhotoSwipe\'s zoomTo keeps one point still)', () => {
  it('a zoom from 1x at pan (10, 20) to 2x landing at (-100, -50) keeps (120, 90) still', () => {
    const p = zoomToPoint({ x: 10, y: 20 }, { x: -100, y: -50 }, 1, 2)!;
    expect(p).toEqual({ x: 120, y: 90 });
    // PhotoSwipe's own formula lands it there: (pan - p) * k2 / k1 + p
    expect((10 - p.x) * 2 + p.x).toBe(-100);
    expect((20 - p.y) * 2 + p.y).toBe(-50);
  });

  it('no zoom step (the same level), no point', () => {
    expect(zoomToPoint({ x: 0, y: 0 }, { x: 5, y: 5 }, 2, 2)).toBeNull();
  });
});

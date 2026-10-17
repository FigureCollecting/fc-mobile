import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  UNZOOMED,
  ZOOM_DOUBLE_TAP,
  ZOOM_MAX,
  ZOOM_SNAP,
  ZOOM_UNDER,
  clampZoom,
  easeOut,
  glideZoom,
  isZoomed,
  panZoom,
  pinchZoom,
  settleZoom,
  toPicture,
  toScreen,
  zoomAt,
  zoomTransform,
  type Zoom,
} from '../caseZoom';

/** The Fold8 cover's case frame (CSS px). */
const COVER = { width: 444, height: 520 };

const coord = (max: number) => fc.double({ min: 0, max, noNaN: true });
const point = fc.record({ x: coord(COVER.width), y: coord(COVER.height) });
const zoom: fc.Arbitrary<Zoom> = fc
  .double({ min: 1, max: ZOOM_MAX, noNaN: true })
  .chain((k) =>
    fc.record({
      k: fc.constant(k),
      x: fc.double({ min: COVER.width * (1 - k), max: 0, noNaN: true }),
      y: fc.double({ min: COVER.height * (1 - k), max: 0, noNaN: true }),
    }),
  );

/** The picture covers the frame: its edges never come inside it. */
function covers(z: Zoom) {
  const tl = toScreen(z, { x: 0, y: 0 });
  const br = toScreen(z, { x: COVER.width, y: COVER.height });
  expect(tl.x).toBeLessThanOrEqual(1e-9);
  expect(tl.y).toBeLessThanOrEqual(1e-9);
  expect(br.x).toBeGreaterThanOrEqual(COVER.width - 1e-9);
  expect(br.y).toBeGreaterThanOrEqual(COVER.height - 1e-9);
}

describe('caseZoom: the picture and the screen (PINCH-1)', () => {
  it('1x is the picture as the camera draws it: no transform, nothing moved', () => {
    expect(isZoomed(UNZOOMED)).toBe(false);
    expect(zoomTransform(UNZOOMED)).toBe('');
    expect(toScreen(UNZOOMED, { x: 120, y: 40 })).toEqual({ x: 120, y: 40 });
  });

  it('one 2D transform on one layer, scaled from its top-left: translate then scale', () => {
    expect(zoomTransform({ k: 2, x: -100, y: -50.5 })).toBe('translate(-100px, -50.5px) scale(2)');
    expect(isZoomed({ k: 2, x: -100, y: -50.5 })).toBe(true);
  });

  it('a tap where the zoom shows a figure lands on that figure in the unzoomed picture (the hit-test coordinates)', () => {
    // a figure's tap box in the picture, and the same box on screen at 3x
    const box = { x0: 200, y0: 300, x1: 240, y1: 380 };
    const z: Zoom = { k: 3, x: -500, y: -800 };
    const a = toScreen(z, { x: box.x0, y: box.y0 });
    const b = toScreen(z, { x: box.x1, y: box.y1 });
    expect(b.x - a.x).toBeCloseTo(120, 9);
    expect(b.y - a.y).toBeCloseTo(240, 9);
    const hit = toPicture(z, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    expect(hit.x).toBeCloseTo(220, 9);
    expect(hit.y).toBeCloseTo(340, 9);
    // a tap just outside the box on screen falls outside it in the picture
    const miss = toPicture(z, { x: b.x + 2, y: b.y - 1 });
    expect(miss.x).toBeGreaterThan(box.x1);
  });

  it('toPicture inverts toScreen at any zoom', () => {
    fc.assert(
      fc.property(zoom, point, (z, p) => {
        const back = toScreen(z, toPicture(z, p));
        expect(back.x).toBeCloseTo(p.x, 6);
        expect(back.y).toBeCloseTo(p.y, 6);
      }),
    );
  });
});

describe('caseZoom: the pinch', () => {
  it('zooms around the midpoint between the fingers: the point under it stays under it', () => {
    const a0 = { x: 180, y: 260 };
    const b0 = { x: 260, y: 260 };
    // the fingers spread to twice their distance about the same midpoint (220, 260)
    const z = pinchZoom(UNZOOMED, a0, b0, { x: 140, y: 260 }, { x: 300, y: 260 }, COVER);
    expect(z.k).toBeCloseTo(2, 9);
    const under = toScreen(z, { x: 220, y: 260 });
    expect(under.x).toBeCloseTo(220, 9);
    expect(under.y).toBeCloseTo(260, 9);
  });

  it('the picture point first under the fingers follows their midpoint when they move together (the focal point stays under the fingers)', () => {
    fc.assert(
      fc.property(
        zoom,
        point,
        fc.double({ min: 20, max: 120, noNaN: true }),
        fc.double({ min: 0.8, max: 1.5, noNaN: true }),
        fc.double({ min: -30, max: 30, noNaN: true }),
        fc.double({ min: -30, max: 30, noNaN: true }),
        (start, m0, half, spread, dx, dy) => {
          const a0 = { x: m0.x - half, y: m0.y };
          const b0 = { x: m0.x + half, y: m0.y };
          const m1 = { x: m0.x + dx, y: m0.y + dy };
          const a1 = { x: m1.x - half * spread, y: m1.y };
          const b1 = { x: m1.x + half * spread, y: m1.y };
          const z = pinchZoom(start, a0, b0, a1, b1, COVER);
          const k = start.k * spread;
          const q = toPicture(start, m0);
          if (k >= 1 && k <= ZOOM_MAX) {
            // unless a bound stops it, the picture point stays under the midpoint
            const free = { k, x: m1.x - q.x * k, y: m1.y - q.y * k };
            const bounded = clampZoom(free, COVER);
            if (Math.abs(bounded.x - free.x) < 1e-9 && Math.abs(bounded.y - free.y) < 1e-9) {
              const under = toScreen(z, q);
              expect(under.x).toBeCloseTo(m1.x, 6);
              expect(under.y).toBeCloseTo(m1.y, 6);
            }
          }
          expect(z.k).toBeGreaterThanOrEqual(ZOOM_UNDER);
          expect(z.k).toBeLessThanOrEqual(ZOOM_MAX);
        },
      ),
    );
  });

  it(`stops at about ${ZOOM_MAX}x however far the fingers spread`, () => {
    const z = pinchZoom(UNZOOMED, { x: 210, y: 250 }, { x: 230, y: 250 }, { x: 10, y: 250 }, { x: 430, y: 250 }, COVER);
    expect(z.k).toBe(ZOOM_MAX);
    covers(z);
  });

  it(`may go under 1x while the fingers are down, no further than ${ZOOM_UNDER}x, and stays inside the frame`, () => {
    const z = pinchZoom(UNZOOMED, { x: 20, y: 250 }, { x: 420, y: 250 }, { x: 200, y: 250 }, { x: 240, y: 250 }, COVER);
    expect(z.k).toBe(ZOOM_UNDER);
    const tl = toScreen(z, { x: 0, y: 0 });
    const br = toScreen(z, { x: COVER.width, y: COVER.height });
    expect(tl.x).toBeGreaterThanOrEqual(0);
    expect(tl.y).toBeGreaterThanOrEqual(0);
    expect(br.x).toBeLessThanOrEqual(COVER.width);
    expect(br.y).toBeLessThanOrEqual(COVER.height);
  });

  it('fingers on one spot (no distance between them) leave the zoom as it was', () => {
    const start: Zoom = { k: 2, x: -100, y: -100 };
    const z = pinchZoom(start, { x: 100, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 100 }, COVER);
    expect(z).toEqual(start);
  });
});

describe('caseZoom: bounds, settling and the quick way back', () => {
  it('at 1x and over, the picture never pans past its edges', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: ZOOM_MAX, noNaN: true }),
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        (k, x, y) => covers(clampZoom({ k, x, y }, COVER)),
      ),
    );
    expect(clampZoom({ k: 9, x: 0, y: 0 }, COVER).k).toBe(ZOOM_MAX);
    expect(clampZoom({ k: 0.5, x: 0, y: 0 }, COVER).k).toBe(1);
  });

  it('one finger pans the magnified picture, up to its edges', () => {
    const z: Zoom = { k: 2, x: -200, y: -260 };
    expect(panZoom(z, 50, -40, COVER)).toEqual({ k: 2, x: -150, y: -300 });
    // far right and down: the picture's top-left corner stops at the frame's
    expect(panZoom(z, 900, 900, COVER)).toEqual({ k: 2, x: 0, y: 0 });
    // far left and up: its bottom-right corner stops at the frame's
    const end = panZoom(z, -900, -900, COVER);
    expect(end).toEqual({ k: 2, x: -COVER.width, y: -COVER.height });
    // at 1x there is nothing to pan
    expect(panZoom(UNZOOMED, 80, 30, COVER)).toEqual(UNZOOMED);
  });

  it('a pinch let go under 1x, or so near it that the picture looks normal, settles at exactly 1x', () => {
    expect(settleZoom({ k: 0.85, x: 30, y: 20 }, COVER)).toEqual(UNZOOMED);
    expect(settleZoom({ k: 1, x: 0, y: 0 }, COVER)).toEqual(UNZOOMED);
    expect(settleZoom({ k: ZOOM_SNAP - 0.01, x: -2, y: -3 }, COVER)).toEqual(UNZOOMED);
    expect(settleZoom({ k: 2.5, x: -300, y: -400 }, COVER)).toEqual({ k: 2.5, x: -300, y: -400 });
    // and within the edges
    expect(settleZoom({ k: 2, x: 40, y: -9000 }, COVER)).toEqual({ k: 2, x: 0, y: -COVER.height });
  });

  it(`a double-tap at 1x zooms ${ZOOM_DOUBLE_TAP}x at the tapped point, bounded by the edges`, () => {
    const z = zoomAt(UNZOOMED, { x: 222, y: 260 }, ZOOM_DOUBLE_TAP, COVER);
    expect(z.k).toBe(ZOOM_DOUBLE_TAP);
    const under = toScreen(z, { x: 222, y: 260 });
    expect(under.x).toBeCloseTo(222, 9);
    expect(under.y).toBeCloseTo(260, 9);
    // a point past the frame (the open panel's side bands): the edges hold, the picture never pulls inside the frame
    expect(zoomAt(UNZOOMED, { x: -30, y: 600 }, ZOOM_DOUBLE_TAP, COVER)).toEqual({ k: 2, x: 0, y: -COVER.height });
  });
  it('ease-out (the curve the way back had as a CSS transition) starts at 0, ends at 1, never goes back and is quick at first', () => {
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    expect(easeOut(-0.5)).toBe(0);
    expect(easeOut(1.5)).toBe(1);
    let last = 0;
    for (let t = 0.05; t <= 1; t += 0.05) {
      const e = easeOut(t);
      expect(e).toBeGreaterThanOrEqual(last);
      last = e;
    }
    // CSS cubic-bezier(0, 0, 0.58, 1), its x solved for t by bisection outside this module
    expect(easeOut(0.25)).toBeCloseTo(0.3781, 3);
    expect(easeOut(0.5)).toBeCloseTo(0.6846, 3);
    expect(easeOut(0.75)).toBeCloseTo(0.9065, 3);
  });

  it('a glide moves the zoom from where it stands to where it settles, k and the offsets alike, ending exactly there', () => {
    const from: Zoom = { k: 4, x: -900, y: -600 };
    expect(glideZoom(from, UNZOOMED, 0)).toEqual(from);
    expect(glideZoom(from, UNZOOMED, 1)).toEqual(UNZOOMED);
    const half = glideZoom(from, UNZOOMED, 0.5);
    const e = easeOut(0.5);
    expect(half.k).toBeCloseTo(4 + (1 - 4) * e, 9);
    expect(half.x).toBeCloseTo(-900 * (1 - e), 9);
    expect(half.y).toBeCloseTo(-600 * (1 - e), 9);
    // and the other way: a double-tap's 1x to 2x
    expect(glideZoom(UNZOOMED, { k: 2, x: -220, y: -260 }, 1)).toEqual({ k: 2, x: -220, y: -260 });
  });
});

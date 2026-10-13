import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { IKEA_KLINGSBO } from '../cabinetPresets';
import { lensFocalPx, project, type Camera, type Vec3 } from '../caseCamera';
import { frameCase, wallPages, type FramingInput } from '../caseFraming';
import { wallLayout } from '../packCabinets';
import {
  CABINET_HYSTERESIS,
  CULL_MARGIN,
  MAX_DRAWN_CABINETS,
  NEAR_MM,
  RECULL_SHARE,
  cullRect,
  hiddenUnder,
  nearestCabinets,
  stickyView,
  texelScale,
  trimFace,
  type CullView,
} from '../caseCull';

const COVER = { width: 443, height: 344 };
const OPEN = { width: 870, height: 261 };
const WALL = wallLayout(Array.from({ length: 100 }, () => IKEA_KLINGSBO));

function framing(frame = COVER, focus = 10, view: FramingInput['view'] = 'wall') {
  return frameCase({ frame, wall: WALL, headroomMm: WALL.cabinets.map(() => 300), view, focus, shelf: 0 });
}
const viewOf = (camera: Camera, panPx = 0): CullView => ({ camera, panPx });
const at = (a: Vec3, u: Vec3, v: Vec3, s: number, t: number): Vec3 => [a[0] + s * u[0] + t * v[0], a[1] + s * u[1] + t * v[1], a[2] + s * u[2] + t * v[2]];
const screen = (view: CullView, p: Vec3) => {
  const q = project(view.camera, p);
  return { x: q.x + view.panPx, y: q.y, depth: q.depth };
};

describe('cullRect: the frame and half a viewport round it', () => {
  it('reaches half the frame past each edge', () => {
    expect(CULL_MARGIN).toBe(0.5);
    expect(cullRect(COVER)).toEqual({ x0: -221.5, x1: 664.5, y0: -172, y1: 516 });
  });
});

describe('trimFace: the part of a face that draws in the frame and its margin', () => {
  const view = viewOf(framing().camera);
  const rect = cullRect(COVER);

  it('a face wholly inside is drawn whole', () => {
    const slot = WALL.cabinets[10];
    expect(trimFace(view, [slot.leftMm, 1000, 0], [slot.rightMm - slot.leftMm, 0, 0], [0, -500, 0], rect)).toEqual({ s0: 0, s1: 1, t0: 0, t1: 1 });
  });

  it('a face wholly past the margin is not drawn', () => {
    const slot = WALL.cabinets[40];
    expect(trimFace(view, [slot.leftMm, 1000, 0], [slot.rightMm - slot.leftMm, 0, 0], [0, -500, 0], rect)).toBeNull();
  });

  it('the room wall, 100 m long, is cut to the stretch the frame and its margin see, and reaches both edges', () => {
    const a: Vec3 = [-6000, 3200, -850];
    const u: Vec3 = [WALL.rightMm + 12000, 0, 0];
    const v: Vec3 = [0, -3200, 0];
    const t = trimFace(view, a, u, v, rect)!;
    expect(t.s1 - t.s0).toBeLessThan(0.05);
    const left = screen(view, at(a, u, v, t.s0, 0.5)).x;
    const right = screen(view, at(a, u, v, t.s1, 0.5)).x;
    expect(Math.min(left, right)).toBeCloseTo(rect.x0, 3);
    expect(Math.max(left, right)).toBeCloseTo(rect.x1, 3);
  });

  it('the room floor, reaching past the camera, stops at the near plane in front of it', () => {
    const a: Vec3 = [-6000, 0, -850];
    const u: Vec3 = [WALL.rightMm + 12000, 0, 0];
    const v: Vec3 = [0, 0, 20_000];
    const t = trimFace(view, a, u, v, rect)!;
    expect(t).not.toBeNull();
    for (const s of [t.s0, t.s1]) for (const tt of [t.t0, t.t1]) expect(screen(view, at(a, u, v, s, tt)).depth).toBeGreaterThanOrEqual(NEAR_MM - 1e-6);
  });

  it('a pan shifts what is seen: a face the slid picture brings in is drawn', () => {
    const slot = WALL.cabinets[14];
    const face: [Vec3, Vec3, Vec3] = [[slot.leftMm, 1000, 0], [slot.rightMm - slot.leftMm, 0, 0], [0, -500, 0]];
    const camera = framing().camera;
    const shift = screen(viewOf(camera), [slot.centerMm, 1000, 0]).x;
    expect(trimFace(viewOf(camera), ...face, rect)).toBeNull();
    expect(trimFace(viewOf(camera, -shift + COVER.width / 2), ...face, rect)).toEqual({ s0: 0, s1: 1, t0: 0, t1: 1 });
  });

  it('never loses a point that draws inside the rect, and every corner of the cut draws inside it', () => {
    fc.assert(
      fc.property(
        fc.tuple(fc.double({ min: -3000, max: 8000, noNaN: true }), fc.double({ min: -500, max: 3000, noNaN: true }), fc.double({ min: -1500, max: 3000, noNaN: true })),
        fc.tuple(fc.double({ min: -9000, max: 9000, noNaN: true }), fc.double({ min: -3000, max: 3000, noNaN: true }), fc.double({ min: -9000, max: 9000, noNaN: true })),
        fc.tuple(fc.double({ min: -9000, max: 9000, noNaN: true }), fc.double({ min: -3000, max: 3000, noNaN: true }), fc.double({ min: -9000, max: 9000, noNaN: true })),
        (a, u, v) => {
          const t = trimFace(view, a, u, v, rect);
          for (let i = 0; i <= 8; i++) {
            for (let j = 0; j <= 8; j++) {
              const p = screen(view, at(a, u, v, i / 8, j / 8));
              const shows = p.depth >= NEAR_MM && p.x >= rect.x0 && p.x <= rect.x1 && p.y >= rect.y0 && p.y <= rect.y1;
              if (!shows) continue;
              expect(t).not.toBeNull();
              expect(i / 8).toBeGreaterThanOrEqual(t!.s0 - 1e-6);
              expect(i / 8).toBeLessThanOrEqual(t!.s1 + 1e-6);
              expect(j / 8).toBeGreaterThanOrEqual(t!.t0 - 1e-6);
              expect(j / 8).toBeLessThanOrEqual(t!.t1 + 1e-6);
            }
          }
          if (t) {
            expect(t.s0).toBeGreaterThanOrEqual(0);
            expect(t.s1).toBeLessThanOrEqual(1);
            expect(t.t0).toBeGreaterThanOrEqual(0);
            expect(t.t1).toBeLessThanOrEqual(1);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe(`nearestCabinets: at most ${MAX_DRAWN_CABINETS} drawn, nearest the frame centre, steady against small moves`, () => {
  it('a long wall on the open panel: the five whose middles draw nearest the frame centre', () => {
    const camera = framing(OPEN, 10).camera;
    const got = nearestCabinets(viewOf(camera), WALL, []);
    expect(got).toHaveLength(MAX_DRAWN_CABINETS);
    const dist = (i: number) => Math.abs(screen(viewOf(camera), [WALL.cabinets[i].centerMm, IKEA_KLINGSBO.outer.heightMm / 2, 0]).x - OPEN.width / 2);
    const rest = WALL.cabinets.map((_, i) => i).filter((i) => !got.includes(i));
    expect(Math.max(...got.map(dist))).toBeLessThanOrEqual(Math.min(...rest.map(dist)));
    expect(got).toEqual([...got].sort((x, y) => x - y));
  });

  it('a wall of three draws all three', () => {
    const wall = wallLayout([IKEA_KLINGSBO, IKEA_KLINGSBO, IKEA_KLINGSBO]);
    expect(nearestCabinets(viewOf(framing().camera), wall, [])).toEqual([0, 1, 2]);
  });

  it('a cabinet already drawn keeps its place until another is nearer the centre by a quarter of the frame', () => {
    expect(CABINET_HYSTERESIS).toBe(0.25);
    const camera = framing(OPEN, 10).camera;
    const fresh = nearestCabinets(viewOf(camera), WALL, []);
    // walk the camera along the wall so the rightmost not drawn comes nearer than the leftmost drawn, by a little
    const step = (WALL.cabinets[1].centerMm - WALL.cabinets[0].centerMm) * 0.6;
    const little = { ...camera, x: camera.x + step };
    const kept = nearestCabinets(viewOf(little), WALL, fresh);
    expect(kept).toEqual(fresh);
    expect(nearestCabinets(viewOf(little), WALL, [])).not.toEqual(fresh);
    // and a walk of a few cabinets replaces it
    const far = { ...camera, x: camera.x + step * 6 };
    expect(nearestCabinets(viewOf(far), WALL, fresh)).toEqual(nearestCabinets(viewOf(far), WALL, []));
  });

  it('a cabinet behind the camera is never chosen over one in front', () => {
    const camera = { ...framing().camera, z: -1000 };
    expect(nearestCabinets(viewOf(camera), wallLayout([IKEA_KLINGSBO]), [])).toEqual([0]);
  });
});

describe('stickyView: re-cull on a camera change, not on every small move', () => {
  const camera = framing().camera;
  const view = viewOf(camera);

  it('the first view is taken as it is', () => {
    expect(stickyView(null, view)).toBe(view);
  });

  it(`keeps the culled view while the picture has moved less than ${RECULL_SHARE * 100} % of the frame width, by a pan or a walk`, () => {
    expect(RECULL_SHARE).toBe(0.25);
    const smallPan = viewOf(camera, -0.2 * COVER.width);
    expect(stickyView(view, smallPan)).toBe(view);
    const perPx = (camera.z - 0) / camera.focalPx;
    const smallWalk = viewOf({ ...camera, x: camera.x + 0.2 * COVER.width * perPx * 0.9 });
    expect(stickyView(view, smallWalk)).toBe(view);
  });

  it('takes the new view once the picture moved farther, or anything but the camera x and the pan changed', () => {
    const bigPan = viewOf(camera, -0.3 * COVER.width);
    expect(stickyView(view, bigPan)).toBe(bigPan);
    const perPx = (camera.z - 0) / camera.focalPx;
    const bigWalk = viewOf({ ...camera, x: camera.x + 0.4 * COVER.width * perPx });
    expect(stickyView(view, bigWalk)).toBe(bigWalk);
    for (const patch of [{ z: camera.z + 1 }, { y: camera.y + 1 }, { pitch: camera.pitch + 0.01 }, { focalPx: camera.focalPx + 1 }, { frame: OPEN }]) {
      const next = viewOf({ ...camera, ...patch });
      expect(stickyView(view, next)).toBe(next);
    }
  });

  it('takes the new view when the old one looked at nothing on the cabinets front', () => {
    const away = viewOf({ ...camera, pitch: -Math.PI / 2 });
    const next = viewOf({ ...away.camera, x: away.camera.x + 1 });
    expect(stickyView(away, next)).toBe(next);
  });
});

describe('texelScale: faces drawn at the px per mm the screen shows them, never coarser', () => {
  const span = { y0: 0, y1: 2100, z0: -400, z1: 50 };
  const nearest = (camera: Camera) => {
    const sin = Math.sin(camera.pitch);
    const cos = Math.cos(camera.pitch);
    const depths = [span.y0, span.y1].flatMap((y) => [span.z0, span.z1].map((z) => (camera.y - y) * sin + (camera.z - z) * cos));
    return camera.focalPx / Math.min(...depths);
  };

  it.each([
    ['wall, cover', framing(COVER)],
    ['wall, open', framing(OPEN)],
    ['cabinet, cover', framing(COVER, 10, 'cabinet')],
    ['shelf, open', framing(OPEN, 10, 'shelf')],
  ])('%s: at least what the nearest point shows, under 1.42 times it, at most 1 px per mm', (_, f) => {
    const s = texelScale(f.camera, span);
    const need = nearest(f.camera);
    expect(s).toBeLessThanOrEqual(1);
    expect(s).toBeGreaterThanOrEqual(Math.min(1, need) - 1e-9);
    if (need < 1 / Math.SQRT2) expect(s).toBeLessThan(need * Math.SQRT2 + 1e-9);
  });

  it('steps by half octaves, so a camera walking the wall keeps it', () => {
    const f = framing(COVER);
    const s = texelScale(f.camera, span);
    expect(Math.log2(s) * 2).toBeCloseTo(Math.round(Math.log2(s) * 2), 9);
    expect(texelScale({ ...f.camera, x: f.camera.x + 20_000 }, span)).toBe(s);
  });

  it('a camera nearer than 1 mm per px draws at 1 px per mm, and one far back at no less than 1/64', () => {
    const f = framing(COVER, 10, 'shelf');
    expect(texelScale({ ...f.camera, z: 100 }, span)).toBe(1);
    expect(texelScale({ ...f.camera, z: 1e7 }, span)).toBe(1 / 64);
  });

  it('the camera focal length is the lens on the frame', () => {
    expect(framing(COVER).camera.focalPx).toBeCloseTo(lensFocalPx(COVER), 9);
  });
});

describe('hiddenUnder: a figure wholly behind an opaque board, from where the camera stands', () => {
  const board = { x0: 0, x1: 800, y0: 980, y1: 1000, z0: -400, z1: 0 };
  const figure = (x0: number, x1: number, y0: number, y1: number, z: number): Vec3[] => [
    [x0, y0, z],
    [x1, y0, z],
    [x0, y1, z],
    [x1, y1, z],
  ];
  const above: Camera = { x: 400, y: 1600, z: 300, pitch: 0.6, focalPx: 400, frame: COVER };

  it('a figure under the board, every ray to it through the board: hidden', () => {
    expect(hiddenUnder(above, figure(300, 500, 700, 900, -300), board)).toBe(true);
  });

  it('a figure under the board whose foot shows past its front edge: drawn', () => {
    expect(hiddenUnder(above, figure(300, 500, 300, 900, -100), board)).toBe(false);
  });

  it('a camera level with the shelf sees under the board: drawn', () => {
    expect(hiddenUnder({ ...above, y: 800, pitch: 0 }, figure(300, 500, 700, 900, -300), board)).toBe(false);
  });

  it('a figure standing on the board, above it: drawn', () => {
    expect(hiddenUnder(above, figure(300, 500, 1000, 1200, -300), board)).toBe(false);
  });

  it('a camera under the board looking up at a figure above it: hidden', () => {
    expect(hiddenUnder({ ...above, y: 400, pitch: -0.6 }, figure(300, 500, 1100, 1200, -300), board)).toBe(true);
  });

  it('a figure beside the board, its rays past the side: drawn', () => {
    expect(hiddenUnder(above, figure(900, 1100, 700, 900, -300), board)).toBe(false);
  });
});

describe(`wallPages: a page holds at most ${MAX_DRAWN_CABINETS} cabinets, the most drawn at a time`, () => {
  it('the open panel pages a long wall five at a time', () => {
    const pages = wallPages({ frame: OPEN, wall: WALL, headroomMm: WALL.cabinets.map(() => 300), view: 'wall', focus: 0, shelf: 0 });
    expect(Math.max(...pages.map((p) => p.length))).toBe(MAX_DRAWN_CABINETS);
    expect(pages.flat()).toEqual(WALL.cabinets.map((_, i) => i));
  });
});

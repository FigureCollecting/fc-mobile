import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { IKEA_KLINGSBO } from '../cabinetPresets';
import { castRay, lensFocalPx, project, rayHitPlane, type Camera } from '../caseCamera';
import { frameCase } from '../caseFraming';
import { wallLayout } from '../packCabinets';
import {
  CULL_MARGIN,
  NEAR_MM,
  RECULL_SHARE,
  byFrameCentre,
  cullRect,
  faceInView,
  frustum,
  nearestCabinets,
  stickyPose,
  texelScale,
  trimFace,
  type CullView,
  type FigureBox,
} from '../caseCull';

// NAV-1A (rulings S3): the cull under a turned camera. Today's frustum is pitch only; with the yaw it builds the same five
// planes from the turned axes, and every caller (trimFace, nearestCabinets, byFrameCentre, figureScales) follows.

const DEG = Math.PI / 180;
const OPEN = { width: 870, height: 475 };
const WALL = wallLayout(Array.from({ length: 40 }, () => IKEA_KLINGSBO));
const F = lensFocalPx(OPEN);
const level = (patch: Partial<Camera> = {}): Camera => ({ x: WALL.cabinets[20].centerMm, y: 1000, z: 2500, pitch: 0, yaw: 0, focalPx: F, frame: OPEN, ...patch });
const viewOf = (camera: Camera): CullView => ({ camera, panPx: 0 });

const yawed = fc.record({
  x: fc.double({ min: -5000, max: 5000, noNaN: true }),
  y: fc.double({ min: 300, max: 2400, noNaN: true }),
  z: fc.double({ min: 200, max: 6000, noNaN: true }),
  yaw: fc.double({ min: -60 * DEG, max: 60 * DEG, noNaN: true }),
  pitch: fc.double({ min: -70 * DEG, max: 70 * DEG, noNaN: true }),
});
const point = fc.tuple(fc.double({ min: -9000, max: 9000, noNaN: true }), fc.double({ min: -500, max: 3000, noNaN: true }), fc.double({ min: -3000, max: 6000, noNaN: true }));

describe('frustum under yaw (rulings S3 gate): a point is inside iff project puts it in the rect, in front of the near plane', () => {
  it('10,000 random turned and tilted cameras and points', () => {
    const rect = cullRect(OPEN);
    fc.assert(
      fc.property(yawed, point, (c, p) => {
        const camera = level(c);
        const q = project(camera, p);
        const planes = frustum(viewOf(camera), rect).map((l) => l(p));
        // a point on (or within rounding of) a boundary may fall either way
        const edge = Math.min(Math.abs(q.depth - NEAR_MM), ...(q.depth > NEAR_MM ? [q.x - rect.x0, rect.x1 - q.x, q.y - rect.y0, rect.y1 - q.y].map(Math.abs) : [Infinity]));
        if (edge < 1e-6) return;
        const inside = q.depth > NEAR_MM && q.x >= rect.x0 && q.x <= rect.x1 && q.y >= rect.y0 && q.y <= rect.y1;
        expect(planes.every((v) => v >= 0)).toBe(inside);
      }),
      { numRuns: 10_000 },
    );
  });
});

describe('trimFace, nearestCabinets and byFrameCentre follow the turn', () => {
  it('a face the turned camera looks at is drawn; one behind its shoulder is not', () => {
    const camera = level({ yaw: 45 * DEG });
    const rect = cullRect(OPEN, 0);
    // the point straight ahead on the fronts, and a square round it
    const ahead = camera.x + camera.z * Math.tan(45 * DEG);
    expect(trimFace(viewOf(camera), [ahead - 50, 950, 0], [100, 0, 0], [0, 100, 0], rect)).toEqual({ s0: 0, s1: 1, t0: 0, t1: 1 });
    // unturned, that square is past the frame's right edge (h/2 is 39.5 deg on the open panel)
    expect(trimFace(viewOf({ ...camera, yaw: 0 }), [ahead - 50, 950, 0], [100, 0, 0], [0, 100, 0], rect)).toBeNull();
    // the fronts left of the camera, which the unturned camera shows, are behind the turned one's left edge
    const left = camera.x - camera.z * Math.tan(30 * DEG);
    expect(trimFace(viewOf({ ...camera, yaw: 0 }), [left - 50, 950, 0], [100, 0, 0], [0, 100, 0], rect)).not.toBeNull();
    expect(trimFace(viewOf(camera), [left - 50, 950, 0], [100, 0, 0], [0, 100, 0], rect)).toBeNull();
  });

  it('the drawn cabinets turn with the camera: a camera turned right draws those to its right', () => {
    const straight = nearestCabinets(viewOf(level()), WALL, [], 5);
    const right = nearestCabinets(viewOf(level({ yaw: 30 * DEG })), WALL, [], 5);
    const left = nearestCabinets(viewOf(level({ yaw: -30 * DEG })), WALL, [], 5);
    const mid = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(straight).toContain(20);
    expect(mid(right)).toBeGreaterThan(mid(straight) + 1);
    expect(mid(left)).toBeLessThan(mid(straight) - 1);
    // the one the frame centre looks at is drawn
    const centre = camera30CentreCabinet();
    expect(right).toContain(centre);
  });

  it('byFrameCentre ranks the figure the turned frame centres on first', () => {
    const camera = level({ yaw: -25 * DEG });
    const at = rayHitPlane(castRay(camera, OPEN.width / 2, OPEN.height / 2), 'z', 0)!.at;
    const box = (x: number): FigureBox => ({ cab: 0, x0: x - 20, x1: x + 20, y0: 980, y1: 1020, z: 0 });
    const figures = [box(camera.x), box(at[0] + 400), box(at[0]), box(at[0] - 400)];
    expect(byFrameCentre(viewOf(camera), figures)[0]).toBe(2);
  });
});

function camera30CentreCabinet(): number {
  const camera = level({ yaw: 30 * DEG });
  const at = rayHitPlane(castRay(camera, OPEN.width / 2, OPEN.height / 2), 'z', 0)!.at;
  return WALL.cabinets.findIndex((c) => at[0] >= c.leftMm && at[0] <= c.rightMm);
}

describe('faceInView: the part of a face the frame (and a margin) sees, as world points', () => {
  it('every point it returns projects inside the rect; a face out of view gives none', () => {
    const camera = level({ yaw: 20 * DEG, pitch: 10 * DEG });
    const rect = cullRect(OPEN, 0);
    const poly = faceInView(viewOf(camera), [camera.x - 20_000, 0, 0], [40_000, 0, 0], [0, 2000, 0], rect);
    expect(poly.length).toBeGreaterThanOrEqual(3);
    for (const p of poly) {
      const q = project(camera, p);
      expect(q.x).toBeGreaterThanOrEqual(-1e-6);
      expect(q.x).toBeLessThanOrEqual(OPEN.width + 1e-6);
      expect(q.y).toBeGreaterThanOrEqual(-1e-6);
      expect(q.y).toBeLessThanOrEqual(OPEN.height + 1e-6);
      expect(p[2]).toBeCloseTo(0, 9);
    }
    expect(faceInView(viewOf(camera), [camera.x - 100, 0, camera.z + 100], [200, 0, 0], [0, 2000, 0], rect)).toEqual([]);
  });
});

describe('texelScale under yaw: the px per mm the screen shows the cabinets\' room at its nearest point in view', () => {
  const span = { y0: 0, y1: 2100, z0: -400, z1: 50 };
  /** Brute force: the nearest depth among a grid of rays through the frame and its margin that meet the room's box. */
  function nearestSeen(camera: Camera, xs: [number, number]): number {
    const rect = cullRect(camera.frame);
    let best = Infinity;
    const box = { x0: xs[0], x1: xs[1], y0: span.y0, y1: span.y1, z0: span.z0, z1: span.z1 };
    for (let i = 0; i <= 120; i++) {
      for (let j = 0; j <= 120; j++) {
        const ray = castRay(camera, rect.x0 + ((rect.x1 - rect.x0) * i) / 120, rect.y0 + ((rect.y1 - rect.y0) * j) / 120);
        for (const [axis, v] of [['x', box.x0], ['x', box.x1], ['y', box.y0], ['y', box.y1], ['z', box.z0], ['z', box.z1]] as const) {
          const hit = rayHitPlane(ray, axis, v);
          if (!hit || hit.t <= NEAR_MM) continue;
          const [x, y, z] = hit.at;
          if (x >= box.x0 - 1e-6 && x <= box.x1 + 1e-6 && y >= box.y0 - 1e-6 && y <= box.y1 + 1e-6 && z >= box.z0 - 1e-6 && z <= box.z1 + 1e-6) best = Math.min(best, hit.t);
        }
      }
    }
    return best;
  }

  it('turned: the nearest point of the room the frame and its margin see, never coarser than it shows, a quarter octave at most finer', () => {
    for (const yaw of [-35, -20, 15, 30]) {
      const camera = level({ yaw: yaw * DEG, pitch: 8 * DEG });
      const xs: [number, number] = [WALL.cabinets[10].leftMm, WALL.cabinets[30].rightMm];
      const s = texelScale(camera, span, xs);
      const need = Math.min(1, camera.focalPx / nearestSeen(camera, xs));
      // the grid of rays finds a point at most a little farther than the true nearest: s may be finer than its need
      expect(s).toBeGreaterThanOrEqual(need * 0.99);
      expect(s).toBeLessThan(need * 2 ** 0.25 * 1.03);
    }
  });

  it('unturned, it is today\'s (the x range plays no part)', () => {
    const camera = level({ pitch: 8 * DEG });
    expect(texelScale(camera, span, [0, 1])).toBe(texelScale(camera, span));
    expect(texelScale({ ...camera, yaw: undefined }, span)).toBe(texelScale(camera, span));
  });

  it('turned toward nothing of the room: the coarsest', () => {
    const camera = level({ yaw: 30 * DEG, x: WALL.rightMm + 30_000 });
    expect(texelScale(camera, span, [WALL.leftMm, WALL.rightMm])).toBe(1 / 64);
  });
});

describe('stickyPose (rulings S3, spec 6.9): keep the last cull while the new frame\'s corners still land well inside it', () => {
  const base = frameCase({ frame: OPEN, wall: WALL, headroomMm: WALL.cabinets.map(() => 300), view: 'wall', focus: 20, shelf: 0, level: true }).camera;
  const view = viewOf(base);

  it('none culled yet: the new one; the same camera: the old one', () => {
    expect(stickyPose(null, view)).toBe(view);
    expect(stickyPose(view, viewOf({ ...base }))).toBe(view);
  });

  it('a small look or walk keeps it; a large one, a new lens or frame re-culls', () => {
    expect(stickyPose(view, viewOf({ ...base, yaw: 2 * DEG }))).toBe(view);
    expect(stickyPose(view, viewOf({ ...base, x: base.x + 200 }))).toBe(view);
    for (const patch of [{ yaw: 20 * DEG }, { x: base.x + 5000 }, { pitch: 30 * DEG }, { focalPx: base.focalPx + 1 }, { frame: { width: 657, height: 687 } }]) {
      const next = viewOf({ ...base, ...patch });
      expect(stickyPose(view, next)).toBe(next);
    }
  });

  it('a corner ray that meets neither the fronts nor the floor (past the wall\'s end, behind its fronts, looking up): re-cull', () => {
    const up = viewOf({ ...base, pitch: -44 * DEG, z: -300, x: WALL.rightMm + 3000 });
    expect(stickyPose(up, viewOf({ ...up.camera, x: up.camera.x + 1 }))).not.toBe(up);
  });

  it('a 20 deg look in 0.5 deg steps re-culls a handful of times, not at every step', () => {
    let culled: CullView | null = null;
    let recull = 0;
    for (let k = 0; k <= 40; k++) {
      const next = viewOf({ ...base, yaw: k * 0.5 * DEG });
      const kept: CullView = stickyPose(culled, next);
      if (kept !== culled) recull++;
      culled = kept;
    }
    // the first cull, then one each time the frame's corners leave the margin's inner half
    expect(recull).toBeGreaterThanOrEqual(2);
    expect(recull).toBeLessThanOrEqual(6);
  });

  it('the margin it keeps to is the cull margin less the re-cull share', () => {
    expect(CULL_MARGIN - RECULL_SHARE).toBe(0.25);
  });
});

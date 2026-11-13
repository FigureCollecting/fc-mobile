import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { DEPTH_DEAD, DEPTH_MAX_MM_S, DEPTH_MIN_MM_S, DEPTH_RATE_PER_S, DEPTH_STOP_MM, aheadMm, depthSpeed, dolly, heading, type DollyScene } from '../caseDepth';
import { EYE_MARGIN_MM, JOG_MAX_STEP_MS, eyeSpace, withPose, type Pose } from '../casePose';
import { lensFocalPx, type Camera, type Vec3 } from '../caseCamera';
import { cabinetBox, capSpanMm, frameSpanMm, frontsOf, roomBox, type Box } from '../caseFraming';
import { SCENE_CEILING_VIEWPORTS } from '../caseBudget';
import { wallLayout } from '../packCabinets';
import { IKEA_DETOLF, IKEA_KLINGSBO, OPEN_STEEL_RACK } from '../cabinetPresets';

// NAV-DEPTH-1 (Ross 11-04, 11-13): the depth rocker's maths. The eye moves forward and back along its horizontal
// heading, at a speed that grows with the rocker's reach and the distance ahead, through every rule a jog moves through.

const DEG = Math.PI / 180;
const FRAME = { width: 870, height: 475 };
const F = lensFocalPx(FRAME);
const FRAME_MS = 16;
const OPEN: Box = { x0: -1e5, x1: 1e5, y0: 300, y1: 2400, z0: -1e5, z1: 1e5 };
const open: DollyScene = { space: OPEN, boxes: [] };
const eye = (p: Pose): Vec3 => [p.x, p.y, p.z];
const grownHas = (b: Box, p: Vec3) =>
  p[0] > b.x0 - EYE_MARGIN_MM && p[0] < b.x1 + EYE_MARGIN_MM && p[1] > b.y0 - EYE_MARGIN_MM && p[1] < b.y1 + EYE_MARGIN_MM && p[2] > b.z0 - EYE_MARGIN_MM && p[2] < b.z1 + EYE_MARGIN_MM;
const inSpace = (s: Box, p: Vec3) => p[0] >= s.x0 && p[0] <= s.x1 && p[1] >= s.y0 && p[1] <= s.y1 && p[2] >= s.z0 && p[2] <= s.z1;
const hold = (pose: Pose, r: number, ms: number, scene: DollyScene, each?: (p: Pose) => void): Pose => {
  let p = pose;
  for (let t = 0; t < ms; t += FRAME_MS) {
    p = dolly(p, r, FRAME_MS, scene);
    each?.(p);
  }
  return p;
};

const ceiling = 2438.4;
const wall = wallLayout([IKEA_KLINGSBO, IKEA_DETOLF, OPEN_STEEL_RACK, IKEA_KLINGSBO, IKEA_DETOLF]);
const boxes = wall.cabinets.map((slot) => cabinetBox(slot, 300));
const space = eyeSpace(roomBox(wall, ceiling), ceiling);
const room: DollyScene = { space, boxes };

describe('heading: the horizontal heading, never the pitched view', () => {
  it('is (sin yaw, 0, -cos yaw) whatever the pitch', () => {
    const h = heading({ x: 0, y: 0, z: 0, yaw: 30 * DEG, pitch: 0.6 });
    expect(h[0]).toBeCloseTo(Math.sin(30 * DEG), 12);
    expect(h[1]).toBe(0);
    expect(h[2]).toBeCloseTo(-Math.cos(30 * DEG), 12);
    expect(heading({ x: 0, y: 0, z: 0, yaw: 0, pitch: -0.4 })).toEqual([0, 0, -1]);
  });
});

describe('depthSpeed: dead zone, r^2 curve, adaptive to the distance ahead, clamped', () => {
  it('moves nothing inside the dead zone, either way, and nothing for a non-number', () => {
    for (const r of [0, DEPTH_DEAD / 2, -DEPTH_DEAD / 2, DEPTH_DEAD, -DEPTH_DEAD, Number.NaN]) expect(depthSpeed(r, 3000)).toBe(0);
    expect(depthSpeed(DEPTH_DEAD + 0.01, 3000)).toBeGreaterThan(0);
  });

  it('is signed: + approaches, - retreats, at the same speed', () => {
    expect(depthSpeed(-0.7, 2000)).toBe(-depthSpeed(0.7, 2000));
    expect(depthSpeed(0.7, 2000)).toBeGreaterThan(0);
  });

  it('grows as the square of the reach past the dead zone', () => {
    const full = depthSpeed(1, 2000);
    expect(full).toBeGreaterThan(0);
    const reach = (r: number) => (r - DEPTH_DEAD) / (1 - DEPTH_DEAD);
    expect(depthSpeed(0.5, 2000)).toBeCloseTo(full * reach(0.5) ** 2, 9);
    expect(depthSpeed(0.25, 2000)).toBeCloseTo(full * reach(0.25) ** 2, 9);
  });

  it('a rocker past its travel moves at full reach', () => {
    expect(depthSpeed(3, 2000)).toBe(depthSpeed(1, 2000));
    expect(depthSpeed(3, 2000)).toBeGreaterThan(0);
    expect(depthSpeed(-3, 2000)).toBe(depthSpeed(-1, 2000));
  });

  it('at 4,500 mm ahead is at least 5x the speed at 300 mm ahead (fast when far, slow inches from a display)', () => {
    expect(depthSpeed(1, 300)).toBeGreaterThan(0);
    expect(depthSpeed(1, 4500)).toBeGreaterThanOrEqual(5 * depthSpeed(1, 300));
    expect(depthSpeed(0.6, 4500)).toBeGreaterThanOrEqual(5 * depthSpeed(0.6, 300));
  });

  it('is DEPTH_RATE_PER_S of the distance ahead at full reach, clamped to [DEPTH_MIN_MM_S, DEPTH_MAX_MM_S]', () => {
    expect(depthSpeed(1, 1000)).toBeCloseTo(DEPTH_RATE_PER_S * 1000, 9);
    expect(depthSpeed(1, 1e9)).toBe(DEPTH_MAX_MM_S);
    expect(depthSpeed(1, Infinity)).toBe(DEPTH_MAX_MM_S);
    expect(depthSpeed(1, 0)).toBe(DEPTH_MIN_MM_S);
    expect(depthSpeed(1, Number.NaN)).toBe(DEPTH_MIN_MM_S);
    expect(depthSpeed(-1, 0)).toBe(-DEPTH_MIN_MM_S);
  });
});

describe('aheadMm: the horizontal distance to the first surface ahead', () => {
  const front = boxes[0];
  const x = wall.cabinets[0].centerMm;

  it('is the distance to the cabinet front straight ahead', () => {
    expect(aheadMm({ x, y: 1200, z: 3000, yaw: 0, pitch: 0.6 }, space, boxes)).toBeCloseTo(3000 - front.z1, 9);
  });

  it('is EYE_MARGIN_MM where the eye stands at the margin', () => {
    expect(aheadMm({ x, y: 1200, z: front.z1 + EYE_MARGIN_MM, yaw: 0, pitch: 0 }, space, boxes)).toBeCloseTo(EYE_MARGIN_MM, 9);
  });

  it('looks over a cabinet the eye is above, to the back wall', () => {
    const y = front.y1 + EYE_MARGIN_MM + 1;
    expect(aheadMm({ x, y, z: 3000, yaw: 0, pitch: 0 }, { ...space, y1: y + 1000 }, boxes)).toBeCloseTo(3000 - (space.z0 - EYE_MARGIN_MM), 9);
  });

  it('passes a cabinet beside the heading, and one the eye is already in (the margin it may back out of)', () => {
    const beside = { x: wall.rightMm + 500, y: 1200, z: 3000, yaw: 0, pitch: 0 };
    expect(aheadMm(beside, space, boxes)).toBeCloseTo(3000 - (space.z0 - EYE_MARGIN_MM), 9);
    const inMargin = { x, y: 1200, z: front.z1 + EYE_MARGIN_MM / 2, yaw: 0, pitch: 0 };
    expect(aheadMm(inMargin, space, boxes)).toBeCloseTo(inMargin.z - (space.z0 - EYE_MARGIN_MM), 9);
  });

  it('turned, meets the room wall it heads for: the side wall, or the back', () => {
    expect(aheadMm({ x: 0, y: 1200, z: 0, yaw: 90 * DEG, pitch: 0 }, OPEN, [])).toBeCloseTo(1e5 + EYE_MARGIN_MM, 6);
    expect(aheadMm({ x: 0, y: 1200, z: 0, yaw: -90 * DEG, pitch: 0 }, OPEN, [])).toBeCloseTo(1e5 + EYE_MARGIN_MM, 6);
    expect(aheadMm({ x: 0, y: 1200, z: 0, yaw: 180 * DEG, pitch: 0 }, OPEN, [])).toBeCloseTo(1e5 + EYE_MARGIN_MM, 6);
  });

  it('turned, meets a cabinet across its corner', () => {
    const b: Box = { x0: 1000, x1: 2000, y0: 0, y1: 2000, z0: -500, z1: 0 };
    const yaw = 45 * DEG;
    // from (0, 1000, 2500), heading (0.707, 0, -0.707): the grown box's front (z = 100) is met at x = 2400, past its
    // grown right side (2100); its left side (x = 900) is met at z = 1600, outside its front: the ray misses it
    expect(aheadMm({ x: 0, y: 1000, z: 2500, yaw, pitch: 0 }, OPEN, [b])).toBeGreaterThan(1e4);
    // from (0, 1000, 900): the grown left side (x = 900) is met at z = 0, within its depth: a hit 900 sqrt 2 along
    expect(aheadMm({ x: 0, y: 1000, z: 900, yaw, pitch: 0 }, OPEN, [b])).toBeCloseTo(900 * Math.SQRT2 + EYE_MARGIN_MM, 6);
  });

  it('an eye past the room bound (where the bounds narrowed) is at the margin', () => {
    expect(aheadMm({ x: 0, y: 1200, z: OPEN.z0 - 50, yaw: 0, pitch: 0 }, OPEN, [])).toBe(EYE_MARGIN_MM);
  });
});

describe('dolly: the eye forward and back along its heading', () => {
  const start: Pose = { x: 0, y: 1200, z: 3000, yaw: 0, pitch: 0 };

  it('pitch 0.6, r = +1 leaves eye y unchanged (looking down never dives to the floor)', () => {
    const p = { ...start, pitch: 0.6 };
    const next = dolly(p, 1, FRAME_MS, open);
    expect(next.z).toBeLessThan(p.z);
    expect(Math.abs(next.y - p.y)).toBeLessThan(1e-9);
    const held = hold(p, 1, 2000, open);
    expect(Math.abs(held.y - p.y)).toBeLessThan(1e-9);
    expect(held.pitch).toBe(0.6);
  });

  it('yaw 30 deg moves parallel to (sin 30, 0, -cos 30), forward; r = -1 back along it', () => {
    const p = { ...start, yaw: 30 * DEG };
    for (const r of [1, -1]) {
      const next = dolly(p, r, FRAME_MS, open);
      const d = [next.x - p.x, next.y - p.y, next.z - p.z];
      const h = [Math.sin(30 * DEG), 0, -Math.cos(30 * DEG)];
      const len = Math.hypot(d[0], d[1], d[2]);
      expect(len).toBeGreaterThan(1);
      expect(Math.abs(d[0] * h[2] - d[2] * h[0]) / len).toBeLessThan(1e-12);
      expect(d[1]).toBe(0);
      expect(Math.sign(d[0] * h[0] + d[2] * h[2])).toBe(r);
      expect(next.yaw).toBe(p.yaw);
    }
  });

  it('steps depthSpeed of the distance ahead for the frame time', () => {
    const next = dolly(start, 0.8, FRAME_MS, room);
    expect(next.z).toBeLessThan(start.z);
    const ahead = aheadMm(start, space, boxes);
    expect(start.z - next.z).toBeCloseTo((depthSpeed(0.8, ahead) * FRAME_MS) / 1000, 9);
  });

  it('inside the dead zone nothing moves', () => {
    for (const r of [0, DEPTH_DEAD / 2, -DEPTH_DEAD / 2, DEPTH_DEAD]) expect(dolly(start, r, FRAME_MS, open)).toEqual(start);
  });

  it('dt 500 ms is clamped to the jog max step', () => {
    const late = dolly(start, 1, 500, open);
    expect(late).toEqual(dolly(start, 1, JOG_MAX_STEP_MS, open));
    expect(start.z - late.z).toBeCloseTo((DEPTH_MAX_MM_S * JOG_MAX_STEP_MS) / 1000, 9);
    expect(dolly(start, 1, Infinity, open)).toEqual(late);
  });

  it('a frame of no time, negative time or no number moves nothing', () => {
    for (const dt of [0, -16, Number.NaN]) expect(dolly(start, 1, dt, open)).toEqual(start);
  });

  it('10 s of r = +1 never ends inside EYE_MARGIN_MM of a surface: it stops at the margin', () => {
    const x = wall.cabinets[0].centerMm;
    const front = boxes[0];
    const end = hold({ ...start, x }, 1, 10_000, room, (p) => {
      expect(boxes.some((b) => grownHas(b, eye(p)))).toBe(false);
      expect(p.z).toBeGreaterThanOrEqual(front.z1 + EYE_MARGIN_MM);
    });
    expect(end.z).toBe(front.z1 + EYE_MARGIN_MM);
    expect(end.y).toBe(start.y);
  });

  it('10 s of r = +1 turned slides along the fronts, never inside the margin of any', () => {
    // from 1.2 m out, both headings meet a front (cabinet 3, cabinet 0) before the wall's end
    const x = wall.cabinets[2].centerMm;
    for (const yaw of [30 * DEG, -50 * DEG]) {
      let prev: Pose = { ...start, x, z: 1200, yaw };
      let slid = 0;
      hold(prev, 1, 10_000, room, (p) => {
        expect(boxes.some((b) => grownHas(b, eye(p)))).toBe(false);
        expect(inSpace(space, eye(p))).toBe(true);
        if (p.z === prev.z && p.x !== prev.x) slid++;
        prev = p;
      });
      expect(slid).toBeGreaterThan(10);
    }
  });

  it('r = -1 stops at the frameSpan cap (the Classic cap, as a jog is kept)', () => {
    const fronts = frontsOf(wall, wall.cabinets.map(() => 300));
    const base: Camera = { x: 0, y: 0, z: 0, pitch: 0, focalPx: F, frame: FRAME };
    const p: Pose = { x: wall.cabinets[2].centerMm, y: 1200, z: 600, yaw: 0, pitch: 0.1 };
    // the cap as the jog takes it (spanOf): the limit, or the stretch shown now where that is wider
    const span = Math.max(capSpanMm(wall, 4), frameSpanMm(withPose(base, p), fronts));
    const spanAt = (q: Vec3) => frameSpanMm(withPose(base, { ...p, x: q[0], y: q[1], z: q[2] }), fronts);
    expect(spanAt(eye(p))).toBeLessThan(span);
    const capped: DollyScene = { space, boxes, ok: (q) => spanAt(q) <= span };
    const end = hold(p, -1, 10_000, capped, (q) => expect(spanAt(eye(q))).toBeLessThanOrEqual(span));
    expect(end.z).toBeGreaterThan(p.z + 100);
    // within DEPTH_STOP_MM of the cap: that much farther back shows more than it
    expect(spanAt([end.x, end.y, end.z + DEPTH_STOP_MM])).toBeGreaterThan(span);
    // the uncapped retreat goes on past it
    expect(hold(p, -1, 10_000, room).z).toBeGreaterThan(end.z + 100);
  });

  it('keeps to the wall-end rule a jog keeps to (ok): no farther past the end than it is', () => {
    const past = (x: number) => Math.max(0, wall.leftMm - x, x - wall.rightMm);
    const p: Pose = { ...start, x: wall.rightMm - 300, yaw: 40 * DEG };
    const ends: DollyScene = { space, boxes, ok: (q) => past(q[0]) <= past(p.x) };
    const end = hold(p, 1, 10_000, ends);
    expect(end.x).toBeLessThanOrEqual(wall.rightMm);
    expect(wall.rightMm - end.x).toBeLessThanOrEqual(DEPTH_STOP_MM);
  });

  it('a stub projector failing at z < 800 stops at the last fitting z', () => {
    const vp = (q: Vec3) => (q[2] < 800 ? SCENE_CEILING_VIEWPORTS + 1 : 1);
    const end = hold(start, 1, 10_000, { ...open, vp }, (q) => expect(q.z).toBeGreaterThanOrEqual(800));
    expect(end.z).toBeLessThan(800 + DEPTH_STOP_MM);
    // and retreats from there freely
    expect(dolly(end, -1, FRAME_MS, { ...open, vp }).z).toBeGreaterThan(end.z);
  });

  it('a start already past the budget moves only where the cost does not rise (never a trap)', () => {
    // the cost falls with distance: over the ceiling nearer than z = 7000
    const vp = (q: Vec3) => 10 - q[2] / 1000;
    const p = { ...start, z: 5000 };
    expect(dolly(p, 1, FRAME_MS, { ...open, vp })).toEqual(p);
    const back = dolly(p, -1, FRAME_MS, { ...open, vp });
    expect(back.z).toBeGreaterThan(p.z);
  });

  it('property: any sequence of r and dt never leaves the eye space nor enters a grown cabinet box', () => {
    // fast-check's doubles lean on edge values (0, the bounds), so most steps would not move: whole percents and
    // milliseconds, forward-heavy so most runs reach the fronts, and the edge values besides
    const step = fc.record({
      r: fc.oneof(
        { arbitrary: fc.integer({ min: -150, max: 150 }).map((n) => n / 100), weight: 3 },
        { arbitrary: fc.integer({ min: 50, max: 150 }).map((n) => n / 100), weight: 3 },
        { arbitrary: fc.constantFrom(Number.NaN, 0, DEPTH_DEAD, -1, 1), weight: 1 },
      ),
      dt: fc.oneof({ arbitrary: fc.integer({ min: 1, max: 1000 }), weight: 6 }, { arbitrary: fc.constantFrom(-16, 0, Infinity, Number.NaN), weight: 1 }),
    });
    // whole mm and tenths of a degree, half the starts before the wall: the rest anywhere in the space
    const mm = (lo: number, hi: number) => fc.integer({ min: Math.ceil(lo), max: Math.floor(hi) });
    const startArb = fc.record({
      x: fc.oneof(mm(wall.leftMm - 1500, wall.rightMm + 1500), mm(space.x0, space.x1)),
      y: mm(space.y0, space.y1),
      z: fc.oneof(mm(0, 1500), mm(0, space.z1)),
      yaw: fc.integer({ min: -600, max: 600 }).map((n) => (n / 10) * DEG),
      pitch: fc.integer({ min: -450, max: 700 }).map((n) => (n / 10) * DEG),
    });
    fc.assert(
      fc.property(startArb, fc.array(step, { minLength: 1, maxLength: 150, size: 'max' }), (s0, steps) => {
        fc.pre(!boxes.some((b) => grownHas(b, eye(s0))));
        let p: Pose = s0;
        for (const { r, dt } of steps) {
          p = dolly(p, r, dt, room);
          if (!inSpace(space, eye(p)) || boxes.some((b) => grownHas(b, eye(p)))) return false;
          if (p.y !== s0.y || p.yaw !== s0.yaw || p.pitch !== s0.pitch) return false;
        }
        return true;
      }),
      { numRuns: 400, seed: 1113 },
    );
  });
});

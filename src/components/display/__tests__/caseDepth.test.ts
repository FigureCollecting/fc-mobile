import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { DEPTH_DEAD, DEPTH_MAX_MM_S, DEPTH_MIN_MM_S, DEPTH_RATE_PER_S, DEPTH_STOP_MM, aheadMm, depthSpeed, dolly, dollyStep, heading, type DollyScene } from '../caseDepth';
import { EYE_MARGIN_MM, JOG_MAX_STEP_MS, eyeSpace, withPose, type Pose } from '../casePose';
import { lensFocalPx, type Camera, type Vec3 } from '../caseCamera';
import { cabinetBox, capSpanMm, frameSpanMm, frontsOf, roomBox, type Box } from '../caseFraming';
import { SCENE_CEILING_VIEWPORTS, fitsCeiling } from '../caseBudget';
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

describe('the specified values (NAV-DEPTH-1 brief, Ross 11-13), pinned as numbers', () => {
  it('dead zone 0.1, 1.5x the distance a second, 50 to 4000 mm/s, a 1 mm stop', () => {
    expect([DEPTH_DEAD, DEPTH_RATE_PER_S, DEPTH_MIN_MM_S, DEPTH_MAX_MM_S, DEPTH_STOP_MM]).toEqual([0.1, 1.5, 50, 4000, 1]);
  });

  it('gives those speeds: none at 0.1, 1500 mm/s at 1 m, a quarter of it at half reach (r^2), 4000 and 50 at the clamps', () => {
    expect(depthSpeed(0.1, 1000)).toBe(0);
    expect(depthSpeed(0.05, 1000)).toBe(0);
    expect(depthSpeed(1, 1000)).toBeCloseTo(1500, 9);
    expect(depthSpeed(0.55, 1000)).toBeCloseTo(375, 9);
    expect(depthSpeed(-0.55, 1000)).toBeCloseTo(-375, 9);
    expect(depthSpeed(1, 1e6)).toBe(4000);
    expect(depthSpeed(1, 10)).toBe(50);
  });

  it('a rocker at 0.05 is in the dead zone: the eye stays', () => {
    const p: Pose = { x: 0, y: 1200, z: 1500, yaw: 0, pitch: 0 };
    expect(dolly(p, 0.05, FRAME_MS, open)).toEqual(p);
  });

  it('straight at a cabinet front from 4.5 m: never faster than 4 m/s, and under 0.2 m/s in the last frame', () => {
    const x = wall.cabinets[0].centerMm;
    let p: Pose = { x, y: 1200, z: boxes[0].z1 + EYE_MARGIN_MM + 4500, yaw: 0, pitch: 0 };
    let last = 0;
    for (let t = 0; t < 10_000; t += FRAME_MS) {
      const n = dolly(p, 1, FRAME_MS, room);
      const step = p.z - n.z;
      expect((step * 1000) / FRAME_MS).toBeLessThanOrEqual(4000 + 1e-9);
      if (step > 0) last = step;
      p = n;
    }
    expect(p.z).toBe(boxes[0].z1 + EYE_MARGIN_MM);
    expect((last * 1000) / FRAME_MS).toBeLessThan(200);
  });

  it('a stop held against ok lands within 1 mm of it (not 10)', () => {
    const ok = (q: Vec3) => q[2] >= 1003.37;
    let p: Pose = { x: 0, y: 1200, z: 1500, yaw: 0, pitch: 0 };
    for (let i = 0; i < 100; i++) p = dolly(p, 1, 100, { ...open, ok });
    expect(p.z).toBeGreaterThanOrEqual(1003.37);
    expect(p.z - 1003.37).toBeLessThanOrEqual(1);
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

  it('back (-1) measures the same way along -heading: the room behind, a cabinet behind', () => {
    expect(aheadMm({ x, y: 1200, z: 3000, yaw: 0, pitch: 0 }, space, boxes, -1)).toBeCloseTo(space.z1 + EYE_MARGIN_MM - 3000, 9);
    // turned all the way round, the fronts are behind
    expect(aheadMm({ x, y: 1200, z: 3000, yaw: Math.PI, pitch: 0 }, space, boxes, -1)).toBeCloseTo(3000 - front.z1, 6);
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

  it('eases in toward a cabinet front: each frame at depthSpeed of the distance to the front, not to the room', () => {
    const x = wall.cabinets[0].centerMm;
    const face = boxes[0].z1 + EYE_MARGIN_MM;
    let p: Pose = { ...start, x, z: face + 3000 };
    let prev = Infinity;
    let at1000 = 0;
    while (p.z > face) {
      const n = dolly(p, 1, FRAME_MS, room);
      const speed = ((p.z - n.z) * 1000) / FRAME_MS;
      const toFront = p.z - boxes[0].z1;
      expect(speed).toBeCloseTo(Math.min(depthSpeed(1, toFront), ((p.z - face) * 1000) / FRAME_MS), 6);
      expect(speed).toBeLessThanOrEqual(prev + 1e-9);
      if (toFront <= 1000 && at1000 === 0) at1000 = speed;
      prev = speed;
      p = n;
    }
    // 1 m from the front it moves at 1.5 m/s, though the room runs on behind the cabinet
    expect(at1000).toBeGreaterThan(1300);
    expect(at1000).toBeLessThanOrEqual(1500);
  });

  it('eases in backing toward the bound behind: never stops dead from more than 200 mm/s', () => {
    for (const z of [space.z1 - 500, space.z1 - 3000]) {
      let p: Pose = { ...start, x: wall.cabinets[0].centerMm, z };
      let last = 0;
      for (let t = 0; t < 10_000; t += FRAME_MS) {
        const n = dolly(p, -1, FRAME_MS, room);
        if (n.z !== p.z) last = ((n.z - p.z) * 1000) / FRAME_MS;
        p = n;
      }
      expect(p.z).toBe(space.z1);
      expect(last).toBeGreaterThan(0);
      expect(last).toBeLessThan(200);
    }
  });

  it('backing (turned round) toward a cabinet front eases in and stops on its margin', () => {
    const x = wall.cabinets[0].centerMm;
    const face = boxes[0].z1 + EYE_MARGIN_MM;
    let p: Pose = { ...start, x, z: face + 3000, yaw: Math.PI };
    let last = 0;
    for (let t = 0; t < 10_000; t += FRAME_MS) {
      const n = dolly(p, -1, FRAME_MS, room);
      const speed = ((p.z - n.z) * 1000) / FRAME_MS;
      // never faster than the front behind allows (the last frame is cut short by the margin)
      expect(speed).toBeLessThanOrEqual(DEPTH_RATE_PER_S * (p.z - boxes[0].z1) + 1e-6);
      if (speed > 0) last = speed;
      p = n;
    }
    expect(p.z).toBeCloseTo(face, 6);
    expect(last).toBeGreaterThan(0);
    expect(last).toBeLessThan(200);
  });

  it('a light reverse (r = -0.3) takes the nearer distance too: 100 mm from a front ahead, 300 mm from one behind', () => {
    const x = wall.cabinets[0].centerMm;
    const speedAt = (p: Pose) => (Math.abs(dolly(p, -0.3, FRAME_MS, room).z - p.z) * 1000) / FRAME_MS;
    const nearer = (p: Pose) => -depthSpeed(-0.3, Math.min(aheadMm(p, space, boxes), aheadMm(p, space, boxes, -1)));
    // facing the front, at its margin: the room ahead (100 mm) is the nearer
    const facing: Pose = { ...start, x, z: boxes[0].z1 + EYE_MARGIN_MM };
    expect(speedAt(facing)).toBeCloseTo(nearer(facing), 9);
    expect(speedAt(facing)).toBeCloseTo(1.5 * 100 * (0.2 / 0.9) ** 2, 9);
    // turned away from it, 300 mm out: the front behind is the nearer, never the room ahead
    const away: Pose = { ...start, x, z: boxes[0].z1 + 300, yaw: Math.PI };
    expect(speedAt(away)).toBeCloseTo(nearer(away), 6);
    expect(speedAt(away)).toBeCloseTo(1.5 * 300 * (0.2 / 0.9) ** 2, 6);
  });

  it('backing away from a display 100 mm in front starts slow: the nearer of the room ahead and behind', () => {
    const x = wall.cabinets[0].centerMm;
    const p: Pose = { ...start, x, z: boxes[0].z1 + EYE_MARGIN_MM };
    const speed = ((dolly(p, -1, FRAME_MS, room).z - p.z) * 1000) / FRAME_MS;
    expect(speed).toBeLessThanOrEqual(200);
    expect(speed).toBeCloseTo(-depthSpeed(-1, Math.min(aheadMm(p, space, boxes), aheadMm(p, space, boxes, -1))), 6);
    // and speeds up as the display falls away (2 m behind it after 2 s)
    const away = hold(p, -1, 2000, room);
    expect(((dolly(away, -1, FRAME_MS, room).z - away.z) * 1000) / FRAME_MS).toBeGreaterThan(1000);
  });

  it('a pose with a non-number in it moves nothing and comes back unchanged', () => {
    for (const bad of [{ yaw: Number.NaN }, { yaw: Infinity }, { x: Number.NaN }, { z: -Infinity }, { y: Number.NaN }, { pitch: Number.NaN }]) {
      const p: Pose = { ...start, ...bad };
      expect(dolly(p, 1, FRAME_MS, open)).toBe(p);
      expect(dolly(p, -1, FRAME_MS, room)).toBe(p);
      expect(dollyStep(p, 1, FRAME_MS, { ...open, vp: () => 1 }, 1.5)).toEqual({ pose: p, vp: 1.5 });
    }
  });

  it('a stale low v0 (the scene got heavier, now over the ceiling) never freezes the eye: the true cost comes back', () => {
    const C = SCENE_CEILING_VIEWPORTS;
    // the true cost is over the ceiling everywhere near and falls as the eye backs off (+z)
    const vp = (q: Vec3) => C + 2 - (q[2] - 3000) / 10_000;
    const first = dollyStep(start, -1, FRAME_MS, { ...open, vp }, 1);
    expect(first.vp).toBe(vp(eye(first.pose)));
    let p: Pose = start;
    let v: number | undefined = 1;
    for (let i = 0; i < 60; i++) {
      const s = dollyStep(p, -1, FRAME_MS, { ...open, vp }, v);
      expect(s.vp).toBe(vp(eye(s.pose)));
      p = s.pose;
      v = s.vp;
    }
    expect(p.z).toBeGreaterThan(start.z + 1000);
  });

  it('a stale high v0 (the scene got lighter) never lets a frame be drawn past the ceiling', () => {
    const C = SCENE_CEILING_VIEWPORTS;
    // the true cost is 2 here and reaches the ceiling 20 mm ahead (5.2 one full-speed frame ahead)
    const vp = (q: Vec3) => 2 + (3000 - q[2]) / 20;
    let p: Pose = start;
    let v: number | undefined = 10;
    for (let i = 0; i < 60; i++) {
      const s = dollyStep(p, 1, FRAME_MS, { ...open, vp }, v);
      expect(vp(eye(s.pose))).toBeLessThanOrEqual(C);
      p = s.pose;
      v = s.vp;
    }
    expect(start.z - p.z).toBeGreaterThan(19);
    expect(start.z - p.z).toBeLessThanOrEqual(20);
  });

  it('v0 is trusted exactly up to the ceiling fitsCeiling uses: at it, kept; any hair over it, asked again', () => {
    const C = SCENE_CEILING_VIEWPORTS;
    const over = [C + 1e-3, C + 1e-9, C + C * Number.EPSILON];
    expect(over.every((v) => v > C && !fitsCeiling(v))).toBe(true);
    expect(fitsCeiling(C)).toBe(true);
    const askedAtStart = (v0: number) => {
      let asked = false;
      const vp = (q: Vec3) => {
        if (q[0] === start.x && q[1] === start.y && q[2] === start.z) asked = true;
        return 1;
      };
      const s = dollyStep(start, 1, FRAME_MS, { ...open, vp }, v0);
      expect(s.pose.z).toBeLessThan(start.z);
      return asked;
    };
    expect(askedAtStart(C)).toBe(false);
    expect(askedAtStart(1)).toBe(false);
    for (const v0 of over) expect(askedAtStart(v0)).toBe(true);
  });

  it('a v0 that is no number (NaN, -Infinity) is asked again: the eye moves both ways and a real cost comes back', () => {
    // under the ceiling, and on a flat cost over it (where a trusted -Infinity would hold the eye a frame)
    for (const cost of [1, SCENE_CEILING_VIEWPORTS + 1]) {
      const vp = () => cost;
      for (const v0 of [Number.NaN, -Infinity]) {
        for (const r of [1, -1]) {
          const s = dollyStep(start, r, FRAME_MS, { ...open, vp }, v0);
          expect(s.pose.z).not.toBe(start.z);
          expect(s.vp).toBe(cost);
        }
      }
    }
  });

  it('over the ceiling on a flat cost (the cost does not rise), the eye still moves both ways', () => {
    const vp = () => SCENE_CEILING_VIEWPORTS + 1;
    expect(dollyStep(start, 1, FRAME_MS, { ...open, vp }).pose.z).toBeLessThan(start.z);
    expect(dollyStep(start, -1, FRAME_MS, { ...open, vp }).pose.z).toBeGreaterThan(start.z);
  });

  it('held against the budget, a frame makes at most 3 cost calls (2 ok calls), and hands back the true cost', () => {
    let vpCalls = 0;
    let okCalls = 0;
    const p = { ...start };
    const vp = (q: Vec3) => {
      vpCalls++;
      return q[2] < p.z - 0.5 ? SCENE_CEILING_VIEWPORTS + 1 : 1;
    };
    const ok = () => {
      okCalls++;
      return true;
    };
    // a v0 that matches the scene, and one gone stale (2, under the ceiling; the true cost is 1)
    for (const [dt, v0] of [
      [FRAME_MS, 1],
      [JOG_MAX_STEP_MS, 1],
      [FRAME_MS, 2],
    ]) {
      vpCalls = 0;
      okCalls = 0;
      const held = dollyStep(p, 1, dt, { ...open, vp, ok }, v0);
      expect(held.pose).toBe(p);
      expect(held.vp).toBe(1);
      expect(vpCalls).toBeLessThanOrEqual(3);
      expect(okCalls).toBeLessThanOrEqual(2);
    }
    // not passed in, it is asked once more
    vpCalls = 0;
    expect(dollyStep(p, 1, FRAME_MS, { ...open, vp }).pose).toBe(p);
    expect(vpCalls).toBeLessThanOrEqual(3);
  });

  it('one frame reaches a stop within DEPTH_STOP_MM of it (a search, not a 1 mm creep)', () => {
    // from 100 mm out, and from 5 mm (past the first 1 mm the stop search asks)
    for (const z of [1100, 1005]) {
      const p = { ...start, z };
      for (const scene of [{ ...open, ok: (q: Vec3) => q[2] >= 1000 }, { ...open, vp: (q: Vec3) => (q[2] < 1000 ? SCENE_CEILING_VIEWPORTS + 1 : 1) }]) {
        const n = dolly(p, 1, JOG_MAX_STEP_MS, scene);
        expect(n.z).toBeGreaterThanOrEqual(1000);
        expect(n.z).toBeLessThan(1000 + DEPTH_STOP_MM);
      }
    }
  });

  it('returns the cost where it stopped, so the next frame need not ask for it again', () => {
    let vpCalls = 0;
    const vp = (q: Vec3) => {
      vpCalls++;
      return q[2] < 800 ? SCENE_CEILING_VIEWPORTS + 1 : 1 + q[2] / 10_000;
    };
    let p: Pose = { ...start };
    let cost: number | undefined;
    let free = 0;
    for (let i = 0; i < 400; i++) {
      vpCalls = 0;
      const step = dollyStep(p, 1, FRAME_MS, { ...open, vp }, cost);
      if (cost !== undefined && step.pose.z === p.z - (DEPTH_MAX_MM_S * FRAME_MS) / 1000) {
        expect(vpCalls).toBe(1);
        free++;
      }
      p = step.pose;
      cost = step.vp;
      expect(cost).toBe(1 + p.z / 10_000);
    }
    expect(free).toBeGreaterThan(10);
    expect(p.z).toBeGreaterThanOrEqual(800);
    expect(p.z).toBeLessThan(800 + DEPTH_STOP_MM);
    // no vp, no cost; the dead zone hands the cost given back
    expect(dollyStep(start, 1, FRAME_MS, open).vp).toBeUndefined();
    expect(dollyStep(start, 0, FRAME_MS, { ...open, vp }, 1.25).vp).toBe(1.25);
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

  it('a search that ends on a failing probe hands back the cost where the eye ends, not the probe', () => {
    // the challenger's shrunk frame (round 3): no v0, a wavy cost near the ceiling, one reverse frame that searches;
    // at 2.698 under the ceiling (its search ends on a passing probe), and the scene a step heavier (3.398, over the
    // ceiling: its search ends on a failing one)
    for (const base of [2.698, 3.398]) {
      let calls = 0;
      const vp = (q: Vec3) => {
        calls++;
        return base + 0.4 * Math.sin(q[2] / 13 + q[0] / 17);
      };
      const p: Pose = { ...start, z: 1500, yaw: 0 };
      const step = dollyStep(p, -0.6037, 94, { ...room, vp });
      expect(step.pose).not.toBe(p);
      expect(calls).toBeGreaterThan(3);
      expect(step.vp).toBe(vp(eye(step.pose)));
    }
  });

  it('property: every frame hands back the cost where the eye ends; a held frame asks at most 3 costs', () => {
    const C = SCENE_CEILING_VIEWPORTS;
    // whole percents of the rocker and whole ms, with the dead zone's edge; the caller may keep a v0 the scene changed
    // under, or carry junk (a stale v0 lives one frame at most)
    const step = fc.record({
      r: fc.oneof(fc.integer({ min: -120, max: 120 }).map((n) => n / 100), fc.constantFrom(0, DEPTH_DEAD, -DEPTH_DEAD, -1, 1)),
      dt: fc.integer({ min: 1, max: 150 }),
      change: fc.boolean(),
    });
    const v0Arb = fc.oneof(fc.constant(undefined), fc.double({ min: -10, max: 10, noNaN: true }), fc.constantFrom(Number.NaN, Infinity, -Infinity, C, C + 1e-12));
    fc.assert(
      fc.property(
        fc.array(step, { minLength: 1, maxLength: 40 }),
        v0Arb,
        fc.double({ min: 0, max: 6, noNaN: true }),
        fc.double({ min: -0.02, max: 0.02, noNaN: true }),
        fc.integer({ min: -600, max: 600 }),
        (steps, v00, base, slope, yawTenths) => {
          let k = 0;
          const costOf = (n: number) => (q: Vec3) => base + n * 0.7 + slope * (3000 - q[2]) + 0.4 * Math.sin(q[2] / 13 + q[0] / 17);
          let p: Pose = { ...start, z: 1500, yaw: (yawTenths / 10) * DEG };
          let v = v00;
          for (const { r, dt, change } of steps) {
            if (change) k = (k + 1) % 3;
            const f = costOf(k);
            let calls = 0;
            const vp = (q: Vec3) => {
              calls++;
              return f(q);
            };
            const before = f(eye(p));
            const s = dollyStep(p, r, dt, { ...room, vp }, v);
            if (!(Math.abs(r) > DEPTH_DEAD)) {
              // moves nothing for its rocker: v0 back as given, no cost asked
              if (s.pose !== p || !Object.is(s.vp, v) || calls !== 0) return false;
            } else {
              if (s.vp !== f(eye(s.pose))) return false;
              if (s.pose === p && calls > 3) return false;
              if (s.pose !== p && f(eye(s.pose)) > Math.max(C, before)) return false;
            }
            p = s.pose;
            v = s.vp;
          }
          return true;
        },
      ),
      { numRuns: 1500, seed: 1116 },
    );
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

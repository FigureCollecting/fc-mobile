import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  ANCHOR_FALLBACK_MM,
  AXIS_UNLOCK_PX,
  BUDGET_YAW_STEP,
  EYE_MARGIN_MM,
  EYE_MIN_MM,
  LOOK_HOLD_MS,
  PITCH,
  SPRING_MS,
  anchorDepth,
  axisGate,
  budgetCone,
  budgetSide,
  capMove,
  cone,
  eyeSpace,
  look,
  move,
  poseOf,
  resetApplies,
  resetTarget,
  shown,
  slideEye,
  springBack,
  turn,
  walk,
  withPose,
  yawLimits,
  type Pose,
} from '../casePose';
import { lensFocalPx, project, type Camera, type Vec3 } from '../caseCamera';
import { CEILING_CLEARANCE_MM, cabinetBox, roomBox, type Box } from '../caseFraming';
import { wallLayout } from '../packCabinets';
import { IKEA_DETOLF, IKEA_KLINGSBO, OPEN_STEEL_RACK } from '../cabinetPresets';

// NAV-1A (Free camera): the pose and every rule that moves it, pure (rulings S2, S6, S8, S9; spec 1.3-1.5, 2.1, 2.2, 4, 6).

const DEG = Math.PI / 180;
const FRAME = { width: 870, height: 475 };
const F = lensFocalPx(FRAME);
const camera = (pose: Pose): Camera => withPose({ x: 0, y: 0, z: 0, pitch: 0, focalPx: F, frame: FRAME }, pose);

describe('constants (rulings S6, S9; spec 1.3, 2.1)', () => {
  it('look arms after a 250 ms hold; the minor axis unlocks at 24 px; the eye keeps 100 mm off everything, 300 mm off the floor', () => {
    expect(LOOK_HOLD_MS).toBe(250);
    expect(AXIS_UNLOCK_PX).toBe(24);
    expect(EYE_MARGIN_MM).toBe(100);
    expect(EYE_MIN_MM).toBe(300);
    expect(ANCHOR_FALLBACK_MM).toBe(2000);
    expect(SPRING_MS).toBe(200);
    expect(PITCH).toEqual({ upSoft: 30 * DEG, upHard: 45 * DEG, downSoft: 45 * DEG, downHard: 70 * DEG });
  });
});

describe('poseOf / withPose', () => {
  it('a camera\'s pose is its eye, yaw (0 when none) and pitch; the pose put back on a camera keeps its lens and frame', () => {
    const cam: Camera = { x: 1, y: 2, z: 3, pitch: 0.1, focalPx: 400, frame: FRAME };
    expect(poseOf(cam)).toEqual({ x: 1, y: 2, z: 3, yaw: 0, pitch: 0.1 });
    expect(poseOf({ ...cam, yaw: -0.2 })).toEqual({ x: 1, y: 2, z: 3, yaw: -0.2, pitch: 0.1 });
    expect(withPose(cam, { x: 9, y: 8, z: 7, yaw: 0.3, pitch: -0.4 })).toEqual({ x: 9, y: 8, z: 7, yaw: 0.3, pitch: -0.4, focalPx: 400, frame: FRAME });
  });
});

describe('MOVE (spec 2.1): truck along the camera\'s right, pedestal along world y; the aim travels, yaw and pitch kept', () => {
  it('the world point at the anchor depth stays under the finger, at any yaw and pitch', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -60 * DEG, max: 60 * DEG, noNaN: true }),
        fc.double({ min: -45 * DEG, max: 45 * DEG, noNaN: true }),
        fc.double({ min: -300, max: 300, noNaN: true }),
        fc.double({ min: 500, max: 5000, noNaN: true }),
        (yaw, pitch, dx, d) => {
          const pose: Pose = { x: 100, y: 1200, z: 2500, yaw, pitch };
          // the point on the camera's axis at depth d draws at the frame centre; a sideways drag carries it with the finger
          const cam = camera(pose);
          const fwd: Vec3 = [Math.cos(pitch) * Math.sin(yaw), -Math.sin(pitch), -Math.cos(pitch) * Math.cos(yaw)];
          const p: Vec3 = [pose.x + fwd[0] * d, pose.y + fwd[1] * d, pose.z + fwd[2] * d];
          expect(project(cam, p).x).toBeCloseTo(FRAME.width / 2, 6);
          const moved = move(pose, dx, 0, d, F);
          expect(moved.yaw).toBe(yaw);
          expect(moved.pitch).toBe(pitch);
          expect(moved.y).toBe(pose.y);
          expect(project(camera(moved), p).x).toBeCloseTo(FRAME.width / 2 + dx, 6);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('a finger moving down raises the eye by dy d / (f cos pitch): a level camera\'s anchor point follows the finger', () => {
    const pose: Pose = { x: 0, y: 1000, z: 2000, yaw: 0.3, pitch: 0 };
    const moved = move(pose, 0, 40, 2000, F);
    expect(moved.y).toBeCloseTo(1000 + (40 * 2000) / F, 9);
    expect([moved.x, moved.z, moved.yaw, moved.pitch]).toEqual([pose.x, pose.z, pose.yaw, pose.pitch]);
    const tilted = move({ ...pose, pitch: 60 * DEG }, 0, 40, 2000, F);
    expect(tilted.y - 1000).toBeCloseTo((40 * 2000) / (F * 0.5), 6);
  });
});

describe('LOOK (spec 2.2): the picture follows the finger', () => {
  it('finger right turns the eye left; finger down looks up', () => {
    const pose: Pose = { x: 0, y: 1000, z: 2000, yaw: 0.1, pitch: 0.05 };
    const right = look(pose, 0, 0, 0.2, 0);
    expect(right.yaw).toBeCloseTo(0.1 - Math.atan(0.2), 12);
    expect(right.pitch).toBe(0.05);
    const down = look(pose, 0.1, 0.1, 0.1, -0.1);
    expect(down.yaw).toBe(0.1);
    expect(down.pitch).toBeCloseTo(0.05 - 2 * Math.atan(0.1), 12);
    expect([down.x, down.y, down.z]).toEqual([0, 1000, 2000]);
  });

  it('the point under the finger at the press stays under it, across the frame (a level camera, sideways)', () => {
    const pose: Pose = { x: 0, y: 1000, z: 2000, yaw: 0, pitch: 0 };
    const p: Vec3 = [-300, 1000, 0];
    const at = project(camera(pose), p);
    const a0 = (at.x - FRAME.width / 2) / F;
    for (const sx of [100, 435, 700]) {
      const turned = look(pose, a0, 0, (sx - FRAME.width / 2) / F, 0);
      expect(project(camera(turned), p).x).toBeCloseTo(sx, 6);
    }
  });
});

describe('the realism cone (rulings S8)', () => {
  it('soft = clamp(70 deg - h/2, 20, 45); hard = min(soft + 15, 60)', () => {
    const near = (a: number, b: number) => expect(a).toBeCloseTo(b * DEG, 9);
    let l = yawLimits(60.6 * DEG);
    near(l.soft, 39.7);
    near(l.hard, 54.7);
    l = yawLimits(79.1 * DEG);
    near(l.soft, 30.45);
    near(l.hard, 45.45);
    // a long lens's narrow view: at most 45 soft, 60 hard; a very wide one at least 20 soft
    l = yawLimits(10 * DEG);
    near(l.soft, 45);
    near(l.hard, 60);
    l = yawLimits(120 * DEG);
    near(l.soft, 20);
    near(l.hard, 35);
  });

  it('Classic: the hard limit is at most the drawn-cabinet cap, and the soft one at most the hard', () => {
    expect(yawLimits(60.6 * DEG, 50 * DEG).hard).toBeCloseTo(50 * DEG, 12);
    expect(yawLimits(60.6 * DEG, 50 * DEG).soft).toBeCloseTo(39.7 * DEG, 9);
    expect(yawLimits(60.6 * DEG, 30 * DEG)).toEqual({ soft: 30 * DEG, hard: 30 * DEG });
    expect(yawLimits(60.6 * DEG, 90 * DEG).hard).toBeCloseTo(54.7 * DEG, 9);
  });

  it('shown past the soft limit approaches the hard one and never reaches it', () => {
    expect(shown(0, 0.5, 0.8)).toBe(0.5);
    expect(shown(-1, 0.5, 0.8)).toBe(0.5);
    expect(shown(0.3, 0.5, 0.8)).toBeCloseTo(0.5 + 0.3 * (1 - Math.exp(-1)), 12);
    expect(shown(3, 0.5, 0.8)).toBeLessThan(0.8);
    expect(shown(3, 0.5, 0.8)).toBeGreaterThan(0.79);
    // no room past the soft limit (the Classic cap at it): the soft limit
    expect(shown(1, 0.5, 0.5)).toBe(0.5);
  });

  it('cone: inside the soft limits the raw value both ways; past them committed at the limit, shown rubber-banded', () => {
    expect(cone(0.2, -0.5, 0.6, -0.7, 0.9)).toEqual({ committed: 0.2, shown: 0.2, past: false });
    const hi = cone(0.8, -0.5, 0.6, -0.7, 0.9);
    expect(hi.committed).toBe(0.6);
    expect(hi.shown).toBeCloseTo(shown(0.2, 0.6, 0.9), 12);
    expect(hi.past).toBe(true);
    const lo = cone(-0.9, -0.5, 0.6, -0.7, 0.9);
    expect(lo.committed).toBe(-0.5);
    expect(lo.shown).toBeCloseTo(-shown(0.4, 0.5, 0.7), 12);
    expect(lo.past).toBe(true);
  });

  it('turn: a look from a pose, both axes through their cones; the committed pose never past soft, the shown never at hard', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -2, max: 2, noNaN: true }),
        fc.double({ min: -2, max: 2, noNaN: true }),
        fc.double({ min: -2, max: 2, noNaN: true }),
        fc.double({ min: -2, max: 2, noNaN: true }),
        (a0, b0, a1, b1) => {
          const yaw = yawLimits(79.1 * DEG);
          const start: Pose = { x: 0, y: 1000, z: 2000, yaw: 0.2, pitch: -0.1 };
          const t = turn(start, a0, b0, a1, b1, yaw);
          expect(Math.abs(t.committed.yaw)).toBeLessThanOrEqual(yaw.soft);
          expect(Math.abs(t.shown.yaw)).toBeLessThan(yaw.hard);
          expect(t.committed.pitch).toBeLessThanOrEqual(PITCH.downSoft);
          expect(t.committed.pitch).toBeGreaterThanOrEqual(-PITCH.upSoft);
          expect(t.shown.pitch).toBeLessThan(PITCH.downHard);
          expect(t.shown.pitch).toBeGreaterThan(-PITCH.upHard);
          expect([t.shown.x, t.shown.y, t.shown.z]).toEqual([0, 1000, 2000]);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('turn: a look that starts past a limit (the limits narrowed since) is never pulled back to it', () => {
    const yaw = yawLimits(79.1 * DEG);
    const start: Pose = { x: 0, y: 1000, z: 2000, yaw: yaw.soft + 0.1, pitch: PITCH.downSoft + 0.05 };
    const t = turn(start, 0, 0, 0, 0, yaw);
    expect(t.committed).toEqual(start);
    expect(t.shown).toEqual(start);
    expect(t.past).toBe(false);
    // and a look further out is the rubber band from where it began
    expect(turn(start, 0, 0, -0.1, 0, yaw).committed.yaw).toBe(start.yaw);
  });

  it('springBack: eases out from the shown value to the committed one in SPRING_MS, at once when it is over', () => {
    expect(springBack(1, 0, 0)).toBe(1);
    expect(springBack(1, 0, SPRING_MS / 2)).toBeCloseTo(0.125, 12);
    expect(springBack(1, 0, SPRING_MS)).toBe(0);
    expect(springBack(1, 0, 10 * SPRING_MS)).toBe(0);
  });
});

describe('collision (spec 1.3, 6.4): clamp and slide', () => {
  const room: Box = { x0: -1000, x1: 1000, y0: 300, y1: 2000, z0: -500, z1: 3000 };
  const cab: Box = { x0: -200, x1: 200, y0: 0, y1: 1500, z0: -400, z1: 0 };

  it('a penetrating axis stops at the face; the others keep moving (a drag along a front slides along it)', () => {
    // from in front of the cabinet, diagonally into it: z stops at its grown front, x goes on
    expect(slideEye([0, 1000, 500], [150, 1000, -100], room, [cab], 100)).toEqual([150, 1000, 100]);
    // straight down onto its grown top
    expect(slideEye([0, 1700, -200], [0, 1000, -200], room, [cab], 100)).toEqual([0, 1600, -200]);
    // into its side along x
    expect(slideEye([-800, 1000, -200], [0, 1000, -200], room, [cab], 100)).toEqual([-300, 1000, -200]);
    // from the other side
    expect(slideEye([800, 1000, -200], [0, 1000, -200], room, [cab], 100)).toEqual([300, 1000, -200]);
  });

  it('on a face, a move along it is free and a move into it stays', () => {
    expect(slideEye([0, 1000, 100], [100, 1000, 100], room, [cab], 100)).toEqual([100, 1000, 100]);
    expect(slideEye([0, 1000, 100], [0, 1000, 50], room, [cab], 100)).toEqual([0, 1000, 100]);
  });

  it('the room: shrunk walls and the eye-height range clamp each axis', () => {
    expect(slideEye([0, 1000, 2000], [5000, 2500, 9000], room, [], 100)).toEqual([1000, 2000, 3000]);
    expect(slideEye([0, 1000, 2000], [-5000, 0, -9000], room, [], 100)).toEqual([-1000, 300, -500]);
  });

  it('never traps and never teleports: an eye already past a bound or inside a box may move back, never further', () => {
    // under the eye range (a low shelf framing): free to rise, not pushed up, not lower
    expect(slideEye([0, 200, 2000], [0, 250, 2000], room, [], 100)).toEqual([0, 250, 2000]);
    expect(slideEye([0, 200, 2000], [0, 100, 2000], room, [], 100)).toEqual([0, 200, 2000]);
    expect(slideEye([0, 2100, 2000], [0, 2050, 2000], room, [], 100)).toEqual([0, 2050, 2000]);
    // inside a grown box: it is not a wall
    expect(slideEye([0, 1000, 50], [0, 1000, 20], room, [cab], 100)).toEqual([0, 1000, 20]);
  });

  it('eyeSpace: the room shrunk by the margin, the eye between 300 mm and the ceiling less its clearance', () => {
    const wall = wallLayout([IKEA_KLINGSBO, IKEA_KLINGSBO]);
    const r = roomBox(wall, 2438.4);
    expect(eyeSpace(r, 2438.4)).toEqual({ x0: r.x0 + 100, x1: r.x1 - 100, y0: 300, y1: 2438.4 - CEILING_CLEARANCE_MM, z0: r.zBack + 100, z1: r.zFront - 100 });
  });

  it('capMove: the whole move where it holds, else without its depth, else without its height too, else none', () => {
    const from: Vec3 = [0, 0, 0];
    const to: Vec3 = [1, 2, 3];
    expect(capMove(from, to, () => true)).toEqual([1, 2, 3]);
    expect(capMove(from, to, (p) => p[2] === 0)).toEqual([1, 2, 0]);
    expect(capMove(from, to, (p) => p[2] === 0 && p[1] === 0)).toEqual([1, 0, 0]);
    expect(capMove(from, to, (p) => p[0] === 0)).toEqual([0, 0, 0]);
  });
});

describe('collision fuzz (acceptance 11): 10,000 random MOVE and LOOK steps', () => {
  it('the eye never enters a grown cabinet box, never leaves the shrunk room or [300, ceiling - 50]; yaw never past soft (committed) or hard (shown)', () => {
    const ceiling = 2438.4;
    const wall = wallLayout([IKEA_KLINGSBO, IKEA_DETOLF, OPEN_STEEL_RACK, IKEA_KLINGSBO, IKEA_DETOLF]);
    const boxes = wall.cabinets.map((slot) => cabinetBox(slot, 300));
    const space = eyeSpace(roomBox(wall, ceiling), ceiling);
    const limits = yawLimits(66.1 * DEG);
    const inside = (p: Vec3, b: Box) => p[0] > b.x0 - EYE_MARGIN_MM && p[0] < b.x1 + EYE_MARGIN_MM && p[1] > b.y0 - EYE_MARGIN_MM && p[1] < b.y1 + EYE_MARGIN_MM && p[2] > b.z0 - EYE_MARGIN_MM && p[2] < b.z1 + EYE_MARGIN_MM;
    let pose: Pose = { x: wall.cabinets[2].centerMm, y: 1200, z: 2200, yaw: 0, pitch: 0 };
    const steps = fc.sample(
      fc.record({
        look: fc.boolean(),
        dx: fc.double({ min: -400, max: 400, noNaN: true }),
        dy: fc.double({ min: -400, max: 400, noNaN: true }),
        d: fc.double({ min: 50, max: 6000, noNaN: true }),
        a: fc.tuple(fc.double({ min: -1.5, max: 1.5, noNaN: true }), fc.double({ min: -1.5, max: 1.5, noNaN: true }), fc.double({ min: -1.5, max: 1.5, noNaN: true }), fc.double({ min: -1.5, max: 1.5, noNaN: true })),
      }),
      { numRuns: 10_000, seed: 1025 },
    );
    let moves = 0;
    let blocked = 0;
    for (const s of steps) {
      if (s.look) {
        const t = turn(pose, ...s.a, limits);
        expect(Math.abs(t.committed.yaw)).toBeLessThanOrEqual(limits.soft + 1e-12);
        expect(Math.abs(t.shown.yaw)).toBeLessThan(limits.hard);
        pose = t.committed;
      } else {
        const next = walk(pose, s.dx, s.dy, s.d, F, space, boxes);
        moves++;
        const free = move(pose, s.dx, s.dy, s.d, F);
        if (next.x !== free.x || next.y !== free.y || next.z !== free.z) blocked++;
        pose = next;
      }
      const eye: Vec3 = [pose.x, pose.y, pose.z];
      expect(boxes.some((b) => inside(eye, b))).toBe(false);
      expect(eye[0]).toBeGreaterThanOrEqual(space.x0);
      expect(eye[0]).toBeLessThanOrEqual(space.x1);
      expect(eye[2]).toBeGreaterThanOrEqual(space.z0);
      expect(eye[2]).toBeLessThanOrEqual(space.z1);
      expect(eye[1]).toBeGreaterThanOrEqual(EYE_MIN_MM);
      expect(eye[1]).toBeLessThanOrEqual(ceiling - CEILING_CLEARANCE_MM);
    }
    // the walk met the walls and the furniture, not only open floor
    expect(moves).toBeGreaterThan(4000);
    expect(blocked).toBeGreaterThan(100);
  });

  it('walk keeps a move the cap forbids out: without its depth, then its height, else none', () => {
    const space: Box = { x0: -1e5, x1: 1e5, y0: 300, y1: 2400, z0: -1e5, z1: 1e5 };
    const pose: Pose = { x: 0, y: 1000, z: 2000, yaw: 30 * DEG, pitch: 0 };
    const free = walk(pose, -100, 0, 2000, F, space, []);
    expect(free.z).not.toBe(pose.z);
    const held = walk(pose, -100, 0, 2000, F, space, [], (p) => p[2] <= pose.z);
    expect(held.z).toBe(pose.z);
    expect(held.x).toBe(free.x);
  });
});

describe('anchorDepth (spec 2.1): the depth of the first of the fronts (within the wall), the floor, the back wall', () => {
  const fronts = { x0: -1000, x1: 1000 };
  it('the fronts\' plane where the finger is on the wall', () => {
    const cam: Camera = { x: 0, y: 1000, z: 2000, pitch: 0, focalPx: F, frame: FRAME };
    expect(anchorDepth(cam, FRAME.width / 2, FRAME.height / 2, fronts, -800)).toBeCloseTo(2000, 9);
  });
  it('past the wall\'s end: the back wall; below the horizon short of the fronts: the floor', () => {
    const cam: Camera = { x: 5000, y: 1000, z: 2000, pitch: 0, focalPx: F, frame: FRAME };
    expect(anchorDepth(cam, FRAME.width / 2, FRAME.height / 2, fronts, -800)).toBeCloseTo(2800, 9);
    const down: Camera = { ...cam, x: 0, pitch: 60 * DEG };
    // the centre ray meets the floor at depth y / sin(pitch), short of the fronts
    expect(anchorDepth(down, FRAME.width / 2, FRAME.height / 2, fronts, -800)).toBeCloseTo(1000 / Math.sin(60 * DEG), 6);
  });
  it('nothing hit (looking up past the ceiling\'s line, no floor, no wall): 2,000 mm', () => {
    const cam: Camera = { x: 0, y: 1000, z: 2000, yaw: 0, pitch: 0, focalPx: F, frame: FRAME };
    // the eye behind the back wall's plane and looking away from the floor: nothing in front
    expect(anchorDepth({ ...cam, z: -900, pitch: -30 * DEG }, FRAME.width / 2, 0, fronts, -800)).toBe(ANCHOR_FALLBACK_MM);
  });
});

describe('axisGate (spec 2.1): the first axis locks; the minor one unlocks past 24 px and stays', () => {
  it('locked, then unlocked for good', () => {
    expect(axisGate('x', false, 30, 10)).toEqual({ unlocked: false, x: true, y: false });
    expect(axisGate('x', false, 30, 25)).toEqual({ unlocked: true, x: true, y: true });
    expect(axisGate('x', true, 30, 0)).toEqual({ unlocked: true, x: true, y: true });
    expect(axisGate('y', false, 24, 100)).toEqual({ unlocked: false, x: false, y: true });
    expect(axisGate('y', false, -25, 100)).toEqual({ unlocked: true, x: true, y: true });
  });
});

describe('Reset view (spec 4, rulings X1)', () => {
  const framing: Pose = { x: 1000, y: 1200, z: 2500, yaw: 0, pitch: 0.05 };
  it('applies past 10 deg of yaw or of pitch off the framing, or 150 mm of height or distance; never for a walk along x', () => {
    expect(resetApplies({ ...framing, x: -5000 }, framing)).toBe(false);
    expect(resetApplies({ ...framing, yaw: 10 * DEG }, framing)).toBe(false);
    expect(resetApplies({ ...framing, yaw: -10.1 * DEG }, framing)).toBe(true);
    expect(resetApplies({ ...framing, pitch: 0.05 + 10.1 * DEG }, framing)).toBe(true);
    expect(resetApplies({ ...framing, y: 1351 }, framing)).toBe(true);
    expect(resetApplies({ ...framing, y: 1349 }, framing)).toBe(false);
    expect(resetApplies({ ...framing, z: 2349 }, framing)).toBe(true);
  });
  it('resets to the framing, turned straight', () => {
    expect(resetTarget({ ...framing, yaw: 0.3 })).toEqual(framing);
  });
});

describe('the yaw budget (NAV-1A b, Ross 10-28): a turn stops at the last yaw that fits, eased like the realism cone', () => {
  const realism = yawLimits(79.1 * DEG);
  const band = realism.hard - realism.soft;

  it('budgetSide: a fit at or past the hard limit leaves the side as it is; inside it, the band moves in to end there', () => {
    expect(budgetSide(realism, realism.hard)).toEqual(realism);
    expect(budgetSide(realism, realism.hard + 0.1)).toEqual(realism);
    const fit = realism.hard - 3 * DEG;
    const side = budgetSide(realism, fit);
    expect(side.hard).toBe(fit);
    expect(side.soft).toBeCloseTo(fit - band, 12);
    // a fit inside the band's width: rests straight, the band from there to the fit
    expect(budgetSide(realism, band / 2)).toEqual({ soft: 0, hard: band / 2 });
    // nothing fits that way: no turn that way at all
    expect(budgetSide(realism, 0)).toEqual({ soft: 0, hard: 0 });
    expect(budgetSide(realism, -0.1)).toEqual({ soft: 0, hard: 0 });
    // the Classic cap's cone (soft at hard): a stop with no band, as the cone itself has there
    expect(budgetSide({ soft: 0.5, hard: 0.5 }, 0.3)).toEqual({ soft: 0.3, hard: 0.3 });
  });

  it('budgetCone: where the turn to the hard limit fits both ways, (b) never engages: the realism cone, no side of its own', () => {
    const asked: number[] = [];
    const cone = budgetCone(realism, 0, (yaw) => {
      asked.push(yaw);
      return true;
    });
    expect(cone).toEqual(realism);
    expect(cone.left).toBeUndefined();
    expect(cone.right).toBeUndefined();
    // only the two hard limits are asked
    expect(asked).toEqual([realism.hard, -realism.hard]);
  });

  it('budgetCone: the side past the ceiling ends at the last yaw that fits (within BUDGET_YAW_STEP); the other side keeps the cone', () => {
    const limit = 37.3 * DEG;
    const cone = budgetCone(realism, 0, (yaw) => yaw <= limit);
    expect(cone.left).toBeUndefined();
    expect(cone.right!.hard).toBeLessThanOrEqual(limit);
    expect(cone.right!.hard).toBeGreaterThan(limit - BUDGET_YAW_STEP);
    expect(cone.right!.soft).toBeCloseTo(cone.right!.hard - band, 12);
    expect([cone.soft, cone.hard]).toEqual([realism.soft, realism.hard]);
    // and the left, mirrored
    const left = budgetCone(realism, 0, (yaw) => yaw >= -limit);
    expect(left.right).toBeUndefined();
    expect(left.left!.hard).toBeLessThanOrEqual(limit);
    expect(left.left!.hard).toBeGreaterThan(limit - BUDGET_YAW_STEP);
  });

  it('the boundary: a projection exactly at the ceiling fits; a hair over it does not', () => {
    const CEILING = 3;
    // a projected cost rising with a turn to the right (the dense side), exactly the ceiling at 40 deg
    const cost = (yaw: number) => 2 + Math.max(0, yaw) / (40 * DEG);
    const fits = (yaw: number) => cost(yaw) <= CEILING;
    expect(cost(40 * DEG)).toBe(CEILING);
    // the hard limit itself exactly at the ceiling: it fits, (b) never engages
    const at = { soft: 25 * DEG, hard: 40 * DEG };
    expect(budgetCone(at, 0, fits)).toEqual(at);
    // a hair past it: (b) engages that way, ending within a step under 40 deg
    const past = { soft: 25 * DEG, hard: 40 * DEG + 1e-9 };
    const cone = budgetCone(past, 0, fits);
    expect(cone.right!.hard).toBeLessThanOrEqual(40 * DEG);
    expect(cone.right!.hard).toBeGreaterThan(40 * DEG - BUDGET_YAW_STEP);
    expect(cost(cone.right!.hard)).toBeLessThanOrEqual(CEILING);
    expect(cone.left).toBeUndefined();
  });

  it('a look that starts turned searches from where it starts; one that starts where nothing fits goes no further that way', () => {
    const limit = 30 * DEG;
    const fits = (yaw: number) => yaw <= limit;
    const from = budgetCone(realism, 20 * DEG, fits);
    expect(from.right!.hard).toBeGreaterThan(limit - BUDGET_YAW_STEP);
    // started past what fits (a walk while turned, say): the side ends where it starts, and turn holds it there
    const stuck = budgetCone(realism, 35 * DEG, fits);
    expect(stuck.right!.hard).toBe(35 * DEG);
    const start: Pose = { x: 0, y: 1000, z: 2000, yaw: 35 * DEG, pitch: 0 };
    expect(turn(start, 0, 0, -0.5, 0, stuck).shown.yaw).toBe(35 * DEG);
    expect(turn(start, 0, 0, 0.5, 0, stuck).committed.yaw).toBeLessThan(35 * DEG);
    // started past the hard limit itself (a fold narrowed the cone): nothing for the budget to move in; turn holds it
    const beyond = budgetCone(realism, realism.hard + 0.05, () => false);
    expect(beyond.right).toBeUndefined();
    expect(budgetCone(realism, realism.hard + 0.05, (yaw) => yaw !== realism.hard).right).toBeUndefined();
    // a look that starts turned the other way searches this way from straight ahead
    const asked: number[] = [];
    budgetCone(realism, -10 * DEG, (yaw) => {
      asked.push(yaw);
      return yaw <= limit;
    });
    expect(asked.filter((y) => y > 0 && y < realism.hard).every((y) => y > 0)).toBe(true);
    expect(asked).toContain(0);
  });

  it('turn keeps to a budgeted side: committed never past its soft limit, shown never at its hard; the other side unchanged', () => {
    const fit = 33 * DEG;
    const limits = budgetCone(realism, 0, (yaw) => yaw <= fit);
    const start: Pose = { x: 0, y: 1000, z: 2000, yaw: 0, pitch: 0 };
    fc.assert(
      fc.property(fc.double({ min: -3, max: 3, noNaN: true }), (a1) => {
        const t = turn(start, 0, 0, a1, 0, limits);
        expect(t.committed.yaw).toBeLessThanOrEqual(limits.right!.soft);
        expect(t.shown.yaw).toBeLessThan(limits.right!.hard + 1e-12);
        expect(t.shown.yaw).toBeLessThanOrEqual(fit);
        expect(t.committed.yaw).toBeGreaterThanOrEqual(-realism.soft);
        expect(t.shown.yaw).toBeGreaterThan(-realism.hard);
      }),
      { numRuns: 300 },
    );
    // far past it: shown approaches the fit, and lets go to the band's soft limit (the cone's ease)
    const far = turn(start, 0, 0, -3, 0, limits);
    expect(far.committed.yaw).toBeCloseTo(limits.right!.soft, 12);
    expect(far.shown.yaw).toBeGreaterThan(fit - 1 * DEG);
    expect(far.past).toBe(true);
    // the left side: the realism cone's
    const left = turn(start, 0, 0, 3, 0, limits);
    expect(left.committed.yaw).toBeCloseTo(-realism.soft, 12);
  });
});

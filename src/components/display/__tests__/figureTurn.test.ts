import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { Camera } from '../caseCamera';
import {
  FIGURE_TURNS,
  FIGURE_TURN_CAP_RAD,
  FIGURE_TURN_K,
  NO_TURN_LIMITS,
  applyTurns,
  figureYaw,
  turnKey,
  turnLimits,
  turnStyle,
  type TurnBody,
  type TurnStyle,
  type TurnTarget,
} from '../figureTurn';

// NAV-FLAT (Ross 11-15): each figure turns part of the way toward where the eye STANDS (projected onto the floor), never
// where it looks, k x the angle from its front normal to the eye, capped at 25 degrees; turned less where its footprint
// would cross its surface's inner back, sides or front.

const DEG = Math.PI / 180;
const cam = (x: number, z: number, more: Partial<Camera> = {}): Camera => ({ x, y: 1300, z, pitch: 0.1, focalPx: 900, frame: { width: 870, height: 475 }, ...more });
const PIVOT = { x: 500, z: -120 };

describe('the setting', () => {
  it('off, subtle and strong are k 0, 0.5 and 0.8; the cap is 25 degrees', () => {
    expect(FIGURE_TURNS).toEqual(['off', 'subtle', 'strong']);
    expect(FIGURE_TURN_K).toEqual({ off: 0, subtle: 0.5, strong: 0.8 });
    expect(FIGURE_TURN_CAP_RAD).toBeCloseTo(25 * DEG, 12);
  });
});

describe('figureYaw: k x the angle from the front normal to where the eye stands, capped', () => {
  it('the eye straight ahead of the figure turns it not at all, at any distance and k', () => {
    for (const k of [0, 0.5, 0.8, 1]) for (const z of [10, 600, 3000]) expect(figureYaw(cam(PIVOT.x, PIVOT.z + z), PIVOT, k)).toBe(0);
  });

  it('the eye to the side turns it k x the angle toward the eye (positive toward +x, negative toward -x)', () => {
    const phi = Math.atan2(300, 1000);
    expect(figureYaw(cam(PIVOT.x + 300, PIVOT.z + 1000), PIVOT, 0.5)).toBeCloseTo(0.5 * phi, 12);
    expect(figureYaw(cam(PIVOT.x + 300, PIVOT.z + 1000), PIVOT, 0.8)).toBeCloseTo(0.8 * phi, 12);
    expect(figureYaw(cam(PIVOT.x - 300, PIVOT.z + 1000), PIVOT, 0.5)).toBeCloseTo(-0.5 * phi, 12);
  });

  it('caps at 25 degrees either way, however far to the side the eye stands', () => {
    // 60 degrees off the normal: 30 at subtle, 48 at strong, both capped
    const side = Math.tan(60 * DEG) * 1000;
    expect(figureYaw(cam(PIVOT.x + side, PIVOT.z + 1000), PIVOT, 0.5)).toBeCloseTo(FIGURE_TURN_CAP_RAD, 12);
    expect(figureYaw(cam(PIVOT.x - side, PIVOT.z + 1000), PIVOT, 0.8)).toBeCloseTo(-FIGURE_TURN_CAP_RAD, 12);
    // just under the cap is not capped: 49 degrees off at k 0.5
    const under = Math.tan(49 * DEG) * 1000;
    expect(figureYaw(cam(PIVOT.x + under, PIVOT.z + 1000), PIVOT, 0.5)).toBeCloseTo(24.5 * DEG, 12);
    fc.assert(
      fc.property(fc.double({ min: -1e5, max: 1e5, noNaN: true }), fc.double({ min: -1e5, max: 1e5, noNaN: true }), fc.constantFrom(0.5, 0.8), (x, z, k) => {
        expect(Math.abs(figureYaw(cam(x, z), PIVOT, k))).toBeLessThanOrEqual(FIGURE_TURN_CAP_RAD + 1e-12);
      }),
    );
  });

  it('turning the head only (the camera\'s yaw and pitch, the eye still) turns nothing', () => {
    const eye = cam(PIVOT.x + 420, PIVOT.z + 900);
    const yaw = figureYaw(eye, PIVOT, 0.5);
    expect(yaw).not.toBe(0);
    for (const turn of [-0.6, -0.1, 0.25, 0.6]) {
      for (const pitch of [-0.3, 0, 0.4]) {
        const looking: Camera = { ...eye, yaw: turn, pitch };
        expect(figureYaw(looking, PIVOT, 0.5)).toBe(yaw);
      }
    }
    // nor does the eye's height: it is where the eye stands on the floor that counts
    const low: Camera = { ...eye, y: 200 };
    expect(figureYaw(low, PIVOT, 0.5)).toBe(yaw);
  });

  it('off (k 0) turns every figure 0, wherever the eye stands and however the head turns', () => {
    fc.assert(
      fc.property(fc.double({ min: -1e5, max: 1e5, noNaN: true }), fc.double({ min: -1e5, max: 1e5, noNaN: true }), fc.double({ min: -1, max: 1, noNaN: true }), (x, z, yaw) => {
        expect(Math.abs(figureYaw(cam(x, z, { yaw }), PIVOT, FIGURE_TURN_K.off))).toBe(0);
      }),
    );
  });

  it('the figure\'s own limits cut its turn each way, never past the cap', () => {
    const right = cam(PIVOT.x + 2000, PIVOT.z + 500);
    const left = cam(PIVOT.x - 2000, PIVOT.z + 500);
    const limits = { left: 3 * DEG, right: 7 * DEG };
    expect(figureYaw(right, PIVOT, 0.8, limits)).toBeCloseTo(7 * DEG, 12);
    expect(figureYaw(left, PIVOT, 0.8, limits)).toBeCloseTo(-3 * DEG, 12);
    expect(figureYaw(right, PIVOT, 0.8, { left: 1, right: 1 })).toBeCloseTo(FIGURE_TURN_CAP_RAD, 12);
    expect(figureYaw(right, PIVOT, 0.8, { left: 0, right: 0 })).toBe(0);
    // within its limits, the rule as it is
    const near = cam(PIVOT.x + 50, PIVOT.z + 1000);
    expect(figureYaw(near, PIVOT, 0.5, limits)).toBeCloseTo(0.5 * Math.atan2(50, 1000), 12);
  });
});

/** A 200 x 100 mm footprint behind its plane, its art as wide as it, turning about its plane's centre at (0, 0). */
const body = (more: Partial<TurnBody> = {}): TurnBody => ({ x: 0, z: 0, widthMm: 200, depthMm: 100, artLeftMm: -100, artRightMm: 100, ...more });
const OPEN = { x0: -1e4, x1: 1e4, zBack: -1e4, zFront: 1e4 };

/** The turned corners of a body (footprint and art ends), world mm, as the scene turns them. */
function corners(b: TurnBody, yaw: number): [number, number][] {
  const pts: [number, number][] = [
    [-b.widthMm / 2, 0],
    [b.widthMm / 2, 0],
    [-b.widthMm / 2, -b.depthMm],
    [b.widthMm / 2, -b.depthMm],
    [b.artLeftMm, 0],
    [b.artRightMm, 0],
  ];
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return pts.map(([u, n]) => [b.x + u * c + n * s, b.z - u * s + n * c]);
}
const inside = (b: TurnBody, yaw: number, box: typeof OPEN) =>
  corners(b, yaw).every(([x, z]) => x >= box.x0 - 1e-6 && x <= box.x1 + 1e-6 && z >= box.zBack - 1e-6 && z <= box.zFront + 1e-6);

describe('turnLimits: the footprint clamp (turned less, never moved)', () => {
  it('room all round: the cap each way', () => {
    expect(turnLimits(body(), OPEN)).toEqual({ left: FIGURE_TURN_CAP_RAD, right: FIGURE_TURN_CAP_RAD });
    expect(NO_TURN_LIMITS).toEqual({ left: FIGURE_TURN_CAP_RAD, right: FIGURE_TURN_CAP_RAD });
  });

  it('the inner back: a back corner swinging back stops on it, both ways', () => {
    // 20 mm behind the base's back: 100 sin t + 100 cos t <= 120, t <= asin(0.6 sqrt 2) - 45 degrees
    const box = { ...OPEN, zBack: -120 };
    const t = Math.asin((120 / 100) / Math.SQRT2) - Math.PI / 4;
    const l = turnLimits(body(), box);
    expect(l.right).toBeCloseTo(t, 9);
    expect(l.left).toBeCloseTo(t, 9);
    expect(inside(body(), l.right, box)).toBe(true);
    expect(inside(body(), -l.left, box)).toBe(true);
    expect(inside(body(), l.right + 0.1 * DEG, box)).toBe(false);
    expect(inside(body(), -l.left - 0.1 * DEG, box)).toBe(false);
  });

  it('an inner side: only the turn that swings a back corner into it is cut (here a turn toward -x)', () => {
    // 10 mm to the right side: 100 cos t + 100 sin t <= 110 for a turn of t toward -x
    const box = { ...OPEN, x1: 110 };
    const t = Math.asin((110 / 100) / Math.SQRT2) - Math.PI / 4;
    const l = turnLimits(body(), box);
    expect(l.left).toBeCloseTo(t, 9);
    expect(l.right).toBe(FIGURE_TURN_CAP_RAD);
    expect(inside(body(), -l.left, box)).toBe(true);
    expect(inside(body(), -l.left - 0.1 * DEG, box)).toBe(false);
    // mirrored: the left side cuts the turn toward +x
    const m = turnLimits(body(), { ...OPEN, x0: -110 });
    expect(m.right).toBeCloseTo(t, 9);
    expect(m.left).toBe(FIGURE_TURN_CAP_RAD);
  });

  it('the surface\'s front: a front corner swinging forward stops on it (the base stays on the shelf)', () => {
    const box = { ...OPEN, zFront: 30 };
    const t = Math.asin(30 / 100);
    const l = turnLimits(body(), box);
    expect(l.right).toBeCloseTo(t, 9);
    expect(l.left).toBeCloseTo(t, 9);
    expect(inside(body(), l.right, box)).toBe(true);
    expect(inside(body(), l.right + 0.1 * DEG, box)).toBe(false);
  });

  it('art wider than the footprint is held to the same box', () => {
    const wide = body({ artLeftMm: -100, artRightMm: 150 });
    const box = { ...OPEN, zFront: 30 };
    const l = turnLimits(wide, box);
    // turning toward -x swings the right end of the art forward: 150 sin t <= 30
    expect(l.left).toBeCloseTo(Math.asin(30 / 150), 9);
    expect(l.right).toBeCloseTo(Math.asin(30 / 100), 9);
    expect(inside(wide, -l.left, box)).toBe(true);
  });

  it('a footprint already over its back (a figure deeper than its shelf) never turns deeper over it: no turn either way', () => {
    expect(turnLimits(body(), { ...OPEN, zBack: -60 })).toEqual({ left: 0, right: 0 });
  });

  it('where a box edge is already crossed but a turn moves away from it, that edge does not cut the turn', () => {
    // the art pokes 5 mm past the right side unturned; any turn pulls it in (x = u cos t)
    const l = turnLimits(body({ artRightMm: 115, widthMm: 200 }), { ...OPEN, x1: 110 });
    expect(l.right).toBe(FIGURE_TURN_CAP_RAD);
  });

  it('every corner stays in the box at every turn within the limits (any body, any box it starts in)', () => {
    fc.assert(
      fc.property(
        fc.record({ w: fc.double({ min: 20, max: 300, noNaN: true }), d: fc.double({ min: 10, max: 300, noNaN: true }), inL: fc.double({ min: 0, max: 0.4, noNaN: true }), inR: fc.double({ min: 0, max: 0.4, noNaN: true }) }),
        fc.record({ l: fc.double({ min: 0, max: 80, noNaN: true }), r: fc.double({ min: 0, max: 80, noNaN: true }), back: fc.double({ min: 0, max: 200, noNaN: true }), front: fc.double({ min: 0, max: 200, noNaN: true }) }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        ({ w, d, inL, inR }, room, f) => {
          const b = body({ widthMm: w, depthMm: d, artLeftMm: -w / 2 + inL * w, artRightMm: w / 2 - inR * w });
          const box = { x0: -w / 2 - room.l, x1: w / 2 + room.r, zBack: -d - room.back, zFront: room.front };
          const l = turnLimits(b, box);
          expect(l.left).toBeGreaterThanOrEqual(0);
          expect(l.right).toBeGreaterThanOrEqual(0);
          expect(inside(b, f * l.right, box)).toBe(true);
          expect(inside(b, -f * l.left, box)).toBe(true);
        },
      ),
    );
  });
});

/** Whether two segments in the floor plane cross (their interiors or ends meet). */
function cross(a: [number, number][], b: [number, number][]): boolean {
  const o = (p: [number, number], q: [number, number], r: [number, number]) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(b[0], b[1], a[0]);
  const d2 = o(b[0], b[1], a[1]);
  const d3 = o(a[0], a[1], b[0]);
  const d4 = o(a[0], a[1], b[1]);
  if (d1 === 0 && d2 === 0) {
    // on one line: they cross only where their spans along it overlap
    const span = (s: [number, number][], i: 0 | 1) => [Math.min(s[0][i], s[1][i]), Math.max(s[0][i], s[1][i])];
    const i = Math.abs(a[1][0] - a[0][0]) >= Math.abs(a[1][1] - a[0][1]) ? 0 : 1;
    const [a0, a1] = span(a, i);
    const [b0, b1] = span(b, i);
    return a0 <= b1 && b0 <= a1;
  }
  return d1 * d2 <= 0 && d3 * d4 <= 0;
}

describe('neighbours never cut into each other', () => {
  it('two figures side by side (a 10 mm gap, art within the footprints, any depths): their turned pictures never cross, wherever the eye stands', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 30, max: 300, noNaN: true }),
        fc.double({ min: 30, max: 300, noNaN: true }),
        fc.double({ min: -100, max: 0, noNaN: true }),
        fc.double({ min: -100, max: 0, noNaN: true }),
        fc.double({ min: -3000, max: 3000, noNaN: true }),
        fc.double({ min: 50, max: 4000, noNaN: true }),
        fc.constantFrom(0.5, 0.8),
        (wa, wb, za, zb, ex, ez, k) => {
          const a = { x: 0, z: za };
          const b = { x: wa / 2 + 10 + wb / 2, z: zb };
          const ya = figureYaw(cam(ex, ez), a, k);
          const yb = figureYaw(cam(ex, ez), b, k);
          const seg = (p: { x: number; z: number }, w: number, y: number): [number, number][] => [
            [p.x - (w / 2) * Math.cos(y), p.z + (w / 2) * Math.sin(y)],
            [p.x + (w / 2) * Math.cos(y), p.z - (w / 2) * Math.sin(y)],
          ];
          expect(cross(seg(a, wa, ya), seg(b, wb, yb))).toBe(false);
        },
      ),
    );
  });
});

/** CSS's rotateY on a point (x, z): the x axis goes to (cos, -sin), the z axis to (sin, cos). */
const rotY = ([x, z]: [number, number], t: number): [number, number] => [x * Math.cos(t) + z * Math.sin(t), -x * Math.sin(t) + z * Math.cos(t)];
/** A point (scene px, x and z) through the style's rotate, then its translate, as CSS composes the two (origin 0 0 0). */
function through(style: TurnStyle, p: [number, number]): [number, number] {
  const deg = Number(/^y (-?[\d.e-]+)deg$/.exec(style.rotate)![1]);
  const [tx, ty, tz] = /^(-?[\d.e-]+)px (-?[\d.e-]+)px (-?[\d.e-]+)px$/.exec(style.translate)!.slice(1).map(Number);
  expect(ty).toBe(0);
  const [x, z] = rotY(p, deg * DEG);
  return [x + tx, z + tz];
}

describe('turnStyle: the turn about the figure\'s vertical axis, as CSS rotate and translate in the scene\'s px', () => {
  it('none at 0 (the figure drawn exactly as before, its transform untouched)', () => {
    expect(turnStyle(0, 512.5, -130, 0.75)).toBeNull();
    expect(turnStyle(-0, 512.5, -130, 0.75)).toBeNull();
    expect(turnKey(null)).toBe('');
  });

  it('about y alone, the pivot held where it is (nothing up or down), its front turned toward +x for a positive yaw', () => {
    for (const [yaw, x, z, s] of [
      [10 * DEG, 512.5, -130, 0.5],
      [-0.25 * DEG, 100, 40, 2],
      [-25 * DEG, -3000, -200, 0.31],
    ] as const) {
      const st = turnStyle(yaw, x, z, s)!;
      expect(st.rotate).toMatch(/^y -?[\d.]+deg$/);
      const pivot: [number, number] = [x * s, z * s];
      const held = through(st, pivot);
      expect(held[0]).toBeCloseTo(pivot[0], 4);
      expect(held[1]).toBeCloseTo(pivot[1], 4);
      // a point 100 px in front of the pivot swings toward +x for a positive yaw, -x for a negative one
      const front = through(st, [pivot[0], pivot[1] + 100]);
      expect(Math.sign(front[0] - pivot[0])).toBe(Math.sign(yaw));
      expect(Math.atan2(front[0] - pivot[0], front[1] - pivot[1])).toBeCloseTo(yaw, 6);
    }
    expect(turnStyle(10 * DEG, 512.5, -130, 0.5)).toEqual({ rotate: 'y 10deg', translate: expect.stringMatching(/px 0px .*px$/) });
    expect(turnKey(turnStyle(10 * DEG, 512.5, -130, 0.5))).toBe(`y 10deg|${turnStyle(10 * DEG, 512.5, -130, 0.5)!.translate}`);
  });
});

describe('applyTurns: the per-frame writer (no layout read, a write only where a turn changes)', () => {
  const target = (x: number, z: number, more: Partial<TurnTarget> = {}): TurnTarget => ({
    parts: [document.createElement('div'), document.createElement('button')],
    x,
    z,
    limits: NO_TURN_LIMITS,
    shown: '',
    ...more,
  });
  const styleOf = (t: TurnTarget) => t.parts.map((el) => [el.style.rotate, el.style.translate]);

  it('writes each figure\'s turn (its shadow and its picture alike) from where the eye stands, and only the changed ones', () => {
    const a = target(0, -100);
    const b = target(1000, -100);
    const eye = cam(0, 900);
    expect(applyTurns([a, b], eye, 0.5, 1)).toBe(1);
    expect(styleOf(a)).toEqual([['', ''], ['', '']]);
    const want = turnStyle(figureYaw(eye, b, 0.5), 1000, -100, 1)!;
    expect(styleOf(b)).toEqual([[want.rotate, want.translate], [want.rotate, want.translate]]);
    expect(b.shown).toBe(turnKey(want));
    // the same eye again: nothing to write
    expect(applyTurns([a, b], eye, 0.5, 1)).toBe(0);
    // the eye walks right: both change, a (now left of the eye) turning toward +x
    expect(applyTurns([a, b], cam(300, 900), 0.5, 1)).toBe(2);
    expect(a.parts[1].style.rotate).toMatch(/^y [\d.]+deg$/);
  });

  it('a head turn only (yaw, pitch) writes nothing', () => {
    const ts = [target(-400, -100), target(0, -100), target(600, -150)];
    applyTurns(ts, cam(100, 1200), 0.8, 0.7);
    const before = ts.map(styleOf);
    expect(applyTurns(ts, cam(100, 1200, { yaw: 0.4, pitch: -0.2 }), 0.8, 0.7)).toBe(0);
    expect(ts.map(styleOf)).toEqual(before);
  });

  it('off: every figure back to none', () => {
    const ts = [target(-400, -100), target(600, -150)];
    applyTurns(ts, cam(100, 1200), 0.8, 1);
    expect(applyTurns(ts, cam(100, 1200), 0, 1)).toBe(2);
    expect(ts.map(styleOf)).toEqual([
      [['', ''], ['', '']],
      [['', ''], ['', '']],
    ]);
    expect(ts.map((t) => t.shown)).toEqual(['', '']);
  });

  it('keeps to each figure\'s limits', () => {
    const t = target(0, -100, { limits: { left: 0, right: 2 * DEG } });
    applyTurns([t], cam(5000, 500), 0.8, 1);
    expect(t.shown).toBe(turnKey(turnStyle(2 * DEG, 0, -100, 1)));
    applyTurns([t], cam(-5000, 500), 0.8, 1);
    expect(styleOf(t)).toEqual([['', ''], ['', '']]);
  });
});

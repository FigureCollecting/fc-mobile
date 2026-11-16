import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { IKEA_DETOLF, IKEA_KLINGSBO, OPEN_STEEL_RACK } from '../cabinetPresets';
import { CEILING_DEFAULT_MM } from '../cabinetProfile';
import { boxCorners, cssSceneTransform, lensFocalPx, project, type Camera, type Vec3 } from '../caseCamera';
import { roomBox } from '../caseFraming';
import { texelScale } from '../caseCull';
import { wallLayout } from '../packCabinets';

// NAV-DEPTH-OCCL (Ross 11-15): parts of the case vanished at certain eye depths near the cabinets and came back closer.
// Chromium stops drawing parts of a preserve-3d scene when the CSS z = 0 plane (where a layer draws at its own size)
// runs through or near them, and the root's transform put that plane f / s mm in front of the eye: with s rounded up
// to a quarter octave, between the eye and the feet's front, sweeping through the fronts at the end of every band.
// The transform now scales the world about the eye (picture unchanged) so the plane stands past the room.

/** Ross's wall pattern (KLINGSBO, Detolf, open steel rack) as the fixture repeats it: 10 cabinets. */
const WALL = wallLayout(Array.from({ length: 10 }, (_, i) => [IKEA_KLINGSBO, IKEA_DETOLF, OPEN_STEEL_RACK][i % 3]));
const ROOM = roomBox(WALL, CEILING_DEFAULT_MM);
const REACH = boxCorners(ROOM.x0, ROOM.x1, 0, ROOM.y1, ROOM.zBack, ROOM.zFront);
/** What texelScale is asked for: the cabinets' room, floor to headroom, back to the front of the feet (CabinetScene). */
const SPAN = {
  y0: 0,
  y1: Math.max(...WALL.cabinets.map((c) => c.profile.outer.heightMm + 300)),
  z0: -Math.max(...WALL.cabinets.map((c) => c.profile.outer.depthMm)),
  z1: Math.max(...WALL.cabinets.map((c) => c.profile.footprint?.frontOverhangMm ?? 0)),
};
const DESKTOP = { width: 1920, height: 860 };
const FOLD8_OPEN = { width: 870, height: 475 };
const DEG = Math.PI / 180;

/** The scale about the eye the string writes (1 when none). */
function scaleOf(t: string): number {
  const m = /scale3d\(([^,]+),\s*([^,]+),\s*([^)]+)\)/.exec(t);
  if (!m) return 1;
  expect(Number(m[1])).toBe(Number(m[2]));
  expect(Number(m[1])).toBe(Number(m[3]));
  return Number(m[1]);
}

/** How far in front of the eye, along its axis, the string's CSS z = 0 plane stands: f / (k s). */
const planeDepth = (t: string, camera: Camera, s: number) => camera.focalPx / (scaleOf(t) * s);

describe('NAV-DEPTH-OCCL: the CSS z = 0 plane stands past the room', () => {
  for (const [name, frame] of [
    ['desktop 1920x860', DESKTOP],
    ['Fold8 open 870x475', FOLD8_OPEN],
  ] as const) {
    it(`${name}: the depth rocker's sweep from 3.2 m to 0.4 m never brings the plane in front of the back wall`, () => {
      // DIAG's pose: the Free camera's framing x and height, level, eye z 3200 -> 400 mm in 10 mm steps
      const focalPx = lensFocalPx(frame);
      const bad: string[] = [];
      for (let z = 3200; z >= 400; z -= 10) {
        const camera: Camera = { x: 2353.15, y: 1064.4, z, pitch: 0, yaw: 0, focalPx, frame };
        const s = texelScale(camera, SPAN);
        const plane = z - planeDepth(cssSceneTransform(camera, s, REACH), camera, s);
        // behind the back wall by at least half the room's depth seen from the eye: nothing drawn is near it
        if (!(plane < ROOM.zBack - (z - ROOM.zBack) / 2)) bad.push(`z ${z}: plane at ${plane.toFixed(0)} mm`);
      }
      expect(bad).toEqual([]);
    });
  }

  it('any eye in the room, turned and tilted: the plane is 1.5x to 3x the farthest corner, the scale a power of two', () => {
    fc.assert(
      fc.property(
        fc.record({
          x: fc.double({ min: ROOM.x0 + 100, max: ROOM.x1 - 100, noNaN: true }),
          y: fc.double({ min: 300, max: ROOM.y1 - 100, noNaN: true }),
          z: fc.double({ min: ROOM.zBack + 100, max: ROOM.zFront - 100, noNaN: true }),
          yaw: fc.double({ min: -179, max: 179, noNaN: true }),
          pitch: fc.double({ min: -60, max: 60, noNaN: true }),
          frame: fc.constantFrom(DESKTOP, FOLD8_OPEN, { width: 443, height: 454 }),
          octaves: fc.integer({ min: -24, max: 0 }),
        }),
        (c) => {
          const camera: Camera = { x: c.x, y: c.y, z: c.z, yaw: c.yaw * DEG, pitch: c.pitch * DEG, focalPx: lensFocalPx(c.frame), frame: c.frame };
          const s = 2 ** (c.octaves / 4);
          const t = cssSceneTransform(camera, s, REACH);
          const k = scaleOf(t);
          expect(Number.isInteger(Math.log2(k))).toBe(true);
          // a room nearer than a metre at its farthest (the eye at the fronts, the back wall 0.9 m on) counts as a metre
          const far = Math.max(1000, ...REACH.map((p) => project(camera, p).depth));
          const depth = planeDepth(t, camera, s);
          expect(depth).toBeGreaterThanOrEqual(1.5 * far * (1 - 1e-12));
          expect(depth).toBeLessThanOrEqual(3 * far * (1 + 1e-12));
        },
      ),
      { numRuns: 2_000 },
    );
  });

  it('with the room behind the eye (none of it ahead), the plane stands at least a metre and a half out', () => {
    const camera: Camera = { x: 0, y: 1000, z: 1000, pitch: 0, focalPx: lensFocalPx(DESKTOP), frame: DESKTOP };
    const behind: Vec3[] = boxCorners(-500, 500, 0, 2000, 1500, 2500);
    const t = cssSceneTransform(camera, 1, behind);
    expect(planeDepth(t, camera, 1)).toBeGreaterThanOrEqual(1500);
  });

  it('the scale goes about the eye: after the turn, before the camera move, so the move is still in the world px', () => {
    const camera: Camera = { x: 100, y: 1339.53, z: 1647.7, pitch: 12.8 * DEG, yaw: 10 * DEG, focalPx: 337.2, frame: { width: 443, height: 454 } };
    expect(cssSceneTransform(camera, 0.5, REACH)).toMatch(
      /^translate3d\(221\.5px, 227px, 337\.2px\) rotateX\(-12\.8000deg\) rotateY\(10\.0000deg\) scale3d\(([\d.]+), \1, \1\) translate3d\(-50\.000px, 669\.765px, -823\.850px\)$/,
    );
  });
});

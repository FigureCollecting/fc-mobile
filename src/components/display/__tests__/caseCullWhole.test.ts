import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { IKEA_DETOLF } from '../cabinetPresets';
import { project, type Camera } from '../caseCamera';
import { frameCase, frameCap, frontsOf } from '../caseFraming';
import { wallLayout } from '../packCabinets';
import { sideOverhangMm } from '../cabinetProfile';
import { frontShown, nearestCabinets, stickyPose, stickyWhole, type CullView } from '../caseCull';

// NAV-JOG: the Free camera's sticky cull (stickyPose) kept the last cull while the new frame's corners stayed inside its
// margin, but the scene draws only the cap that frame needs (frameCap), nearest its centre: a walk of a sixth of a frame,
// or a look held toward the hard yaw, then showed background where a front stood (the pose log's hole at yaw -42.5 on
// the open Fold8 turned sideways, from where a jog left the eye). stickyWhole keeps it only while it draws them all.

const DEG = Math.PI / 180;
const FRAME = { width: 657, height: 547 };
const WALL = wallLayout(Array.from({ length: 60 }, () => IKEA_DETOLF));
const HEAD = WALL.cabinets.map(() => 170);
const FRONTS = frontsOf(WALL, HEAD);
const framed = frameCase({ frame: FRAME, wall: WALL, headroomMm: HEAD, view: 'wall', focus: 30, shelf: 0, level: true });
const viewOf = (patch: Partial<Camera> = {}): CullView => ({ camera: { ...framed.camera, ...patch }, panPx: 0 });
/** What the scene draws for a cull: the cap its frame needs, the nearest that many (CabinetScene). */
const drawnFor = (view: CullView, chosen: readonly number[] = []) => nearestCabinets(view, WALL, chosen, frameCap(view.camera, WALL, FRONTS, framed.drawCap));
const shownFronts = (view: CullView) => WALL.cabinets.flatMap((slot, i) => (frontShown(view, slot) ? [i] : []));
const missing = (drawn: readonly number[], view: CullView) => shownFronts(view).filter((i) => !drawn.includes(i));

describe('frontShown: whether the frame shows a cabinet\'s front (feet to top, on the fronts\' plane)', () => {
  it('level: exactly the cabinets whose front, feet and all, spans some of the frame', () => {
    const view = viewOf();
    const expected = WALL.cabinets.flatMap((slot, i) => {
      const feet = sideOverhangMm(slot.profile);
      const x0 = project(view.camera, [slot.leftMm - feet, 0, 0]).x;
      const x1 = project(view.camera, [slot.rightMm + feet, 0, 0]).x;
      return x1 > 0 && x0 < FRAME.width ? [i] : [];
    });
    expect(expected.length).toBeGreaterThan(2);
    expect(shownFronts(view)).toEqual(expected);
  });

  it('behind the camera or off the frame: none', () => {
    expect(shownFronts(viewOf({ yaw: 180 * DEG }))).toEqual([]);
    expect(shownFronts(viewOf({ x: -50_000 }))).toEqual([]);
  });

  it('a fresh cull draws every front its frame shows (the cap is what the frame needs, fronts first)', () => {
    for (const patch of [{}, { x: framed.camera.x + 160 }, { yaw: -41 * DEG, x: framed.camera.x - 400 }, { yaw: 30 * DEG }]) {
      const view = viewOf(patch);
      expect(missing(drawnFor(view), view)).toEqual([]);
    }
  });
});

describe('stickyWhole (NAV-JOG): the last cull while it still draws every front the new frame shows', () => {
  it('the gap it closes: stickyPose keeps a cull that leaves a shown front out, walking 160 mm or looking from -37 to -41 deg', () => {
    for (const [a, b] of [
      [viewOf(), viewOf({ x: framed.camera.x + 160 })],
      [viewOf({ x: framed.camera.x - 400, yaw: -37 * DEG }), viewOf({ x: framed.camera.x - 400, yaw: -41 * DEG })],
    ]) {
      expect(stickyPose(a, b)).toBe(a);
      expect(missing(drawnFor(a), b).length).toBeGreaterThan(0);
      // stickyWhole re-culls: the new frame's own cull draws them all
      expect(stickyWhole(a, b, WALL, drawnFor(a))).toBe(b);
    }
  });

  it('while the last cull draws every front, it keeps it (a walk of 20 mm, a look of 1 deg)', () => {
    const a = viewOf();
    for (const b of [viewOf({ x: framed.camera.x + 20 }), viewOf({ yaw: 1 * DEG })]) {
      expect(missing(drawnFor(a), b)).toEqual([]);
      expect(stickyWhole(a, b, WALL, drawnFor(a))).toBe(a);
    }
  });

  it('none before, or stickyPose re-culls: the new one', () => {
    const b = viewOf({ x: framed.camera.x + 20 });
    expect(stickyWhole(null, b, WALL, [])).toBe(b);
    const far = viewOf({ x: framed.camera.x + 5000 });
    expect(stickyWhole(viewOf(), far, WALL, drawnFor(viewOf()))).toBe(far);
  });

  it('the same pose keeps it, even drawing none: a render there never asks for another', () => {
    const a = viewOf({ yaw: -10 * DEG });
    expect(stickyWhole(a, viewOf({ yaw: -10 * DEG }), WALL, [])).toBe(a);
  });

  it('fuzz: what the cull it returns draws (kept: the last drawn) takes in every front the new frame shows', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1500, max: 1500, noNaN: true }),
        fc.double({ min: -30, max: 30, noNaN: true }),
        fc.double({ min: -400, max: 400, noNaN: true }),
        fc.double({ min: -6, max: 6, noNaN: true }),
        (x, yaw, dx, dyaw) => {
          const a = viewOf({ x: framed.camera.x + x, yaw: yaw * DEG });
          const b = viewOf({ x: framed.camera.x + x + dx, yaw: (yaw + dyaw) * DEG });
          const was = drawnFor(a);
          const view = stickyWhole(a, b, WALL, was);
          const drawn = view === a ? was : drawnFor(view, was);
          expect(missing(drawn, b)).toEqual([]);
        },
      ),
      { numRuns: 400 },
    );
  });
});

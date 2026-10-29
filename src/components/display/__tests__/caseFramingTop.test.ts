import { describe, it, expect } from 'vitest';
import { IKEA_DETOLF, IKEA_KLINGSBO } from '../cabinetPresets';
import { frameMargins, project, type Vec3 } from '../caseCamera';
import { wallLayout } from '../packCabinets';
import { CEILING_DEFAULT_MM, TOP_CLEARANCE_CAP_MM, framingHeadroomMm } from '../cabinetProfile';
import { frameCase, type FramingInput } from '../caseFraming';

// NAV3-TOP (b), Ross 10-28 ("we can try b I reckon"), a trial: only the one-cabinet view stands back so the tallest
// figure on a cabinet's top shows whole; the wall view keeps the 24 in framing crop (raise or look up there).

const COVER = { width: 443, height: 454 };
const DETOLF_H = IKEA_DETOLF.outer.heightMm;

describe('framingHeadroomMm with no framing cap: what a cabinet top figure needs, up to the room', () => {
  it('the cap stays the default (24 in); passed Infinity, only the clearance binds', () => {
    expect(framingHeadroomMm(IKEA_DETOLF, 700)).toBe(TOP_CLEARANCE_CAP_MM);
    expect(framingHeadroomMm(IKEA_DETOLF, 700, CEILING_DEFAULT_MM, Infinity)).toBe(740);
    // the clearance (ceiling less the cabinet less 2 in) still binds
    expect(framingHeadroomMm(IKEA_DETOLF, 800, CEILING_DEFAULT_MM, Infinity)).toBeCloseTo(CEILING_DEFAULT_MM - DETOLF_H - 50.8, 9);
    // under the cap, nothing changes
    expect(framingHeadroomMm(IKEA_DETOLF, 300, CEILING_DEFAULT_MM, Infinity)).toBe(framingHeadroomMm(IKEA_DETOLF, 300));
    expect(framingHeadroomMm(IKEA_DETOLF, null, CEILING_DEFAULT_MM, Infinity)).toBe(framingHeadroomMm(IKEA_DETOLF, null));
  });
});

describe('frameCase with topWholeMm (NAV3-TOP b): the one-cabinet view shows the tallest top figure whole; the wall view keeps its crop', () => {
  const wall = wallLayout([IKEA_DETOLF, IKEA_KLINGSBO, IKEA_DETOLF]);
  const capped = [framingHeadroomMm(IKEA_DETOLF, 700), framingHeadroomMm(IKEA_KLINGSBO, null), framingHeadroomMm(IKEA_DETOLF, null)];
  const whole = [framingHeadroomMm(IKEA_DETOLF, 700, CEILING_DEFAULT_MM, Infinity), capped[1], capped[2]];
  const input = (o: Partial<FramingInput>): FramingInput => ({ frame: COVER, wall, headroomMm: capped, view: 'cabinet', focus: 0, shelf: 0, level: true, ...o });
  const topOf = (i: number): Vec3 => [wall.cabinets[i].centerMm, DETOLF_H + 700, 0];

  it('before (no topWholeMm): the cabinet view crops a 700 mm figure on a Detolf\'s top', () => {
    const { camera } = frameCase(input({}));
    expect(project(camera, topOf(0)).y).toBeLessThan(frameMargins(camera.frame).y - 1);
  });

  it('with it: the cabinet view stands back until the figure\'s top is inside the frame\'s margin', () => {
    const before = frameCase(input({})).camera;
    const { camera } = frameCase(input({ topWholeMm: whole }));
    expect(camera.z).toBeGreaterThan(before.z);
    expect(project(camera, topOf(0)).y).toBeGreaterThanOrEqual(frameMargins(camera.frame).y - 1e-6);
    // still straight on and level at the middle of what it frames, the feet in the frame too
    expect(camera.pitch).toBe(0);
    expect(project(camera, [wall.cabinets[0].centerMm, 0, 0]).y).toBeLessThanOrEqual(camera.frame.height - frameMargins(camera.frame).y + 1e-6);
  });

  it('a cabinet with nothing over the cap on its top frames as before', () => {
    expect(frameCase(input({ topWholeMm: whole, focus: 1 }))).toEqual(frameCase(input({ focus: 1 })));
    expect(frameCase(input({ topWholeMm: whole, focus: 2 }))).toEqual(frameCase(input({ focus: 2 })));
  });

  it('the wall and shelf views keep the crop: topWholeMm changes nothing there', () => {
    for (const view of ['wall', 'shelf'] as const) {
      expect(frameCase(input({ view, topWholeMm: whole }))).toEqual(frameCase(input({ view })));
    }
  });
});

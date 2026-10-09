import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  IN_MM,
  STANDING_EYE_MM,
  START_HEIGHT_T,
  boxCorners,
  cssSceneTransform,
  fieldOfViewDeg,
  fitDistance,
  frameMargins,
  lensFocalPx,
  pitchToward,
  project,
  startCameraY,
  unprojectToPlaneZ,
  type Camera,
} from '../caseCamera';

/** Goldens from ~/tmp/mobile-web/camera-out-v3.json (DESIGN-RECOMPUTE), Detolf outer box 430 x 370 x 1630 + 300 headroom. */
const COVER = { width: 443, height: 454 };
const DETOLF_BOX = boxCorners(-215, 215, 0, 1930, -370, 0);

function level(frame = COVER): Camera {
  return { x: 0, y: 1000, z: 1500, pitch: 0, focalPx: lensFocalPx(frame), frame };
}

describe('lens (G1, G2)', () => {
  it('a 23 mm full-frame lens on the frame diagonal: f 337.2 px on the 443 x 454 cover frame', () => {
    expect(lensFocalPx(COVER)).toBeCloseTo(337.2, 1);
    expect(lensFocalPx({ width: 412, height: 811 })).toBeCloseTo(483.6, 1);
  });

  it('on a 3:4 frame it sees 58.88 x 73.92 deg, 86.49 diagonal (G1)', () => {
    const fov = fieldOfViewDeg({ width: 300, height: 400 });
    expect(fov.h).toBeCloseTo(58.88, 2);
    expect(fov.v).toBeCloseTo(73.92, 2);
    expect(fov.d).toBeCloseTo(86.49, 2);
  });

  it('a longer lens narrows the view', () => {
    expect(lensFocalPx(COVER, 46)).toBeCloseTo(2 * lensFocalPx(COVER), 9);
  });

  it('at 60 in a 3:4 frame is 90.3 in tall (G2)', () => {
    const frame = { width: 300, height: 400 };
    const tallIn = (frame.height * 60) / lensFocalPx(frame);
    expect(tallIn).toBeCloseTo(90.3, 1);
  });
});

describe('project / unproject', () => {
  it('the look-at lands on the frame centre, level and tilted', () => {
    const cam: Camera = { ...level(), y: 1339.53, z: 1647.7, pitch: pitchToward(1339.53, 1647.7, 965, 0) };
    const p = project(cam, [0, 965, 0]);
    expect(p.x).toBeCloseTo(COVER.width / 2, 6);
    expect(p.y).toBeCloseTo(COVER.height / 2, 6);
    expect(p.depth).toBeGreaterThan(0);
  });

  it('up in the world is up on screen and right is right', () => {
    const cam = level();
    expect(project(cam, [0, 1100, 0]).y).toBeLessThan(project(cam, [0, 1000, 0]).y);
    expect(project(cam, [100, 1000, 0]).x).toBeGreaterThan(project(cam, [0, 1000, 0]).x);
  });

  it('a point behind the camera has depth <= 0', () => {
    expect(project(level(), [0, 1000, 2000]).depth).toBeLessThan(0);
  });

  it('unproject onto a plane inverts project (within 1e-6 mm) over random cameras', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 300, max: 2000, noNaN: true }),
        fc.double({ min: 400, max: 4000, noNaN: true }),
        fc.double({ min: -0.5, max: 0.5, noNaN: true }),
        fc.double({ min: -400, max: 400, noNaN: true }),
        fc.double({ min: 0, max: 1900, noNaN: true }),
        fc.double({ min: -370, max: 0, noNaN: true }),
        (camY, camZ, pitch, px, py, pz) => {
          const cam: Camera = { x: 0, y: camY, z: camZ, pitch, focalPx: 337.2, frame: COVER };
          const s = project(cam, [px, py, pz]);
          if (s.depth < 10) return;
          const back = unprojectToPlaneZ(cam, s.x, s.y, pz);
          expect(back).not.toBeNull();
          expect(back![0]).toBeCloseTo(px, 6);
          expect(back![1]).toBeCloseTo(py, 6);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('unproject is null when the ray runs parallel to the plane or meets it behind the camera', () => {
    const cam = level();
    // a level camera looking along -z never meets the plane z = camera z in front of it
    expect(unprojectToPlaneZ(cam, 100, 100, cam.z)).toBeNull();
    expect(unprojectToPlaneZ(cam, 100, 100, cam.z + 500)).toBeNull();
  });
});

describe('framing (G4, CC8 / CC15)', () => {
  it('sides keep max(16 px, 4 %) and top and bottom 12 px', () => {
    expect(frameMargins(COVER)).toEqual({ x: 17.72, y: 12 });
    expect(frameMargins({ width: 300, height: 300 })).toEqual({ x: 16, y: 12 });
  });

  it('CC15: the start camera is two-thirds of the way from level to 60 in; level above 60 in', () => {
    expect(START_HEIGHT_T).toBe(0.67);
    expect(STANDING_EYE_MM).toBe(60 * IN_MM);
    expect(startCameraY(965)).toBeCloseTo(1339.53, 2); // Detolf, 52.74 in
    expect(startCameraY(965) / IN_MM).toBeCloseTo(52.74, 2);
    expect(startCameraY(1143)).toBeCloseTo(1398.27, 2); // rack, 55.05 in
    expect(startCameraY(965, 0.6)).toBeCloseTo(1300.4, 1);
    expect(startCameraY(1524)).toBe(1524);
    expect(startCameraY(1562.5)).toBe(1562.5);
  });

  it('the Detolf, one cabinet, cover: 1647.7 mm back tilted 12.8 deg, 1513.5 mm level', () => {
    const camY = startCameraY(965);
    const tilted = fitDistance({ frame: COVER, camY, look: [0, 965, 0], tilt: true, corners: DETOLF_BOX });
    expect(tilted.distance).toBeCloseTo(1647.7, 0);
    expect((tilted.camera.pitch * 180) / Math.PI).toBeCloseTo(12.8, 1);
    const flat = fitDistance({ frame: COVER, camY: 965, look: [0, 965, 0], tilt: false, corners: DETOLF_BOX });
    expect(flat.distance).toBeCloseTo(1513.5, 0);
    expect(flat.camera.pitch).toBe(0);
  });

  it('every corner of the fitted box sits inside the margins, and one corner touches them', () => {
    const camY = startCameraY(965);
    const { camera } = fitDistance({ frame: COVER, camY, look: [0, 965, 0], tilt: true, corners: DETOLF_BOX });
    const m = frameMargins(COVER);
    let touches = false;
    for (const c of DETOLF_BOX) {
      const p = project(camera, c);
      expect(p.x).toBeGreaterThanOrEqual(m.x - 1e-3);
      expect(p.x).toBeLessThanOrEqual(COVER.width - m.x + 1e-3);
      expect(p.y).toBeGreaterThanOrEqual(m.y - 1e-3);
      expect(p.y).toBeLessThanOrEqual(COVER.height - m.y + 1e-3);
      if (Math.abs(p.y - m.y) < 0.05 || Math.abs(p.x - m.x) < 0.05 || Math.abs(COVER.height - m.y - p.y) < 0.05) touches = true;
    }
    expect(touches).toBe(true);
  });

  it('boxCorners gives the eight corners', () => {
    const c = boxCorners(0, 1, 0, 2, -3, 0);
    expect(c).toHaveLength(8);
    expect(new Set(c.map((p) => p.join(','))).size).toBe(8);
  });
});

describe('cssSceneTransform', () => {
  it('puts the camera at the perspective eye: translate to the frame centre, tilt, then move the world', () => {
    const cam: Camera = { x: 100, y: 1339.53, z: 1647.7, pitch: (12.8 * Math.PI) / 180, focalPx: 337.2, frame: COVER };
    const t = cssSceneTransform(cam, 0.5);
    expect(t).toBe('translate3d(221.5px, 227px, 337.2px) rotateX(-12.8000deg) translate3d(-50.000px, 669.765px, -823.850px)');
  });
});

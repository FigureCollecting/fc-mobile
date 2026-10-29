import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { castRay, cssSceneTransform, lensFocalPx, lookToward, pitchToward, project, rayHitPlane, unprojectToPlaneZ, type Camera, type Vec3 } from '../caseCamera';

// NAV-1A (Free camera): the camera gains a yaw (rulings R0.1, spec 1.2). With the yaw 0 or absent every output must be
// today's to the bit, which is what keeps the 28 Classic baselines and every string-matching test untouched.

/** Today's project and unprojectToPlaneZ (fc-mobile develop fe967a7), frozen: the yaw-0 oracle. */
function projectFrozen(camera: Camera, p: Vec3) {
  const dx = p[0] - camera.x;
  const dy = p[1] - camera.y;
  const dz = p[2] - camera.z;
  const sin = Math.sin(camera.pitch);
  const cos = Math.cos(camera.pitch);
  const up = dy * cos - dz * sin;
  const depth = -dy * sin - dz * cos;
  return {
    x: camera.frame.width / 2 + (camera.focalPx * dx) / depth,
    y: camera.frame.height / 2 - (camera.focalPx * up) / depth,
    depth,
  };
}

function unprojectFrozen(camera: Camera, sx: number, sy: number, planeZ: number): Vec3 | null {
  const a = (sx - camera.frame.width / 2) / camera.focalPx;
  const b = (camera.frame.height / 2 - sy) / camera.focalPx;
  const sin = Math.sin(camera.pitch);
  const cos = Math.cos(camera.pitch);
  const dirY = b * cos - sin;
  const dirZ = -b * sin - cos;
  if (Math.abs(dirZ) < 1e-12) return null;
  const t = (planeZ - camera.z) / dirZ;
  if (!(t > 0)) return null;
  return [camera.x + a * t, camera.y + dirY * t, planeZ];
}

const DEG = Math.PI / 180;
const anyNumber = fc.double({ noDefaultInfinity: true, noNaN: true, min: -1e7, max: 1e7 });
const camArb = (yaw: fc.Arbitrary<number | undefined>) =>
  fc.record({
    x: anyNumber,
    y: anyNumber,
    z: anyNumber,
    pitch: fc.double({ min: -1.5, max: 1.5, noNaN: true }),
    focalPx: fc.double({ min: 1, max: 5000, noNaN: true }),
    w: fc.integer({ min: 0, max: 4000 }),
    h: fc.integer({ min: 0, max: 4000 }),
    yaw,
  });
const toCamera = (c: { x: number; y: number; z: number; pitch: number; focalPx: number; w: number; h: number; yaw: number | undefined }): Camera => {
  const camera: Camera = { x: c.x, y: c.y, z: c.z, pitch: c.pitch, focalPx: c.focalPx, frame: { width: c.w, height: c.h } };
  return c.yaw === undefined ? camera : { ...camera, yaw: c.yaw };
};
const same = (a: unknown, b: unknown) => {
  if (a === null || b === null) return a === b;
  const xs = Object.values(a as object) as number[];
  const ys = Object.values(b as object) as number[];
  return xs.length === ys.length && xs.every((x, i) => Object.is(x, ys[i]));
};

describe('yaw 0 or absent: project and unprojectToPlaneZ are today\'s to the bit (acceptance 1)', () => {
  it('project: 10,000 random cameras and points, Object.is on every field', () => {
    fc.assert(
      fc.property(camArb(fc.constantFrom(undefined, 0, -0)), fc.tuple(anyNumber, anyNumber, anyNumber), (c, p) => {
        const camera = toCamera(c);
        expect(same(project(camera, p), projectFrozen(camera, p))).toBe(true);
      }),
      { numRuns: 10_000 },
    );
  });

  it('unprojectToPlaneZ: 10,000 random cameras, pixels and planes, Object.is on every coordinate', () => {
    fc.assert(
      fc.property(camArb(fc.constantFrom(undefined, 0, -0)), anyNumber, anyNumber, anyNumber, (c, sx, sy, planeZ) => {
        const camera = toCamera(c);
        expect(same(unprojectToPlaneZ(camera, sx, sy, planeZ), unprojectFrozen(camera, sx, sy, planeZ))).toBe(true);
      }),
      { numRuns: 10_000 },
    );
  });

  it('cssSceneTransform writes no rotateY at yaw 0 or absent: the string is today\'s', () => {
    const cam: Camera = { x: 100, y: 1339.53, z: 1647.7, pitch: 12.8 * DEG, focalPx: 337.2, frame: { width: 443, height: 454 } };
    const today = 'translate3d(221.5px, 227px, 337.2px) rotateX(-12.8000deg) translate3d(-50.000px, 669.765px, -823.850px)';
    expect(cssSceneTransform(cam, 0.5)).toBe(today);
    expect(cssSceneTransform({ ...cam, yaw: 0 }, 0.5)).toBe(today);
    expect(cssSceneTransform({ ...cam, yaw: -0 }, 0.5)).toBe(today);
  });
});

/** An independent pinhole: R = Ry(yaw) Rx(pitch) takes camera axes to the world (right, up, back = -forward). */
function pinhole(camera: Camera, p: Vec3) {
  const yaw = camera.yaw ?? 0;
  const pitch = camera.pitch;
  // Rx(-pitch) tilts the camera's forward (0, 0, -1) down for positive pitch; Ry(-yaw) turns it toward +x for positive yaw
  const rx = (v: Vec3, a: number): Vec3 => [v[0], v[1] * Math.cos(a) - v[2] * Math.sin(a), v[1] * Math.sin(a) + v[2] * Math.cos(a)];
  const ry = (v: Vec3, a: number): Vec3 => [v[0] * Math.cos(a) + v[2] * Math.sin(a), v[1], -v[0] * Math.sin(a) + v[2] * Math.cos(a)];
  const R = (v: Vec3) => ry(rx(v, -pitch), -yaw);
  const right = R([1, 0, 0]);
  const up = R([0, 1, 0]);
  const forward = R([0, 0, -1]);
  const d: Vec3 = [p[0] - camera.x, p[1] - camera.y, p[2] - camera.z];
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const depth = dot(d, forward);
  return { x: camera.frame.width / 2 + (camera.focalPx * dot(d, right)) / depth, y: camera.frame.height / 2 - (camera.focalPx * dot(d, up)) / depth, depth, forward };
}

const yawed = fc.record({
  x: fc.double({ min: -5000, max: 5000, noNaN: true }),
  y: fc.double({ min: 300, max: 2400, noNaN: true }),
  z: fc.double({ min: 200, max: 6000, noNaN: true }),
  yaw: fc.double({ min: -60 * DEG, max: 60 * DEG, noNaN: true }),
  pitch: fc.double({ min: -70 * DEG, max: 70 * DEG, noNaN: true }),
  w: fc.integer({ min: 200, max: 1600 }),
  h: fc.integer({ min: 200, max: 1000 }),
});
const yawCamera = (c: { x: number; y: number; z: number; yaw: number; pitch: number; w: number; h: number }): Camera => {
  const frame = { width: c.w, height: c.h };
  return { x: c.x, y: c.y, z: c.z, yaw: c.yaw, pitch: c.pitch, focalPx: lensFocalPx(frame), frame };
};
const worldPoint = fc.tuple(fc.double({ min: -8000, max: 8000, noNaN: true }), fc.double({ min: 0, max: 2500, noNaN: true }), fc.double({ min: -600, max: 300, noNaN: true }));

describe('yaw: project is a pinhole turned Ry(yaw) Rx(pitch) (acceptance 2)', () => {
  it('matches the independent pinhole within 1e-6 px at yaw in +-60 deg, pitch in +-70 deg', () => {
    fc.assert(
      fc.property(yawed, worldPoint, (c, p) => {
        const camera = yawCamera(c);
        const want = pinhole(camera, p);
        const got = project(camera, p);
        expect(Math.abs(got.depth - want.depth)).toBeLessThan(1e-6);
        if (want.depth < 10) return;
        expect(Math.abs(got.x - want.x)).toBeLessThan(1e-6);
        expect(Math.abs(got.y - want.y)).toBeLessThan(1e-6);
      }),
      { numRuns: 2_000 },
    );
  });

  it('positive yaw turns the camera right, toward +x; roll never exists (world up stays up on screen)', () => {
    const frame = { width: 400, height: 400 };
    const cam: Camera = { x: 0, y: 1000, z: 2000, yaw: 30 * DEG, pitch: 0, focalPx: lensFocalPx(frame), frame };
    // the point straight ahead lies right of the camera's x
    const ahead: Vec3 = [2000 * Math.tan(30 * DEG), 1000, 0];
    expect(project(cam, ahead).x).toBeCloseTo(200, 6);
    // a vertical line stays vertical on screen at the frame centre column
    expect(project(cam, [ahead[0], 1500, 0]).x).toBeCloseTo(200, 6);
  });

  it('castRay inverts project: the ray through a projected point passes through it (1e-6 mm), at unit depth', () => {
    fc.assert(
      fc.property(yawed, worldPoint, (c, p) => {
        const camera = yawCamera(c);
        const s = project(camera, p);
        if (s.depth < 10) return;
        const ray = castRay(camera, s.x, s.y);
        expect(ray.origin).toEqual([camera.x, camera.y, camera.z]);
        // the ray's direction has unit depth: the point lies at t = its depth
        for (let k = 0; k < 3; k++) expect(Math.abs(ray.origin[k] + ray.dir[k] * s.depth - p[k])).toBeLessThan(1e-6);
        // and rayHitPlane finds it on the plane through it, for each axis the ray is not parallel to
        for (const axis of ['x', 'y', 'z'] as const) {
          const k = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
          if (Math.abs(ray.dir[k]) < 1e-3) continue;
          const hit = rayHitPlane(ray, axis, p[k]);
          expect(hit).not.toBeNull();
          expect(hit!.at[k]).toBe(p[k]);
          expect(Math.abs(hit!.t - s.depth)).toBeLessThan(1e-6 * Math.max(1, s.depth));
          for (let j = 0; j < 3; j++) expect(Math.abs(hit!.at[j] - p[j])).toBeLessThan(1e-6 * Math.max(1, s.depth));
        }
      }),
      { numRuns: 2_000 },
    );
  });

  it('rayHitPlane is null for a ray parallel to the plane or meeting it behind the camera', () => {
    const ray = { origin: [0, 1000, 2000] as Vec3, dir: [0.2, 0, -1] as Vec3 };
    expect(rayHitPlane(ray, 'y', 0)).toBeNull();
    expect(rayHitPlane(ray, 'z', 3000)).toBeNull();
    expect(rayHitPlane(ray, 'z', 0)).toEqual({ at: [400, 1000, 0], t: 2000 });
  });

  it('the yawed unprojectToPlaneZ meets the plane where the pixel draws', () => {
    const frame = { width: 600, height: 400 };
    const cam: Camera = { x: 100, y: 1200, z: 1800, yaw: -25 * DEG, pitch: 10 * DEG, focalPx: lensFocalPx(frame), frame };
    const hit = unprojectToPlaneZ(cam, 123, 321, 0)!;
    const back = project(cam, hit);
    expect(back.x).toBeCloseTo(123, 6);
    expect(back.y).toBeCloseTo(321, 6);
  });
});

/** CSS Transforms 2: the matrices of translate3d, rotateX and rotateY, and a point through a perspective about the frame centre. */
function cssOracle(transform: string, focalPx: number, frame: { width: number; height: number }, p: Vec3, s: number) {
  type M = number[][];
  const mul = (a: M, b: M): M => a.map((row) => b[0].map((_, j) => row.reduce((acc, v, k) => acc + v * b[k][j], 0)));
  const I = (): M => [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
  let m = I();
  for (const [, fn, args] of transform.matchAll(/(\w+)\(([^)]*)\)/g)) {
    const v = args.split(',').map((a) => parseFloat(a));
    const t = I();
    if (fn === 'translate3d') [t[0][3], t[1][3], t[2][3]] = v;
    else {
      const a = (v[0] * Math.PI) / 180;
      const [c, sn] = [Math.cos(a), Math.sin(a)];
      if (fn === 'rotateX') [t[1][1], t[1][2], t[2][1], t[2][2]] = [c, -sn, sn, c];
      else if (fn === 'rotateY') [t[0][0], t[0][2], t[2][0], t[2][2]] = [c, sn, -sn, c];
      else throw new Error(fn);
    }
    m = mul(m, t);
  }
  // the world authored at s px per mm: (x s, -y s, z s)
  const q = mul(m, [[p[0] * s], [-p[1] * s], [p[2] * s], [1]]).map((r) => r[0]);
  // perspective(f) about the frame centre: the eye f in front of the z = 0 plane
  const k = focalPx / (focalPx - q[2]);
  return { x: frame.width / 2 + (q[0] - frame.width / 2) * k, y: frame.height / 2 + (q[1] - frame.height / 2) * k };
}

describe('cssSceneTransform with yaw: the browser\'s matrices draw where project says (the sign of rotateY)', () => {
  it('a turned, tilted camera: every point of a random set within 0.01 px of project', () => {
    fc.assert(
      fc.property(yawed, worldPoint, fc.constantFrom(1, 0.5, 0.125), (c, p, s) => {
        const camera = yawCamera(c);
        const want = project(camera, p);
        const w = camera.frame.width;
        const h = camera.frame.height;
        if (want.depth < 200 || want.x < -w || want.x > 2 * w || want.y < -h || want.y > 2 * h) return;
        const t = cssSceneTransform(camera, s);
        if (camera.yaw !== 0) expect(t).toMatch(/rotateX\([^)]*\) rotateY\([^)]*\) translate3d/);
        const got = cssOracle(t, camera.focalPx, camera.frame, p, s);
        // the string rounds the angles to 1e-4 deg and the move to 1e-3 px: well under 0.05 px here
        expect(Math.abs(got.x - want.x)).toBeLessThan(0.05);
        expect(Math.abs(got.y - want.y)).toBeLessThan(0.05);
      }),
      { numRuns: 500 },
    );
  });
});

describe('lookToward', () => {
  it('the yaw and pitch that aim the camera at a point: it then lands on the frame centre', () => {
    fc.assert(
      fc.property(yawed, fc.tuple(fc.double({ min: -3000, max: 3000, noNaN: true }), fc.double({ min: 0, max: 2400, noNaN: true })), (c, [px, py]) => {
        const camera = yawCamera(c);
        const point: Vec3 = [camera.x + px, py, camera.z - 500 - Math.abs(px)];
        const { yaw, pitch } = lookToward([camera.x, camera.y, camera.z], point);
        const s = project({ ...camera, yaw, pitch }, point);
        expect(s.x).toBeCloseTo(camera.frame.width / 2, 6);
        expect(s.y).toBeCloseTo(camera.frame.height / 2, 6);
        expect(s.depth).toBeGreaterThan(0);
      }),
      { numRuns: 500 },
    );
  });

  it('straight in front, it is pitchToward with no yaw', () => {
    const { yaw, pitch } = lookToward([0, 1339.53, 1647.7], [0, 965, 0]);
    expect(yaw).toBe(0);
    expect(pitch).toBeCloseTo(pitchToward(1339.53, 1647.7, 965, 0), 12);
  });
});

/**
 * The case camera (case-cabinet-design v3, camera-out-v3.json): one pinhole
 * camera over a millimetre world. World axes: x to the right, y up (the room
 * floor is y = 0), z toward the viewer; every cabinet's front plane is z = 0.
 *
 * A camera is a POSITION, a PITCH (TILT: it looks down at its look-at, Ross
 * CC10 "try just tilt first"), a LENS (23 mm full-frame equivalent on the
 * frame diagonal, calibrated on Ross's photos 2026-09-27) and the FRAME it
 * draws into, in CSS px. Pure maths: no DOM. The renderer feeds the same
 * numbers to CSS 3D (cssSceneTransform), whose perspective divide is this
 * projection exactly, and the tap hit test inverts it (unprojectToPlaneZ).
 */

export const IN_MM = 25.4;
/** The calibrated lens (Ross 2026-09-27). */
export const LENS_MM = 23;
/** A full-frame sensor's diagonal, hypot(36, 24) mm, as the design rounds it. */
export const FULL_FRAME_DIAGONAL_MM = 43.267;
/** 60 in: a standing eye (CC8 / CC15). Exact, never rounded. */
export const STANDING_EYE_MM = 60 * IN_MM;
/** CC15 (Ross 2026-10-09): the start camera stands two-thirds of the way from level with the look-at to 60 in. */
export const START_HEIGHT_T = 0.67;

export type Vec3 = readonly [number, number, number];

export interface Frame {
  readonly width: number;
  readonly height: number;
}

export interface Camera {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Radians the camera looks down (positive) or up (negative). */
  readonly pitch: number;
  /** NAV-1A (Free camera): radians the camera is turned about world y; positive turns right, toward +x. Absent = 0. Roll never exists. */
  readonly yaw?: number;
  readonly focalPx: number;
  readonly frame: Frame;
}

/** f = hypot(w, h) x lens / 43.267 (camera-out-v3 rules.lens). */
export function lensFocalPx(frame: Frame, lensMm: number = LENS_MM): number {
  return (Math.hypot(frame.width, frame.height) * lensMm) / FULL_FRAME_DIAGONAL_MM;
}

const deg = (rad: number) => (rad * 180) / Math.PI;

/** Horizontal, vertical and diagonal field of view in degrees. */
export function fieldOfViewDeg(frame: Frame, lensMm: number = LENS_MM): { h: number; v: number; d: number } {
  const f = lensFocalPx(frame, lensMm);
  return {
    h: deg(2 * Math.atan(frame.width / 2 / f)),
    v: deg(2 * Math.atan(frame.height / 2 / f)),
    d: deg(2 * Math.atan(Math.hypot(frame.width, frame.height) / 2 / f)),
  };
}

export interface ScreenPoint {
  /** CSS px from the frame's left edge. */
  readonly x: number;
  /** CSS px from the frame's top edge. */
  readonly y: number;
  /** Distance along the camera axis, mm; at or below 0 the point is behind the camera. */
  readonly depth: number;
}

/**
 * Camera axes, yaw y and pitch p: right (cos y, 0, sin y); up (sin p sin y, cos p, -sin p cos y); forward (cos p sin y,
 * -sin p, -cos p cos y). The offset is turned about world y first, then tilted as before; at yaw 0 (or none) it is not
 * touched, so every output is the unturned camera's to the bit.
 */
export function project(camera: Camera, p: Vec3): ScreenPoint {
  let dx = p[0] - camera.x;
  const dy = p[1] - camera.y;
  let dz = p[2] - camera.z;
  if (camera.yaw) [dx, dz] = turned(camera.yaw, dx, dz);
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

/** An offset (dx, dz) in the world as the camera turned `yaw` sees it: its right and back components. */
function turned(yaw: number, dx: number, dz: number): [number, number] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [dx * c + dz * s, dz * c - dx * s];
}

/** A ray from the eye: origin + t dir, t being the depth along the camera's axis (dir has unit depth). */
export interface Ray {
  readonly origin: Vec3;
  readonly dir: Vec3;
}

/** The ray through screen (sx, sy): right * a + up * b + forward, a and b the pixel's offsets from the centre over f. */
export function castRay(camera: Camera, sx: number, sy: number): Ray {
  const a = (sx - camera.frame.width / 2) / camera.focalPx;
  const b = (camera.frame.height / 2 - sy) / camera.focalPx;
  const sin = Math.sin(camera.pitch);
  const cos = Math.cos(camera.pitch);
  const dirY = b * cos - sin;
  // the unturned camera's x and z, which the turn then carries round world y
  const back = -b * sin - cos;
  const [dirX, dirZ] = camera.yaw ? turned(-camera.yaw, a, back) : [a, back];
  return { origin: [camera.x, camera.y, camera.z], dir: [dirX, dirY, dirZ] };
}

const AXES = { x: 0, y: 1, z: 2 } as const;

/** Where the ray meets the plane `axis` = value in front of the eye (the point, exact on the plane, and its depth t); null when it never does. */
export function rayHitPlane(ray: Ray, axis: keyof typeof AXES, value: number): { at: Vec3; t: number } | null {
  const k = AXES[axis];
  if (Math.abs(ray.dir[k]) < 1e-12) return null;
  const t = (value - ray.origin[k]) / ray.dir[k];
  if (!(t > 0)) return null;
  const at = [0, 1, 2].map((j) => (j === k ? value : ray.origin[j] + ray.dir[j] * t)) as unknown as Vec3;
  return { at, t };
}

/**
 * The world point on the plane z = planeZ that draws at screen (sx, sy): the
 * tap hit test's inverse of project. null when the ray through that pixel
 * never meets the plane in front of the camera.
 */
export function unprojectToPlaneZ(camera: Camera, sx: number, sy: number, planeZ: number): Vec3 | null {
  return rayHitPlane(castRay(camera, sx, sy), 'z', planeZ)?.at ?? null;
}

/** NAV-1A: the yaw and pitch that aim an eye at a point (pitch positive looks down, yaw positive turns toward +x). */
export function lookToward(eye: Vec3, point: Vec3): { yaw: number; pitch: number } {
  const dx = point[0] - eye[0];
  const dz = point[2] - eye[2];
  return { yaw: Math.atan2(dx, -dz), pitch: Math.atan2(eye[1] - point[1], Math.hypot(dx, dz)) };
}

/** The pitch that aims a camera at (lookY, lookZ): positive looks down. */
export function pitchToward(camY: number, camZ: number, lookY: number, lookZ: number): number {
  return Math.atan2(camY - lookY, camZ - lookZ);
}

/** camera-out-v3 margins: sides max(16 px, 4 % of the frame width), top and bottom 12 px. */
export function frameMargins(frame: Frame): { x: number; y: number } {
  return { x: Math.max(16, Math.round(0.04 * frame.width * 100) / 100), y: 12 };
}

/** CC8 / CC15: camera y = L.y + t (60 in - L.y); level when the look-at is at or above 60 in. */
export function startCameraY(lookY: number, t: number = START_HEIGHT_T): number {
  return lookY >= STANDING_EYE_MM ? lookY : lookY + t * (STANDING_EYE_MM - lookY);
}

/** The eight corners of an axis-aligned box. */
export function boxCorners(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Vec3[] {
  const out: Vec3[] = [];
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) out.push([x, y, z]);
  return out;
}

export interface FitOptions {
  readonly frame: Frame;
  readonly camY: number;
  readonly look: Vec3;
  /** Aim at the look-at (TILT) or stay level. */
  readonly tilt: boolean;
  readonly corners: readonly Vec3[];
  readonly lensMm?: number;
}

const FIT_NEAREST_MM = 50;
const FIT_FARTHEST_MM = 100_000;

/**
 * fitTilted: the nearest horizontal distance (camera to look-at, mm) at which
 * every corner draws inside the frame margins, by bisection; the camera is
 * straight in front of the look-at, at camY.
 */
export function fitDistance(o: FitOptions): { distance: number; camera: Camera } {
  const focalPx = lensFocalPx(o.frame, o.lensMm);
  const m = frameMargins(o.frame);
  const [lx, ly, lz] = o.look;
  const make = (d: number): Camera => ({
    x: lx,
    y: o.camY,
    z: lz + d,
    pitch: o.tilt ? pitchToward(o.camY, lz + d, ly, lz) : 0,
    focalPx,
    frame: o.frame,
  });
  const inside = (d: number): boolean => {
    const cam = make(d);
    return o.corners.every((c) => {
      const p = project(cam, c);
      return p.depth > 1 && p.x >= m.x && p.x <= o.frame.width - m.x && p.y >= m.y && p.y <= o.frame.height - m.y;
    });
  };
  let lo = FIT_NEAREST_MM;
  let hi = FIT_FARTHEST_MM;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (inside(mid)) hi = mid;
    else lo = mid;
  }
  return { distance: hi, camera: make(hi) };
}

const fixed = (n: number, digits: number) => (Object.is(Math.round(n * 10 ** digits), -0) ? 0 : n).toFixed(digits);

/**
 * The CSS transform of the scene root (transform-origin 0 0 0, placed at the
 * frame's top-left) under a viewport with `perspective: focalPx` and its
 * origin at the frame centre: the world authored at pxPerMm (x * s, -y * s,
 * z * s) then draws exactly where project() says, for any s.
 */
export function cssSceneTransform(camera: Camera, pxPerMm: number): string {
  const { frame } = camera;
  return (
    `translate3d(${frame.width / 2}px, ${frame.height / 2}px, ${camera.focalPx}px) ` +
    `rotateX(${fixed(-deg(camera.pitch), 4)}deg) ` +
    // NAV-1A: the turn, written only for a turned camera so every unturned string stays as it was
    (camera.yaw ? `rotateY(${fixed(deg(camera.yaw), 4)}deg) ` : '') +
    `translate3d(${fixed(-camera.x * pxPerMm, 3)}px, ${fixed(camera.y * pxPerMm, 3)}px, ${fixed(-camera.z * pxPerMm, 3)}px)`
  );
}

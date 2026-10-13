/**
 * What the case draws (MOB-NAV-2, Ross 2026-10-13: "realistically, we could
 * limit to probably 4 or 5 cabinets drawn at a time"). Chrome rasters every
 * face of the scene, a layer under a perspective, at no less than the
 * device pixel ratio per element pixel and well past what shows, so the
 * phone's GPU tile budget is spent by what the DOM holds, not by what the
 * screen shows: the Fold8 ghosted its whole chrome when the case held some
 * hundred viewports of faces. So the case draws at most five cabinets, the
 * ones nearest the frame centre; inside them only what draws into the frame
 * and half a viewport round it (each face cut to it, nothing hidden under a
 * board); every face at the px per mm the screen shows it; and it re-culls
 * on a camera change, the margin absorbing small moves. Pure maths, no DOM.
 */
import { project, unprojectToPlaneZ, type Camera, type Frame, type Vec3 } from './caseCamera';
import type { RoomSpan } from './caseFraming';
import type { WallLayout } from './packCabinets';

/** Ross 2026-10-13: the most cabinets drawn at a time (and so on one wall page). */
export const MAX_DRAWN_CABINETS = 5;
/** What the case draws past the frame on each side, as a share of the frame: half a viewport. */
export const CULL_MARGIN = 0.5;
/** A drawn cabinet keeps its place until another draws nearer the frame centre by this share of the frame width. */
export const CABINET_HYSTERESIS = 0.1;
/** The case re-culls once the picture has moved this share of the frame width since it last did (half the margin). */
export const RECULL_SHARE = 0.25;
/** Nothing nearer the camera than this (mm along its axis) is drawn. */
export const NEAR_MM = 10;
/** The coarsest px per mm a face is drawn at. */
const TEXEL_SCALE_MIN = 1 / 64;

/** A picture: the camera and how far (CSS px) the drawn photo is slid (CC4 pan). */
export interface CullView {
  readonly camera: Camera;
  readonly panPx: number;
}

/** A rectangle in the frame's CSS px. */
export interface Rect {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
}

/** The part [s0, s1] x [t0, t1] of a face a + s u + t v (s, t in [0, 1]). */
export interface Trim {
  readonly s0: number;
  readonly s1: number;
  readonly t0: number;
  readonly t1: number;
}

/** The frame and `margin` of its size round it. */
export function cullRect(frame: Frame, margin: number = CULL_MARGIN): Rect {
  return { x0: -frame.width * margin, x1: frame.width * (1 + margin), y0: -frame.height * margin, y1: frame.height * (1 + margin) };
}

/**
 * The conditions (each >= 0) for a world point to draw inside `rect`, in front of the near plane: affine in the
 * point, as the camera's frustum planes are planes.
 */
function frustum(view: CullView, rect: Rect): ((p: Vec3) => number)[] {
  const { camera, panPx } = view;
  const sin = Math.sin(camera.pitch);
  const cos = Math.cos(camera.pitch);
  const f = camera.focalPx;
  const cx = camera.frame.width / 2 + panPx;
  const cy = camera.frame.height / 2;
  const parts = (p: Vec3) => {
    const dx = p[0] - camera.x;
    const dy = p[1] - camera.y;
    const dz = p[2] - camera.z;
    return { dx, up: dy * cos - dz * sin, depth: -dy * sin - dz * cos };
  };
  return [
    (p) => parts(p).depth - NEAR_MM,
    (p) => {
      const q = parts(p);
      return f * q.dx + (cx - rect.x0) * q.depth;
    },
    (p) => {
      const q = parts(p);
      return (rect.x1 - cx) * q.depth - f * q.dx;
    },
    (p) => {
      const q = parts(p);
      return (cy - rect.y0) * q.depth - f * q.up;
    },
    (p) => {
      const q = parts(p);
      return f * q.up + (rect.y1 - cy) * q.depth;
    },
  ];
}

type St = readonly [number, number];

/** Sutherland-Hodgman: the part of a convex polygon where the affine l(s, t) >= 0. */
function clip(poly: readonly St[], l: (s: number, t: number) => number): St[] {
  const out: St[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const lp = l(p[0], p[1]);
    const lq = l(q[0], q[1]);
    if (lp >= 0) out.push(p);
    if (lp >= 0 !== lq >= 0) {
      const k = lp / (lp - lq);
      out.push([p[0] + k * (q[0] - p[0]), p[1] + k * (q[1] - p[1])]);
    }
  }
  return out;
}

const at = (a: Vec3, u: Vec3, v: Vec3, s: number, t: number): Vec3 => [a[0] + s * u[0] + t * v[0], a[1] + s * u[1] + t * v[1], a[2] + s * u[2] + t * v[2]];

/**
 * The part of the flat face a + s u + t v that draws inside `rect` in front of the near plane: the face cut by
 * the camera's frustum through `rect` (exact, the planes meeting the face in lines), as the bounding box of what
 * is left in (s, t); null when nothing of it does.
 */
export function trimFace(view: CullView, a: Vec3, u: Vec3, v: Vec3, rect: Rect): Trim | null {
  let poly: St[] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  for (const plane of frustum(view, rect)) {
    const l0 = plane(a);
    const ls = plane(at(a, u, v, 1, 0)) - l0;
    const lt = plane(at(a, u, v, 0, 1)) - l0;
    poly = clip(poly, (s, t) => l0 + s * ls + t * lt);
    if (poly.length === 0) return null;
  }
  const ss = poly.map((p) => p[0]);
  const ts = poly.map((p) => p[1]);
  const s0 = Math.max(0, Math.min(...ss));
  const s1 = Math.min(1, Math.max(...ss));
  const t0 = Math.max(0, Math.min(...ts));
  const t1 = Math.min(1, Math.max(...ts));
  if (!(s1 > s0) || !(t1 > t0)) return null;
  return { s0, s1, t0, t1 };
}

/**
 * The cabinets drawn (by wall index, ascending): at most `cap`, those whose middle (on their front, half their
 * height up) draws nearest the frame centre; one drawn before counts `hysteresis` of the frame width nearer, so
 * a small move never swaps two cabinets back and forth. One behind the camera comes last.
 */
export function nearestCabinets(
  view: CullView,
  wall: WallLayout,
  previous: readonly number[],
  cap: number = MAX_DRAWN_CABINETS,
  hysteresis: number = CABINET_HYSTERESIS,
): number[] {
  const { camera, panPx } = view;
  const kept = new Set(previous);
  const bonus = hysteresis * camera.frame.width;
  const ranked = wall.cabinets.map((slot, i) => {
    const p = project(camera, [slot.centerMm, slot.profile.outer.heightMm / 2, 0]);
    const off = p.depth > NEAR_MM ? Math.abs(p.x + panPx - camera.frame.width / 2) : Infinity;
    return { i, d: kept.has(i) ? off - bonus : off };
  });
  ranked.sort((x, y) => x.d - y.d || x.i - y.i);
  return ranked
    .slice(0, cap)
    .map((r) => r.i)
    .sort((x, y) => x - y);
}

/**
 * The picture the case culls for: the last one it culled for while the new one only walks the camera along the
 * wall or slides the photo by less than `share` of the frame width (the margin still covers the frame), else
 * the new one.
 */
export function stickyView(previous: CullView | null, next: CullView, share: number = RECULL_SHARE): CullView {
  if (previous === null) return next;
  const a = previous.camera;
  const b = next.camera;
  if (a.y !== b.y || a.z !== b.z || a.pitch !== b.pitch || a.focalPx !== b.focalPx || a.frame.width !== b.frame.width || a.frame.height !== b.frame.height) {
    return next;
  }
  // the point on the cabinets' front the old picture drew at the frame centre, and how far the new one moved it
  const centre = unprojectToPlaneZ(a, a.frame.width / 2 - previous.panPx, a.frame.height / 2, 0);
  if (centre === null) return next;
  const moved = project(b, centre).x + next.panPx - b.frame.width / 2;
  return Math.abs(moved) < share * b.frame.width ? previous : next;
}

/**
 * The px per mm the faces are drawn at: what the screen shows at the nearest point of `span` (the cabinets'
 * room: floor to headroom, back to the front of their feet), rounded up to a half octave so a camera walking
 * the wall keeps it and nothing is drawn coarser than it shows; at most 1 (the world's own mm), at least 1/64.
 */
export function texelScale(camera: Camera, span: RoomSpan): number {
  const sin = Math.sin(camera.pitch);
  const cos = Math.cos(camera.pitch);
  const depths = [span.y0, span.y1].flatMap((y) => [span.z0, span.z1].map((z) => (camera.y - y) * sin + (camera.z - z) * cos));
  const nearest = Math.max(NEAR_MM, Math.min(...depths));
  const shown = camera.focalPx / nearest;
  if (shown >= 1) return 1;
  return Math.max(TEXEL_SCALE_MIN, 2 ** (Math.ceil(2 * Math.log2(shown)) / 2));
}

/** An opaque horizontal board: x0..x1 along the wall, z0..z1 back to front, its underside y0 and its top y1. */
export interface Board {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
  readonly z0: number;
  readonly z1: number;
}

/**
 * Whether the board hides the flat figure with these corners from the camera: the camera above the board and
 * the figure under it (or the camera under it and the figure above), every ray from the camera to a corner
 * through the board's face. Exact for a flat convex figure: what the rays to its corners meet bounds what the
 * rays to all of it do.
 */
export function hiddenUnder(camera: Camera, corners: readonly Vec3[], board: Board): boolean {
  const above = camera.y > board.y1;
  const below = camera.y < board.y0;
  if (!above && !below) return false;
  const face = above ? board.y1 : board.y0;
  return corners.every((p) => {
    if (above ? p[1] > board.y0 : p[1] < board.y1) return false;
    const t = (camera.y - face) / (camera.y - p[1]);
    const x = camera.x + t * (p[0] - camera.x);
    const z = camera.z + t * (p[2] - camera.z);
    return x >= board.x0 && x <= board.x1 && z >= board.z0 && z <= board.z1;
  });
}

/**
 * NAV-EMPTY (Ross 11-22: at the room's top or bottom, after a "zoom away", "everything just becomes the backcolor/empty
 * room until I switch to card view and back"): how much of the wall the Free camera's frame still holds, and how far a
 * Look may turn before it holds less. The drives (useFreeCamera's jogOk), the Look's cone (lookCone, into casePose's
 * spansOf) and every turn a Look commits, yaw and pitch together (keepsWall, turnKept), ask here, so none takes the wall
 * out of a frame that shows it, and a Look takes a frame that shows none no further from it. Pure maths, no DOM.
 */
import { sideOverhangMm } from './cabinetProfile';
import { castRay, rayHitPlane, type Camera } from './caseCamera';
import { frontShown } from './caseCull';
import { PITCH, type PitchCap, type Pose } from './casePose';
import type { WallLayout } from './packCabinets';

/**
 * A frame holds the wall well when a cabinet front reaches this share of the frame's width and height in from its
 * edges: at the limit a band an eighth of the frame deep still shows cabinets, not a line of one at the very edge (the
 * lowest figures stand a little above a cabinet's feet, so a front's edge alone can show none).
 */
export const WALL_KEEP_FRAME = 1 / 8;

/** How close pitchCap finds the furthest pitch that still shows the wall (radians). */
export const PITCH_CAP_STEP = (0.25 * Math.PI) / 180;

/**
 * Some cabinet's front (frontShown: feet to top, on the fronts' plane) shows in this camera's frame, `inset` of the
 * frame's width and height in from each edge (0: anywhere in the frame).
 */
export function wallShown(camera: Camera, wall: WallLayout, inset = 0): boolean {
  const { width, height } = camera.frame;
  const middle = { x0: width * inset, x1: width * (1 - inset), y0: height * inset, y1: height * (1 - inset) };
  const view = { camera, panPx: 0 };
  return wall.cabinets.some((slot) => frontShown(view, slot, middle));
}

/**
 * How well this camera's frame holds the wall, as the inset to keep to (wallShown's): WALL_KEEP_FRAME where a front
 * reaches that far in; 0 where one only shows nearer an edge (a swipe's or a fold's view: it is kept from going, never
 * pulled in); undefined where none shows (nothing to keep, so nothing is ever trapped out there).
 */
export function wallKept(camera: Camera, wall: WallLayout): number | undefined {
  if (wallShown(camera, wall, WALL_KEEP_FRAME)) return WALL_KEEP_FRAME;
  return wallShown(camera, wall) ? 0 : undefined;
}

/**
 * How far a Look from this camera may rest up (lo) and down (hi) and hold the wall as well as it does (wallKept): each
 * way, where the soft limit (PITCH) does not, the furthest pitch from the camera's toward it that does, by halving to
 * PITCH_CAP_STEP. A side whose soft limit still holds it, or that the camera is at or past already, is left out
 * (PITCH's stands); so is everything where the camera shows no front as it is.
 */
export function pitchCap(camera: Camera, wall: WallLayout): PitchCap | undefined {
  const inset = wallKept(camera, wall);
  if (inset === undefined) return undefined;
  const shows = (pitch: number) => wallShown({ ...camera, pitch }, wall, inset);
  const side = (limit: number): number | undefined => {
    const past = limit > 0 ? camera.pitch >= limit : camera.pitch <= limit;
    if (past || shows(limit)) return undefined;
    let last = camera.pitch;
    let gone = limit;
    while (Math.abs(gone - last) > PITCH_CAP_STEP) {
      const mid = (last + gone) / 2;
      if (shows(mid)) last = mid;
      else gone = mid;
    }
    return last;
  };
  const lo = side(-PITCH.upSoft);
  const hi = side(PITCH.downSoft);
  if (lo === undefined && hi === undefined) return undefined;
  return { ...(lo === undefined ? {} : { lo }), ...(hi === undefined ? {} : { hi }) };
}

/**
 * The angle (radians) from the camera's axis to the nearest point of any cabinet front (feet to top, on the fronts'
 * plane): 0 where the axis meets one. How far a frame that shows no front is turned from the wall (keepsWall); less is
 * nearer.
 */
export function wallAway(camera: Camera, wall: WallLayout): number {
  const yaw = camera.yaw ?? 0;
  const cos = Math.cos(camera.pitch);
  const ax = [cos * Math.sin(yaw), -Math.sin(camera.pitch), -cos * Math.cos(yaw)];
  const dot = (u: readonly number[], v: readonly number[]) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  /**
   * The least angle along the edge from (x0, y0) to (x1, y1) on the fronts' plane: at an end, or where the cosine
   * (A + tB) / sqrt(C + 2tD + t^2 E) along it turns, t = (BC - AD) / (AE - BD), where that is on the edge.
   */
  const edge = (x0: number, y0: number, x1: number, y1: number) => {
    const p = [x0 - camera.x, y0 - camera.y, -camera.z];
    const u = [x1 - x0, y1 - y0, 0];
    const [A, B, C, D, E] = [dot(ax, p), dot(ax, u), dot(p, p), dot(p, u), dot(u, u)];
    const cosAt = (t: number) => (A + t * B) / Math.sqrt(C + 2 * t * D + t * t * E);
    const turn = (B * C - A * D) / (A * E - B * D);
    const best = Math.max(cosAt(0), cosAt(1), turn > 0 && turn < 1 ? cosAt(turn) : -1);
    return Math.acos(Math.max(-1, Math.min(1, best)));
  };
  const hit = rayHitPlane(castRay(camera, camera.frame.width / 2, camera.frame.height / 2), 'z', 0)?.at;
  let least = Math.PI;
  for (const slot of wall.cabinets) {
    const feet = sideOverhangMm(slot.profile);
    const x0 = slot.leftMm - feet;
    const x1 = slot.rightMm + feet;
    const top = slot.profile.outer.heightMm;
    if (hit && hit[0] >= x0 && hit[0] <= x1 && hit[1] >= 0 && hit[1] <= top) return 0;
    least = Math.min(least, edge(x0, 0, x1, 0), edge(x1, 0, x1, top), edge(x1, top, x0, top), edge(x0, top, x0, 0));
  }
  return least;
}

/**
 * NAV-EMPTY, a Look's rule (the drives' jogOk's): whether a camera turned from `from` holds the wall as well as `from`
 * does. A front as far in as wallKept's; where `from` shows none, a front anywhere or an axis no further from the
 * fronts (wallAway), so a Look from a bare frame may bring the wall back and never takes it further off.
 */
export function keepsWall(from: Camera, wall: WallLayout): (to: Camera) => boolean {
  const kept = wallKept(from, wall);
  if (kept !== undefined) return (to) => wallShown(to, wall, kept);
  const away = wallAway(from, wall);
  return (to) => wallAway(to, wall) <= away || wallShown(to, wall);
}

/**
 * NAV-EMPTY: the turn a Look commits, from the last one it committed (`from`, which passed `ok`) toward the one asked
 * for (`to`), at `to`'s place: `to` where it passes; else the furthest along the way that passes (halving to
 * PITCH_CAP_STEP), then each axis on alone toward `to` as far as it passes, so a diagonal held on one axis goes on along
 * the other. `from`'s turn where even that fails at `to`'s place.
 */
export function turnKept(from: Pose, to: Pose, ok: (p: Pose) => boolean): Pose {
  if (ok(to)) return to;
  const along = (a: Pose, b: Pose, t: number): Pose => ({ ...b, yaw: a.yaw + (b.yaw - a.yaw) * t, pitch: a.pitch + (b.pitch - a.pitch) * t });
  /** From `a` (passes) toward `b` (fails): the furthest that passes. */
  const furthest = (a: Pose, b: Pose): Pose => {
    const span = Math.max(Math.abs(b.yaw - a.yaw), Math.abs(b.pitch - a.pitch));
    let lo = 0;
    let hi = 1;
    while ((hi - lo) * span > PITCH_CAP_STEP) {
      const mid = (lo + hi) / 2;
      if (ok(along(a, b, mid))) lo = mid;
      else hi = mid;
    }
    return along(a, b, lo);
  };
  let at: Pose = { ...to, yaw: from.yaw, pitch: from.pitch };
  if (!ok(at)) return at;
  at = furthest(at, to);
  for (const axis of ['yaw', 'pitch'] as const) {
    const on = { ...at, [axis]: to[axis] };
    at = ok(on) ? on : furthest(at, on);
  }
  return at;
}

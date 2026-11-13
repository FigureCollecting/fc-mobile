/**
 * NAV-DEPTH-1 (Ross 11-04, 11-13): the depth rocker's maths. A spring-centred rocker is a velocity, not a position:
 * pushed by r in [-1, 1] the eye moves forward (+) or back (-) along its HORIZONTAL heading, never the pitched view (a
 * look down then forward never dives to the floor), faster the farther the rocker goes and the more room lies ahead
 * (fast across a room, slow inches from a display). It moves through the rules a jog moves through: the room and the
 * furniture (slideEye with EYE_MARGIN_MM), the jog's `ok` (the Classic cap and the wall's ends, jogOk) and the GPU
 * budget (fitsCeiling). Pure maths, no DOM.
 */
import type { Vec3 } from './caseCamera';
import type { Box } from './caseFraming';
import { fitsCeiling } from './caseBudget';
import { EYE_MARGIN_MM, JOG_MAX_STEP_MS, slideEye, type Pose } from './casePose';

/** A rocker this far off centre (of 1) or less moves nothing: a resting thumb's wobble. */
export const DEPTH_DEAD = 0.1;
/** At full reach the eye moves this many times the distance ahead a second: an ease in toward what it nears. */
export const DEPTH_RATE_PER_S = 1.5;
/** Full reach's slowest speed (mm/s): the last inches to the margin still close. */
export const DEPTH_MIN_MM_S = 50;
/** Full reach's fastest speed (mm/s): about 13 ft a second across an open room. */
export const DEPTH_MAX_MM_S = 4000;
/** How close (mm of travel) a dolly stopped by its `ok` or the budget finds the last place that passes. */
export const DEPTH_STOP_MM = 1;

/** Where a dolly may take the eye: FreeScene's room and furniture, the jog's `ok`, and the projected cost. */
export interface DollyScene {
  /** Where the eye may be (eyeSpace) and every cabinet's box (cabinetBox): slideEye's room and furniture. */
  readonly space: Box;
  readonly boxes: readonly Box[];
  /** Where the eye may stand (the jog's jogOk: the Classic cap and the wall's ends); absent, anywhere slideEye lets it. */
  readonly ok?: (p: Vec3) => boolean;
  /** The scene's projected cost (Projector's vp, viewports) with the eye at p; absent, no budget. */
  readonly vp?: (p: Vec3) => number;
}

/** The eye's horizontal heading, (sin yaw, 0, -cos yaw): the view's direction with its pitch dropped. */
export function heading(pose: Pose): Vec3 {
  return [Math.sin(pose.yaw), 0, -Math.cos(pose.yaw)];
}

/**
 * The dolly's speed (mm/s, + forward) with the rocker at r and `aheadMm` of room ahead: none within DEPTH_DEAD; past
 * it, the square of the reach to 1 times DEPTH_RATE_PER_S of the distance ahead, that kept to [DEPTH_MIN_MM_S,
 * DEPTH_MAX_MM_S]. Back (r < 0) goes as fast as forward would from the same place.
 */
export function depthSpeed(r: number, aheadMm: number): number {
  const off = Math.abs(r);
  if (!(off > DEPTH_DEAD)) return 0;
  const reach = Math.min(1, (off - DEPTH_DEAD) / (1 - DEPTH_DEAD));
  const far = DEPTH_RATE_PER_S * aheadMm;
  const top = far > DEPTH_MAX_MM_S ? DEPTH_MAX_MM_S : far > DEPTH_MIN_MM_S ? far : DEPTH_MIN_MM_S;
  return Math.sign(r) * reach ** 2 * top;
}

/**
 * How far along heading h from p the ray enters box b grown by EYE_MARGIN_MM: Infinity where it never does, and where p
 * is within it already (slideEye lets the eye out of a box it is in). An eye on its face is there (0).
 */
function entry(p: Vec3, h: Vec3, b: Box): number {
  const m = EYE_MARGIN_MM;
  if (!(p[1] > b.y0 - m && p[1] < b.y1 + m)) return Infinity;
  let t0 = -Infinity;
  let t1 = Infinity;
  for (const [k, lo, hi] of [
    [0, b.x0 - m, b.x1 + m],
    [2, b.z0 - m, b.z1 + m],
  ] as const) {
    if (h[k] === 0) {
      if (!(p[k] > lo && p[k] < hi)) return Infinity;
      continue;
    }
    const a = (lo - p[k]) / h[k];
    const c = (hi - p[k]) / h[k];
    t0 = Math.max(t0, Math.min(a, c));
    t1 = Math.min(t1, Math.max(a, c));
  }
  return t0 >= 0 && t0 < t1 ? t0 : Infinity;
}

/**
 * The horizontal distance (mm) from the eye to the first surface along its heading: the room's walls and every cabinet,
 * measured as slideEye stops the eye (EYE_MARGIN_MM short of them) plus that margin. A box the eye is already within
 * the margin of stops nothing (slideEye lets it out), so it is passed, as slideEye passes it.
 */
export function aheadMm(pose: Pose, space: Box, boxes: readonly Box[]): number {
  const p: Vec3 = [pose.x, pose.y, pose.z];
  const h = heading(pose);
  const wall = (k: 0 | 2, lo: number, hi: number) => (h[k] > 0 ? (hi - p[k]) / h[k] : h[k] < 0 ? (lo - p[k]) / h[k] : Infinity);
  const room = Math.max(0, Math.min(wall(0, space.x0, space.x1), wall(2, space.z0, space.z1)));
  return Math.min(room, ...boxes.map((b) => entry(p, h, b))) + EYE_MARGIN_MM;
}

/**
 * The rocker held at r for dtMs (at most JOG_MAX_STEP_MS: a stalled phone never leaps): the eye moved along its heading
 * by depthSpeed of the room ahead (aheadMm), slid through the room and the furniture (slideEye with EYE_MARGIN_MM). A
 * move `ok` refuses, or whose scene passes the ceiling (fitsCeiling of `vp`), stops at the last place on it that
 * passes, to DEPTH_STOP_MM, never trading the depth for a sideways move as capMove would. A start already over the
 * ceiling (the budget narrowed: a look, a resize) moves only where the cost does not rise, so it is never trapped.
 */
export function dolly(pose: Pose, r: number, dtMs: number, scene: DollyScene): Pose {
  const dt = Math.min(dtMs, JOG_MAX_STEP_MS);
  if (!(dt > 0)) return pose;
  const mm = (depthSpeed(r, aheadMm(pose, scene.space, scene.boxes)) * dt) / 1000;
  if (mm === 0) return pose;
  const from: Vec3 = [pose.x, pose.y, pose.z];
  const [hx, , hz] = heading(pose);
  const at = (t: number): Vec3 => slideEye(from, [pose.x + hx * mm * t, pose.y, pose.z + hz * mm * t], scene.space, scene.boxes, EYE_MARGIN_MM);
  const { ok, vp } = scene;
  const v0 = vp?.(from);
  const fits = v0 === undefined ? undefined : fitsCeiling(v0) ? (p: Vec3) => fitsCeiling(vp!(p)) : (p: Vec3) => vp!(p) <= v0;
  const passes = (p: Vec3) => (ok === undefined || ok(p)) && (fits === undefined || fits(p));
  let lo = 0;
  if (passes(at(1))) lo = 1;
  else {
    let hi = 1;
    while ((hi - lo) * Math.abs(mm) > DEPTH_STOP_MM) {
      const mid = (lo + hi) / 2;
      if (passes(at(mid))) lo = mid;
      else hi = mid;
    }
  }
  const [x, y, z] = at(lo);
  return { ...pose, x, y, z };
}

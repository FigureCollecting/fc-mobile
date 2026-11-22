/**
 * NAV-1A, the Free camera: the camera's pose and every rule that moves it. Ross 10-20 ("ROSS'S CAMERA MODEL"):
 * MOVE trucks and pedestals the eye with its aim travelling, the pitch unchanged; LOOK turns the aim from where it
 * stands. Ross 10-25: the camera turns; nothing traps you; no roll. One pose, changed only by a delta from an input, a
 * command (instant in this slice) or a collision clamp: never a settle, a snap or a retake. Pure maths, no DOM.
 */
import { castRay, rayHitPlane, type Camera, type Vec3 } from './caseCamera';
import { CEILING_CLEARANCE_MM, type Box, type RoomBox } from './caseFraming';

/** The eye (mm, the case's world) and its aim (radians): yaw positive turns right, pitch positive looks down. No roll. */
export interface Pose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly pitch: number;
}

const DEG = Math.PI / 180;

/** Rulings S6: a finger still this long (ms) arms Look; a drag after it turns the eye. */
export const LOOK_HOLD_MS = 250;
/** Spec 2.1: once the finger has moved this far (px) on the axis a drag did not lock to, that axis moves too, for good. */
export const AXIS_UNLOCK_PX = 24;
/**
 * NAV-SWIPE-2X (Ross 11-04: "the amount of walk relative to swipe distance...probably should be 2x as far (at least
 * horizontally)"): a one-finger MOVE drag in the Free camera walks the eye this many times move()'s 1:1 sideways. Applied
 * at the drag alone (useFreeCamera), never in move() or walk(): the jog walks through them at its own speed.
 */
export const DRAG_WALK_GAIN_X = 2;
/** NAV-SWIPE-2X: the same drag's height move, times move()'s 1:1: kept at 1 until Ross says about height. */
export const DRAG_WALK_GAIN_Y = 1;
/** Spec 1.3: how far the eye keeps off every cabinet and the room's walls (mm): a nose and a phone. */
export const EYE_MARGIN_MM = 100;
/** Rulings S9: the lowest the eye goes (mm); the highest is the ceiling less its clearance. */
export const EYE_MIN_MM = 300;
/** Spec 2.1: a MOVE whose finger is on nothing (no front, floor or back wall in front of it) moves at this depth (mm). */
export const ANCHOR_FALLBACK_MM = 2000;
/** Spec 1.5: a look let go past its soft limit eases back to it in this long (ms); at once under reduced motion. */
export const SPRING_MS = 200;
/** Spec 1.4, rulings S8: pitch's soft and hard limits, up and down. */
export const PITCH = { upSoft: 30 * DEG, upHard: 45 * DEG, downSoft: 45 * DEG, downHard: 70 * DEG } as const;
/** Spec 4: Reset view applies once the pose is this far off its framing. */
const RESET_ANGLE = 10 * DEG;
const RESET_MM = 150;

export function poseOf(camera: Camera): Pose {
  return { x: camera.x, y: camera.y, z: camera.z, yaw: camera.yaw ?? 0, pitch: camera.pitch };
}

/** The camera with this pose: its lens and frame kept. */
export function withPose(camera: Camera, pose: Pose): Camera {
  return { ...camera, x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw, pitch: pose.pitch };
}

/**
 * MOVE: a drag of (dxPx, dyPx) trucks the eye along its right, (cos yaw, 0, sin yaw), by -dx d / f, and pedestals it
 * along world y by +dy d / (f cos pitch): the world point at the anchor depth d stays under the finger.
 */
export function move(pose: Pose, dxPx: number, dyPx: number, anchorDepthMm: number, focalPx: number): Pose {
  const k = anchorDepthMm / focalPx;
  const along = -dxPx * k;
  return { ...pose, x: pose.x + along * Math.cos(pose.yaw), y: pose.y + (dyPx * k) / Math.cos(pose.pitch), z: pose.z + along * Math.sin(pose.yaw) };
}

/** LOOK: the finger's bearing at the press (a0, b0: its offsets from the frame centre over f) and now (a1, b1). */
export function look(pose: Pose, a0: number, b0: number, a1: number, b1: number): Pose {
  return { ...pose, yaw: pose.yaw + (Math.atan(a0) - Math.atan(a1)), pitch: pose.pitch + (Math.atan(b1) - Math.atan(b0)) };
}

/** One side of a look's yaw cone (radians, >= 0): where a turn rests (soft) and where its rubber band ends (hard). */
export interface YawSide {
  readonly soft: number;
  readonly hard: number;
}

/**
 * NAV-EMPTY: where a look's pitch rests short of PITCH's soft limits, up (lo) and down (hi), radians: the furthest that
 * still shows the wall from where the eye stands (caseWallView's pitchCap). A side left out is PITCH's.
 */
export interface PitchCap {
  readonly lo?: number;
  readonly hi?: number;
}

/**
 * A look's yaw cone: the realism cone either way, and a side the GPU budget moved in (budgetCone), where it did. With
 * it, the pitch's cap where the place narrows PITCH (NAV-EMPTY).
 */
export interface YawCone extends YawSide {
  readonly left?: YawSide;
  readonly right?: YawSide;
  readonly pitch?: PitchCap;
}

/** NAV-1A (b): how close budgetCone finds the last yaw that fits (radians). */
export const BUDGET_YAW_STEP = 0.25 * DEG;
/** NAV-1A (b): how far apart the yaws budgetCone asks on its way out to the hard limit are (radians). */
export const BUDGET_PROBE_STEP = 5 * DEG;

/** Rulings S8: how far the eye may turn either way. `classicCapRad`: the drawn-cabinet cap (yawCapRad), in Classic. */
export function yawLimits(hFovRad: number, classicCapRad?: number): { soft: number; hard: number } {
  let soft = Math.min(45 * DEG, Math.max(20 * DEG, 70 * DEG - hFovRad / 2));
  let hard = Math.min(soft + 15 * DEG, 60 * DEG);
  if (classicCapRad !== undefined) {
    hard = Math.min(hard, classicCapRad);
    soft = Math.min(soft, hard);
  }
  return { soft, hard };
}

/** Spec 1.5: the shown value `over` past the soft limit: it approaches the hard one, never reaching it. */
export function shown(over: number, soft: number, hard: number): number {
  if (!(over > 0) || !(hard > soft)) return soft;
  return soft + (hard - soft) * (1 - Math.exp(-over / (hard - soft)));
}

/** One axis through its cone: committed never past [lo, hi], shown rubber-banded toward [hardLo, hardHi]. */
export function cone(raw: number, lo: number, hi: number, hardLo: number, hardHi: number): { committed: number; shown: number; past: boolean } {
  if (raw > hi) return { committed: hi, shown: shown(raw - hi, hi, hardHi), past: true };
  if (raw < lo) return { committed: lo, shown: -shown(lo - raw, -lo, -hardLo), past: true };
  return { committed: raw, shown: raw, past: false };
}

/** One axis of a turn's limits: where it rests either way (lo, hi) and where its rubber bands end (hardLo, hardHi). */
interface Span {
  readonly lo: number;
  readonly hi: number;
  readonly hardLo: number;
  readonly hardHi: number;
}

/** An axis's limits for a turn that starts at `at`: widened to it, so a start past a limit is held where it began. */
function spanFrom(at: number, lo: number, hi: number, hardLo: number, hardHi: number): Span {
  const l = Math.min(lo, at);
  const h = Math.max(hi, at);
  return { lo: l, hi: h, hardLo: Math.min(hardLo, l), hardHi: Math.max(hardHi, h) };
}

/**
 * NAV-EMPTY: one way of the pitch's limits, as [soft, hard] angles from level: PITCH's, or where `cap` (that way's
 * PitchCap, as an angle from level) is inside its soft limit, the cap with PITCH's band past it.
 */
function pitchSide(soft: number, hard: number, cap: number | undefined): readonly [number, number] {
  return cap === undefined || cap >= soft ? [soft, hard] : [cap, cap + (hard - soft)];
}

/**
 * Both axes' limits for a turn from `start`: the yaw's cone (a side budgetCone moved in kept to) and the pitch's (PITCH,
 * a side the cone's PitchCap moved in kept to).
 */
function spansOf(start: Pose, limits: YawCone): { yaw: Span; pitch: Span } {
  const l = limits.left ?? limits;
  const r = limits.right ?? limits;
  const lo = limits.pitch?.lo;
  const [up, upHard] = pitchSide(PITCH.upSoft, PITCH.upHard, lo === undefined ? undefined : -lo);
  const [down, downHard] = pitchSide(PITCH.downSoft, PITCH.downHard, limits.pitch?.hi);
  return {
    yaw: spanFrom(start.yaw, -l.soft, r.soft, -l.hard, r.hard),
    pitch: spanFrom(start.pitch, -up, down, -upHard, downHard),
  };
}

/**
 * NAV-LOOKDRIVE: a turn of (dYaw, dPitch) radians from `start` through both cones: the yaw's (yawLimits, a side
 * budgetCone moved in kept to) and the pitch's (PITCH). A turn that begins past a limit (the limits narrowed since: a
 * fold, a walk under the Classic cap) is held where it began, never pulled back. The one limit path of every Look: a
 * finger's on the scene (turn) and a rate's (the hat's Look drive), which adds angles up and so never wraps.
 */
export function turnBy(start: Pose, dYaw: number, dPitch: number, limits: YawCone): { committed: Pose; shown: Pose; past: boolean } {
  const at = spansOf(start, limits);
  const yaw = cone(start.yaw + dYaw, at.yaw.lo, at.yaw.hi, at.yaw.hardLo, at.yaw.hardHi);
  const pitch = cone(start.pitch + dPitch, at.pitch.lo, at.pitch.hi, at.pitch.hardLo, at.pitch.hardHi);
  return {
    committed: { ...start, yaw: yaw.committed, pitch: pitch.committed },
    shown: { ...start, yaw: yaw.shown, pitch: pitch.shown },
    past: yaw.past || pitch.past,
  };
}

/** A look from `start` (look's bearings) through both cones: turnBy of the angles the bearings turn it by. */
export function turn(start: Pose, a0: number, b0: number, a1: number, b1: number, limits: YawCone): { committed: Pose; shown: Pose; past: boolean } {
  return turnBy(start, Math.atan(a0) - Math.atan(a1), Math.atan(b1) - Math.atan(b0), limits);
}

/**
 * NAV-LOOKDRIVE, anti-windup: the turn asked for from `start` after a frame's `step`, each axis on its own: the step
 * added, except that a step outward never takes it past the hard limit (its soft limit and the band's width again),
 * so a hat held against a limit stores nothing up and the first step back moves the view. A turn already asked for past
 * it (taken over from a deeper look) is left where it is, never pulled in.
 */
export function lookWind(start: Pose, dYaw: number, dPitch: number, step: { readonly yaw: number; readonly pitch: number }, limits: YawCone): { dYaw: number; dPitch: number } {
  const at = spansOf(start, limits);
  const wind = (from: number, d: number, by: number, s: Span): number => {
    const v = from + d;
    if (by > 0 && v + by > s.hardHi) return Math.max(v, s.hardHi) - from;
    if (by < 0 && v + by < s.hardLo) return Math.min(v, s.hardLo) - from;
    return d + by;
  };
  return { dYaw: wind(start.yaw, dYaw, step.yaw, at.yaw), dPitch: wind(start.pitch, dPitch, step.pitch, at.pitch) };
}

/** How far past a soft limit a turn was asked for, for its band (`band` wide) to show it `past` the limit: shown, inverted. */
function unshown(past: number, band: number): number {
  if (!(band > 0)) return 0;
  return -band * Math.log(1 - Math.min(past / band, 1 - Number.EPSILON));
}

/**
 * NAV-LOOKDRIVE: the turn from `start` that turnBy shows at (yaw, pitch): inside the cone the aim itself, in a band the
 * turn past the soft limit the band shows there. What a Look that takes over a view drawn mid-ease starts from, so its
 * first frame draws what was drawn. Finite always: an aim at or past a hard limit is the deepest its band shows, and
 * past a limit with no band, the limit.
 */
export function turnRaw(start: Pose, yaw: number, pitch: number, limits: YawCone): { dYaw: number; dPitch: number } {
  const at = spansOf(start, limits);
  const raw = (v: number, s: Span): number => {
    if (v > s.hi) return s.hi + unshown(v - s.hi, s.hardHi - s.hi);
    if (v < s.lo) return s.lo - unshown(s.lo - v, s.lo - s.hardLo);
    return v;
  };
  return { dYaw: raw(yaw, at.yaw) - start.yaw, dPitch: raw(pitch, at.pitch) - start.pitch };
}

/**
 * NAV-LOOKDRIVE: turnRaw for the hat's Look, which stores nothing up (lookWind): the turn that shows (yaw, pitch) in
 * `limits` from `start`. A view deeper in its band than where a held hat rests (the turn asked for past the hard limit)
 * comes in by as far as that side's hard limit closed in since `was`, the cone it was drawn in from its start, and no
 * further than that rest: where the cone closed in (the depth backed the eye away under the Classic cap) it follows
 * the cap, never moved against the thumb by more than the cap closed; where nothing closed in (a Look that took a view
 * over mid-ease, a cone worked out again on a wall with no cap) it stays where it is drawn. A view at or past the hard
 * limit, which no turn shows, comes in to the rest; with no `was`, so does any view deeper than it.
 */
export function lookRaw(start: Pose, yaw: number, pitch: number, limits: YawCone, was?: { readonly start: Pose; readonly limits: YawCone }): { dYaw: number; dPitch: number } {
  const at = spansOf(start, limits);
  const before = was && spansOf(was.start, was.limits);
  const raw = turnRaw(start, yaw, pitch, limits);
  // the view comes in to t (`turned(t)`: the turn that shows it on this axis), no further than the rest
  const kept = (v: number, from: number, d: number, s: Span, b: Span | undefined, turned: (t: number) => number): number => {
    if (from + d > s.hardHi) {
      const t = b ? v - Math.max(0, b.hardHi - s.hardHi) : s.hardHi;
      return t < s.hardHi ? Math.max(turned(t), s.hardHi - from) : s.hardHi - from;
    }
    if (from + d < s.hardLo) {
      const t = b ? v + Math.max(0, s.hardLo - b.hardLo) : s.hardLo;
      return t > s.hardLo ? Math.min(turned(t), s.hardLo - from) : s.hardLo - from;
    }
    return d;
  };
  return {
    dYaw: kept(yaw, start.yaw, raw.dYaw, at.yaw, before?.yaw, (t) => turnRaw(start, t, pitch, limits).dYaw),
    dPitch: kept(pitch, start.pitch, raw.dPitch, at.pitch, before?.pitch, (t) => turnRaw(start, yaw, t, limits).dPitch),
  };
}

/**
 * NAV-LOOKDRIVE: a Look's cone kept inside the realism cone `to` of where the eye has got to (each side's soft and
 * hard limit no further than its): the cone itself where no side is past it. What the depth asks every frame it moves
 * the eye under a hat's Look, between two workings-out of the whole cone (budgetCone's projections).
 */
export function coneIn(cone: YawCone, to: YawSide): YawCone {
  const side = <S extends YawSide>(s: S): S | YawSide => (s.soft <= to.soft && s.hard <= to.hard ? s : { soft: Math.min(s.soft, to.soft), hard: Math.min(s.hard, to.hard) });
  const both = side(cone);
  const left = cone.left && side(cone.left);
  const right = cone.right && side(cone.right);
  if (both === cone && left === cone.left && right === cone.right) return cone;
  return { soft: both.soft, hard: both.hard, ...(left ? { left } : {}), ...(right ? { right } : {}), ...(cone.pitch ? { pitch: cone.pitch } : {}) };
}

/** NAV-LOOKDRIVE: the turn asked for is inside both axes' soft limits by `by` (radians) or more. */
export function turnInside(start: Pose, dYaw: number, dPitch: number, limits: YawCone, by: number): boolean {
  const at = spansOf(start, limits);
  const inside = (v: number, s: Span) => v <= s.hi - by && v >= s.lo + by;
  return inside(start.yaw + dYaw, at.yaw) && inside(start.pitch + dPitch, at.pitch);
}

/**
 * NAV-1A (b), Ross 10-28: one side of the cone kept to `fit`, the last yaw that way whose scene fits the GPU budget: at
 * or past the hard limit, the side as it is; inside it, the cone's band moved in to end at `fit` (its soft limit as far
 * inside it as the cone's is inside its hard one, never past straight), so the turn stops there with the cone's ease.
 */
export function budgetSide(cone: YawSide, fit: number): YawSide {
  if (fit >= cone.hard) return cone;
  const hard = Math.max(0, fit);
  return { soft: Math.max(0, hard - (cone.hard - cone.soft)), hard };
}

/**
 * NAV-1A (b), Ross 10-28: a look's yaw cone kept to the GPU budget, a safety net under the held sharpness (a). Each way,
 * from where the turn starts (straight ahead for a look turned the other way): a start that does not fit goes no further
 * that way; else the yaws BUDGET_PROBE_STEP apart out to the hard limit are asked in turn, and where every one fits the
 * side is the realism cone's. At the first that does not (the cost need not rise steadily with the turn: a peak partway
 * is found though the hard limit fits), the last yaw that fits is found by halving from the yaw before it, to
 * BUDGET_YAW_STEP, and the side ends there (budgetSide). A peak narrower than the probe step can fall between two yaws
 * asked. A start already past the hard limit is turn's to hold.
 */
export function budgetCone(cone: YawSide, startYaw: number, fits: (yaw: number) => boolean): YawCone {
  const side = (sign: 1 | -1): YawSide | undefined => {
    const from = Math.max(0, sign * startYaw);
    if (from >= cone.hard) return undefined;
    if (!fits(sign * from)) return budgetSide(cone, from);
    let lo = from;
    let hi = from;
    for (let k = 1; hi === from; k++) {
      const yaw = Math.min(from + k * BUDGET_PROBE_STEP, cone.hard);
      if (!fits(sign * yaw)) hi = yaw;
      else if (yaw === cone.hard) return undefined;
      else lo = yaw;
    }
    while (hi - lo > BUDGET_YAW_STEP) {
      const mid = (lo + hi) / 2;
      if (fits(sign * mid)) lo = mid;
      else hi = mid;
    }
    return budgetSide(cone, lo);
  };
  const right = side(1);
  const left = side(-1);
  return { soft: cone.soft, hard: cone.hard, ...(left ? { left } : {}), ...(right ? { right } : {}) };
}

/**
 * Spec 1.5: the shown value `elapsedMs` into its ease (out, cubic) back from `from` to the committed `to`. A time before
 * its start (a frame stamped before the lift that began it) is the start: never further out than `from`.
 */
export function springBack(from: number, to: number, elapsedMs: number): number {
  const t = Math.min(1, Math.max(0, elapsedMs) / SPRING_MS);
  return t >= 1 ? to : to + (from - to) * (1 - t) ** 3;
}

/** Where the eye may be: the room (roomBox) shrunk by EYE_MARGIN_MM, from EYE_MIN_MM up to the ceiling less its clearance. */
export function eyeSpace(room: RoomBox, ceilingMm: number): Box {
  return {
    x0: room.x0 + EYE_MARGIN_MM,
    x1: room.x1 - EYE_MARGIN_MM,
    y0: EYE_MIN_MM,
    y1: ceilingMm - CEILING_CLEARANCE_MM,
    z0: room.zBack + EYE_MARGIN_MM,
    z1: room.zFront - EYE_MARGIN_MM,
  };
}

const LO = ['x0', 'y0', 'z0'] as const;
const HI = ['x1', 'y1', 'z1'] as const;
const inBox = (p: readonly number[], b: Box): boolean => [0, 1, 2].every((k) => p[k] > b[LO[k]] && p[k] < b[HI[k]]);

/**
 * Spec 6.4, clamp and slide: the eye from `from` toward `to`, axis by axis (x, then y, then z), inside `room` and outside
 * every box grown by `margin`: a penetrating axis stops at the face, the others keep moving. Never a trap or a jump: a
 * bound the eye is already past (a box it is in) lets it move back, never further.
 */
export function slideEye(from: Vec3, to: Vec3, room: Box, boxes: readonly Box[], margin: number): Vec3 {
  const p = [from[0], from[1], from[2]];
  const grown = boxes.map((b) => ({ x0: b.x0 - margin, x1: b.x1 + margin, y0: b.y0 - margin, y1: b.y1 + margin, z0: b.z0 - margin, z1: b.z1 + margin }));
  const walls = grown.filter((b) => !inBox(p, b));
  for (let k = 0; k < 3; k++) {
    const a = p[k];
    const lo = Math.min(room[LO[k]], a);
    const hi = Math.max(room[HI[k]], a);
    let b = Math.min(hi, Math.max(lo, to[k]));
    for (const w of walls) {
      if (![0, 1, 2].every((j) => j === k || (p[j] > w[LO[j]] && p[j] < w[HI[j]]))) continue;
      if (b > a && w[LO[k]] >= a && w[LO[k]] < b) b = w[LO[k]];
      if (b < a && w[HI[k]] <= a && w[HI[k]] > b) b = w[HI[k]];
    }
    p[k] = b;
  }
  return [p[0], p[1], p[2]];
}

/** The move where `ok` holds; else without its change of depth; else of height too; else none (the Classic cap). */
export function capMove(from: Vec3, to: Vec3, ok: (p: Vec3) => boolean): Vec3 {
  const tries: Vec3[] = [to, [to[0], to[1], from[2]], [to[0], from[1], from[2]]];
  return tries.find(ok) ?? from;
}

/** A MOVE (move) through the room and the furniture (slideEye with EYE_MARGIN_MM), and where `ok` holds (capMove). */
export function walk(pose: Pose, dxPx: number, dyPx: number, anchorDepthMm: number, focalPx: number, room: Box, boxes: readonly Box[], ok?: (p: Vec3) => boolean): Pose {
  const from: Vec3 = [pose.x, pose.y, pose.z];
  const to = move(pose, dxPx, dyPx, anchorDepthMm, focalPx);
  const slid = slideEye(from, [to.x, to.y, to.z], room, boxes, EYE_MARGIN_MM);
  const [x, y, z] = ok ? capMove(from, slid, ok) : slid;
  return { ...pose, x, y, z };
}

/**
 * Spec 2.1: the depth a MOVE pressed at (sx, sy) moves at: of the first the ray through the finger meets of the cabinets'
 * fronts' plane (z = 0, within the wall's x extent), the floor and the back wall; ANCHOR_FALLBACK_MM when it meets none.
 */
export function anchorDepth(camera: Camera, sx: number, sy: number, fronts: { readonly x0: number; readonly x1: number }, zBack: number): number {
  const ray = castRay(camera, sx, sy);
  const front = rayHitPlane(ray, 'z', 0);
  const hits = [front !== null && front.at[0] >= fronts.x0 && front.at[0] <= fronts.x1 ? front : null, rayHitPlane(ray, 'y', 0), rayHitPlane(ray, 'z', zBack)];
  const ts = hits.flatMap((h) => (h === null ? [] : [h.t]));
  return ts.length === 0 ? ANCHOR_FALLBACK_MM : Math.min(...ts);
}

/** Spec 2.1: which of a drag's axes move: the one it locked to, and the other once it has moved AXIS_UNLOCK_PX on it (for good). */
export function axisGate(axis: 'x' | 'y', unlocked: boolean, dxPx: number, dyPx: number): { unlocked: boolean; x: boolean; y: boolean } {
  const open = unlocked || Math.abs(axis === 'x' ? dyPx : dxPx) > AXIS_UNLOCK_PX;
  return { unlocked: open, x: axis === 'x' || open, y: axis === 'y' || open };
}

/** NAV-JOG (Ross 10-28): a thumb offset (px) on the jog under this moves nothing: a tap's wobble. */
export const JOG_DEAD_PX = 8;
/** NAV-JOG: at this offset (px) or more the jog moves at full speed; from the dead zone it grows with the reach (jogSpeed). */
export const JOG_FULL_PX = 64;
/** NAV-JOG: a thumb within this many degrees of an axis moves along that axis only (as a swipe locks to one). */
export const JOG_SNAP_DEG = 20;
/** NAV-JOG: the jog's speed unit, frame widths a second of picture at the anchor depth: Ross's 10-28 top speed. */
export const JOG_FRAMES_PER_S = 1;
/** NAV-JOG: a frame later than this (ms) moves as if this long passed: a stalled phone never leaps. */
export const JOG_MAX_STEP_MS = 100;
/**
 * NAV-2B (Ross 10-31: "1.5-2x" the top speed): full reach moves this many times JOG_FRAMES_PER_S. ?jogmax= tunes it
 * from 1 (the 10-28 jog) to 2 on the device. At 2 a 100 ms frame steps a fifth of a frame, inside the quarter a kept
 * cull holds in hand, so even a re-cull drawn a frame late still covers the frame (caseJog.test).
 */
export const JOG_MAX_X = 2;
/** NAV-2B: the top speed's extra over the square grows as this power of the reach, so the middle stays the 10-28 jog's. */
export const JOG_CURVE_POW = 6;
/** NAV-2B ("more speed gradations"): speeds (JOG_FRAMES_PER_S units) a light tick marks each way; the top speed is one too. */
export const JOG_DETENTS: readonly number[] = [0.5, 1];

/**
 * NAV-2B: the jog's speed (frame widths a second) with the thumb `d` px from where it went down, its top `max` times
 * the 10-28 jog's: none inside JOG_DEAD_PX; past it, of the reach r to JOG_FULL_PX, r^2 + (max - 1) r^6. The square is
 * the 10-28 jog: within 1 % of it to 24 px, 6.25 % faster at half reach, today's top at about 54 px, `max` at full reach.
 */
export function jogSpeed(d: number, max: number = JOG_MAX_X): number {
  if (!(d > JOG_DEAD_PX)) return 0;
  const reach = Math.min(1, (d - JOG_DEAD_PX) / (JOG_FULL_PX - JOG_DEAD_PX));
  return JOG_FRAMES_PER_S * (reach ** 2 + (max - 1) * reach ** JOG_CURVE_POW);
}

/** NAV-2B: the speeds a jog topping out at `max` ticks at, slowest first: JOG_DETENTS under it, and the top itself. */
export function jogDetents(max: number = JOG_MAX_X): number[] {
  return [...JOG_DETENTS.filter((level) => level < max), max].map((level) => level * JOG_FRAMES_PER_S);
}

/**
 * NAV-JOG: the picture travel (px at the anchor depth, the way the thumb points) a jog held at (dxPx, dyPx) from where it
 * went down makes in `dtMs`: jogSpeed of the thumb's distance (top `max`) for at most JOG_MAX_STEP_MS; along one axis
 * when the thumb is within JOG_SNAP_DEG of it.
 */
export function jogStep(dxPx: number, dyPx: number, dtMs: number, frameWidthPx: number, max: number = JOG_MAX_X): { x: number; y: number } {
  const d = Math.hypot(dxPx, dyPx);
  if (d <= JOG_DEAD_PX || !(dtMs > 0)) return { x: 0, y: 0 };
  const px = (jogSpeed(d, max) * frameWidthPx * Math.min(dtMs, JOG_MAX_STEP_MS)) / 1000;
  const angle = Math.atan2(Math.abs(dyPx), Math.abs(dxPx));
  if (angle <= JOG_SNAP_DEG * DEG) return { x: Math.sign(dxPx) * px, y: 0 };
  if (angle >= (90 - JOG_SNAP_DEG) * DEG) return { x: 0, y: Math.sign(dyPx) * px };
  return { x: (dxPx / d) * px, y: (dyPx / d) * px };
}

/** NAV-LOOKDRIVE: the hat's Look speed unit (degrees a second): the square of the reach tops out here, as the jog's at JOG_FRAMES_PER_S. */
export const LOOK_DEG_PER_S = 45;
/** NAV-LOOKDRIVE: full reach turns this many times LOOK_DEG_PER_S (the jog's JOG_MAX_X, for the turn). */
export const LOOK_MAX_X = 2;
/** NAV-LOOKDRIVE: a turn back inside a soft limit by this (radians) arms its tick again: a wobble on the limit ticks once. */
export const LOOK_TICK_BACK = 1 * DEG;
/** NAV-LOOKDRIVE: while the depth moves the eye under a hat's Look, its cone is worked out again at most this often (ms), and once the eye rests. */
export const LOOK_REBASE_MS = 200;

/**
 * NAV-LOOKDRIVE: the hat's Look speed (radians a second) with the thumb `d` px from where it went down: the jog's curve
 * (jogSpeed: its dead zone, its reach to JOG_FULL_PX, r^2 + (max - 1) r^6) in LOOK_DEG_PER_S: about 12 deg/s at half
 * reach, 90 at full.
 */
export function lookSpeed(d: number, max: number = LOOK_MAX_X): number {
  return (LOOK_DEG_PER_S * DEG * jogSpeed(d, max)) / JOG_FRAMES_PER_S;
}

/**
 * NAV-LOOKDRIVE: the turn (radians) a hat's Look held at (dxPx, dyPx) from where the thumb went down makes in `dtMs`:
 * the jog's step (jogStep: its axis snap and its longest frame) at lookSpeed. Thumb right turns right (yaw +), thumb up
 * (dy < 0) looks up (pitch -): a camera stick, where a finger on the scene drags the picture. A `max` that is no
 * number, or below none, is refused for LOOK_MAX_X (it would turn the eye by NaN, or the other way).
 */
export function lookStep(dxPx: number, dyPx: number, dtMs: number, max: number = LOOK_MAX_X): { yaw: number; pitch: number } {
  const step = jogStep(dxPx, dyPx, dtMs, (LOOK_DEG_PER_S * DEG) / JOG_FRAMES_PER_S, max >= 0 ? max : LOOK_MAX_X);
  return { yaw: step.x, pitch: step.y };
}

/** Spec 4, rulings X1: Reset view applies once the pose is off its framing by more than a glance: walking never shows it. */
export function resetApplies(pose: Pose, framing: Pose): boolean {
  return (
    Math.abs(pose.yaw) > RESET_ANGLE ||
    Math.abs(pose.pitch - framing.pitch) > RESET_ANGLE ||
    Math.abs(pose.y - framing.y) > RESET_MM ||
    Math.abs(pose.z - framing.z) > RESET_MM
  );
}

/** Where Reset view takes the pose: the framing, turned straight. */
export function resetTarget(framing: Pose): Pose {
  return { ...framing, yaw: 0 };
}

/**
 * NAV-1A, the Free camera (trial): the camera's pose and every rule that moves it. Ross 10-20 ("ROSS'S CAMERA MODEL"):
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

/**
 * A look from `start` (look's bearings) through both cones: the yaw's (yawLimits) and the pitch's (PITCH). A look that
 * begins past a limit (the limits narrowed since: a fold, a walk under the Classic cap) is held where it began, never
 * pulled back.
 */
export function turn(start: Pose, a0: number, b0: number, a1: number, b1: number, limits: { soft: number; hard: number }): { committed: Pose; shown: Pose; past: boolean } {
  const raw = look(start, a0, b0, a1, b1);
  const side = (at: number, lo: number, hi: number, hardLo: number, hardHi: number, value: number) => {
    const l = Math.min(lo, at);
    const h = Math.max(hi, at);
    return cone(value, l, h, Math.min(hardLo, l), Math.max(hardHi, h));
  };
  const yaw = side(start.yaw, -limits.soft, limits.soft, -limits.hard, limits.hard, raw.yaw);
  const pitch = side(start.pitch, -PITCH.upSoft, PITCH.downSoft, -PITCH.upHard, PITCH.downHard, raw.pitch);
  return {
    committed: { ...start, yaw: yaw.committed, pitch: pitch.committed },
    shown: { ...start, yaw: yaw.shown, pitch: pitch.shown },
    past: yaw.past || pitch.past,
  };
}

/** Spec 1.5: the shown value `elapsedMs` into its ease (out, cubic) back from `from` to the committed `to`. */
export function springBack(from: number, to: number, elapsedMs: number): number {
  const t = Math.min(1, elapsedMs / SPRING_MS);
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

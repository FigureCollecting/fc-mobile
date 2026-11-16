/**
 * NAV-FLAT (Ross 11-15): flat cut-outs seen from the side read as acrylic stands; turned part of the way toward the eye
 * they keep reading as figures. Each figure turns about its own vertical axis (the vertical line through the centre of
 * its picture's plane, at its base's front: the base never moves, rises or sinks) toward where the eye STANDS, projected
 * onto the floor: k x the angle from its front normal to the eye, capped at FIGURE_TURN_CAP_RAD either way, never any
 * pitch or roll. Where the eye looks (the camera's yaw and pitch) turns nothing.
 *
 * A turn that would carry the figure's footprint (and its picture) over its surface's inner back, sides or front edge
 * is cut short for that figure (turnLimits); the figure is never moved to make room. Neighbours need no limit: a turn
 * only narrows a picture across the wall, so two pictures that stood apart stay apart.
 *
 * Pure maths, plus the per-frame writer (applyTurns), which reads no layout: every figure's pivot and limits are worked
 * out when the scene renders.
 */
import type { Camera } from './caseCamera';

/** The View card's choice (kept per device with the other case prefs). */
export type FigureTurn = 'off' | 'subtle' | 'strong';
export const FIGURE_TURNS: readonly FigureTurn[] = ['off', 'subtle', 'strong'];
export const DEFAULT_FIGURE_TURN: FigureTurn = 'subtle';
/** How much of the angle to the eye each setting turns a figure. */
export const FIGURE_TURN_K: Readonly<Record<FigureTurn, number>> = { off: 0, subtle: 0.5, strong: 0.8 };
/** No figure turns further than this either way. */
export const FIGURE_TURN_CAP_RAD = (25 * Math.PI) / 180;

/** The most a figure may turn (radians, >= 0) toward -x (left) and toward +x (right). */
export interface TurnLimits {
  readonly left: number;
  readonly right: number;
}
export const NO_TURN_LIMITS: TurnLimits = { left: FIGURE_TURN_CAP_RAD, right: FIGURE_TURN_CAP_RAD };

/** Where a figure turns about, world mm on the floor plane. */
export interface TurnPivot {
  readonly x: number;
  readonly z: number;
}

/**
 * A figure's yaw (radians about world y; positive turns its front toward +x): k x the angle from its front normal (+z)
 * to the eye's place on the floor, capped, and within its limits. The eye's height, yaw and pitch play no part.
 */
export function figureYaw(eye: Pick<Camera, 'x' | 'z'>, pivot: TurnPivot, k: number, limits: TurnLimits = NO_TURN_LIMITS): number {
  const yaw = k * Math.atan2(eye.x - pivot.x, eye.z - pivot.z);
  const turned = Math.max(-Math.min(FIGURE_TURN_CAP_RAD, limits.left), Math.min(Math.min(FIGURE_TURN_CAP_RAD, limits.right), yaw));
  return turned === 0 ? 0 : turned;
}

/**
 * What turns with a figure, world mm: its pivot (the centre of its picture's plane), its footprint (widthMm across,
 * depthMm behind the plane, centred on the pivot) and its picture's drawn ends along the plane (from the pivot).
 */
export interface TurnBody extends TurnPivot {
  readonly widthMm: number;
  readonly depthMm: number;
  readonly artLeftMm: number;
  readonly artRightMm: number;
}

/** The surface a figure stands on, world mm: its inner sides, its inner back and its front edge. */
export interface TurnBox {
  readonly x0: number;
  readonly x1: number;
  readonly zBack: number;
  readonly zFront: number;
}

const TAU = 2 * Math.PI;
/** A turn this small (radians) shows whether a body on a box edge goes over it at once. */
const AT_ONCE = 1e-6;

/**
 * The first turn t in (0, cap] at which A cos t + B sin t passes C (cap when none does), for an A at or under C. On the
 * edge (A = C) and going over, 0.
 */
function firstOver(a: number, b: number, c: number, cap: number): number {
  const r = Math.hypot(a, b);
  if (r <= c) return cap;
  if (a * Math.cos(AT_ONCE) + b * Math.sin(AT_ONCE) > c) return 0;
  // A cos t + B sin t = R cos(t - alpha): over C on the arc (alpha - beta, alpha + beta)
  const alpha = Math.atan2(b, a);
  const beta = Math.acos(c / r);
  const t = (((alpha - beta) % TAU) + TAU) % TAU;
  return Math.min(cap, t);
}

/**
 * The footprint clamp: how far each way the body may turn before a corner of its footprint or an end of its picture
 * passes an edge of its box. An edge a corner already passes unturned (a figure deeper than its shelf) is held where the
 * corner stands: the turn may not carry it any further over.
 */
export function turnLimits(body: TurnBody, box: TurnBox): TurnLimits {
  const hw = body.widthMm / 2;
  // (u along the plane, n along the front normal) from the pivot
  const corners: (readonly [number, number])[] = [
    [-hw, 0],
    [hw, 0],
    [-hw, -body.depthMm],
    [hw, -body.depthMm],
    [body.artLeftMm, 0],
    [body.artRightMm, 0],
  ];
  let left = FIGURE_TURN_CAP_RAD;
  let right = FIGURE_TURN_CAP_RAD;
  for (const [u, n] of corners) {
    // turned by t: x = px + u cos t + n sin t; z = pz - u sin t + n cos t. Each bound as A cos t + B sin t <= C.
    const bounds: (readonly [number, number, number])[] = [
      [u, n, box.x1 - body.x],
      [-u, -n, body.x - box.x0],
      [n, -u, box.zFront - body.z],
      [-n, u, body.z - box.zBack],
    ];
    for (const [a, b, c] of bounds) {
      const held = Math.max(c, a);
      right = Math.min(right, firstOver(a, b, held, right));
      left = Math.min(left, firstOver(a, -b, held, left));
    }
  }
  return { left, right };
}

const fmt = (v: number): string => {
  const r = Math.round(v * 1e6) / 1e6;
  return Object.is(r, -0) ? '0' : String(r);
};

/**
 * A turn as CSS's own rotate and translate, which apply after an element's transform (its quad's matrix3d, about the
 * scene root's origin, as every face's transform-origin is 0 0 0): a rotation about y by the yaw, then the translate that
 * puts the pivot back where it was. The transform itself is never touched.
 */
export interface TurnStyle {
  readonly rotate: string;
  readonly translate: string;
}

/**
 * The style that turns a figure by `yaw` about the vertical line through its pivot, in a scene drawn at `s` px per mm
 * (world x and z are the scene's CSS x and z): null at 0, so an unturned figure draws exactly as it did.
 */
export function turnStyle(yaw: number, pivotX: number, pivotZ: number, s: number): TurnStyle | null {
  if (yaw === 0) return null;
  const x = pivotX * s;
  const z = pivotZ * s;
  const c = Math.cos(yaw);
  const n = Math.sin(yaw);
  // rotateY takes (x, z) to (x cos + z sin, -x sin + z cos); the translate takes the turned pivot back to the pivot
  return { rotate: `y ${fmt((yaw * 180) / Math.PI)}deg`, translate: `${fmt(x - (x * c + z * n))}px 0px ${fmt(z - (-x * n + z * c))}px` };
}

/** A turn's style as one string, to tell whether it changed ('' for none). */
export const turnKey = (style: TurnStyle | null): string => (style === null ? '' : `${style.rotate}|${style.translate}`);

/** A drawn figure's turning parts (its shadow and its picture), its pivot and limits (from the render), and the turn last written. */
export interface TurnTarget extends TurnPivot {
  readonly parts: readonly HTMLElement[];
  readonly limits: TurnLimits;
  shown: string;
}

/** Writes a turn (none: null) to an element's rotate and translate. */
export function writeTurn(el: HTMLElement, style: TurnStyle | null): void {
  el.style.rotate = style?.rotate ?? '';
  el.style.translate = style?.translate ?? '';
}

/**
 * The per-frame writer: each target turned for this eye, written only where its turn changes (a look, the eye still,
 * writes nothing). Reads no layout. How many figures it wrote.
 */
export function applyTurns(targets: Iterable<TurnTarget>, eye: Pick<Camera, 'x' | 'z'>, k: number, s: number): number {
  let wrote = 0;
  for (const t of targets) {
    const next = turnStyle(figureYaw(eye, t, k, t.limits), t.x, t.z, s);
    const key = turnKey(next);
    if (key === t.shown) continue;
    for (const el of t.parts) writeTurn(el, next);
    t.shown = key;
    wrote++;
  }
  return wrote;
}

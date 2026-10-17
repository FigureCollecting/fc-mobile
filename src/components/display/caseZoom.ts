/**
 * PINCH-1 (Ross 10-16: "look closer and go back to the view's normal quickly and easily"): a photo-style
 * magnification of the case's picture, toward the point pinched. It sits on top of whatever the camera shows
 * and never changes the camera, its centre or the saved view, so a later lens control composes with it: the
 * renderer draws it as one 2D transform on the layer over the camera's frame (zoomTransform).
 *
 * A zoom maps a point of the picture (frame px, its top-left the origin) to the screen: p * k + (x, y). Pure
 * maths: no DOM.
 */
import type { Frame } from './caseCamera';

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Zoom {
  /** The magnification: 1 is the picture as the camera draws it. */
  readonly k: number;
  readonly x: number;
  readonly y: number;
}

export const UNZOOMED: Zoom = { k: 1, x: 0, y: 0 };
/** About 4x: as close as a look closer goes. */
export const ZOOM_MAX = 4;
/** While the fingers are down a pinch may go this far under 1x; let go, it settles back at 1x. */
export const ZOOM_UNDER = 0.8;
/** A pinch let go under this settles at exactly 1x: a picture that looks normal is normal, and shows no chip. */
export const ZOOM_SNAP = 1.05;
/** A double-tap at 1x zooms this much at the tapped point. */
export const ZOOM_DOUBLE_TAP = 2;

export const isZoomed = (z: Zoom): boolean => z.k > 1;

/** The point of the picture the screen shows at p: where a tap there lands in the unzoomed picture. */
export function toPicture(z: Zoom, p: Point): Point {
  return { x: (p.x - z.x) / z.k, y: (p.y - z.y) / z.k };
}

/** Where the picture's point q shows on screen. */
export function toScreen(z: Zoom, q: Point): Point {
  return { x: q.x * z.k + z.x, y: q.y * z.k + z.y };
}

const clamp = (v: number, a: number, b: number): number => Math.min(Math.max(a, b), Math.max(Math.min(a, b), v));

/**
 * Bounded: k within [kMin, ZOOM_MAX]; at 1x and over the picture covers the frame (it never pans past its
 * edges), under 1x it stays inside the frame.
 */
export function clampZoom(z: Zoom, frame: Frame, kMin = 1): Zoom {
  const k = Math.min(ZOOM_MAX, Math.max(kMin, z.k));
  return { k, x: clamp(z.x, 0, frame.width * (1 - k)), y: clamp(z.y, 0, frame.height * (1 - k)) };
}

/** The picture's point under p stays at p, at magnification k. */
function about(z: Zoom, p: Point, at: Point, k: number): Zoom {
  const q = toPicture(z, p);
  return { k, x: at.x - q.x * k, y: at.y - q.y * k };
}

const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * A pinch from `start`, its fingers first at a0 and b0, now at a1 and b1: magnified by how much farther apart
 * they are, the picture's point first under their midpoint now under their midpoint, like a photo viewer.
 */
export function pinchZoom(start: Zoom, a0: Point, b0: Point, a1: Point, b1: Point, frame: Frame): Zoom {
  const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y);
  if (d0 === 0) return start;
  const d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
  const k = Math.min(ZOOM_MAX, Math.max(ZOOM_UNDER, (start.k * d1) / d0));
  return clampZoom(about(start, mid(a0, b0), mid(a1, b1), k), frame, ZOOM_UNDER);
}

/** One finger pans the magnified picture by (dx, dy), up to its edges. */
export function panZoom(z: Zoom, dx: number, dy: number, frame: Frame): Zoom {
  return clampZoom({ k: z.k, x: z.x + dx, y: z.y + dy }, frame);
}

/** k at the screen point p: the picture's point there stays there (a double-tap at 1x). */
export function zoomAt(z: Zoom, p: Point, k: number, frame: Frame): Zoom {
  return clampZoom(about(z, p, p, k), frame);
}

/** Where a gesture lets go: under ZOOM_SNAP, exactly 1x; otherwise as it is, within the edges. */
export function settleZoom(z: Zoom, frame: Frame): Zoom {
  return z.k < ZOOM_SNAP ? UNZOOMED : clampZoom(z, frame);
}

/** The layer's CSS transform (its transform-origin the frame's top-left); none at 1x. */
export function zoomTransform(z: Zoom): string {
  return z.k === 1 && z.x === 0 && z.y === 0 ? '' : `translate(${z.x}px, ${z.y}px) scale(${z.k})`;
}

/**
 * CSS's `ease-out`, cubic-bezier(0, 0, 0.58, 1): how far along a glide is a fraction t of the way through its time
 * (the curve the way back had as a CSS transition).
 */
export function easeOut(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const bezier = (a: number, b: number, u: number): number => 3 * (1 - u) * (1 - u) * u * a + 3 * (1 - u) * u * u * b + u * u * u;
  // the parameter u at which the curve's x is t, by bisection (x rises with u)
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const u = (lo + hi) / 2;
    if (bezier(0, 0.58, u) < t) lo = u;
    else hi = u;
  }
  return bezier(0, 1, (lo + hi) / 2);
}

/** The zoom a fraction t of the way through a glide from `from` to `to`: each of k and the offsets eased the same way. */
export function glideZoom(from: Zoom, to: Zoom, t: number): Zoom {
  const e = easeOut(t);
  if (e === 1) return to;
  return { k: from.k + (to.k - from.k) * e, x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
}

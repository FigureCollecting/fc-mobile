/**
 * CARD-VIEW-1 (Ross 10-25: "not every card view had zoom available"): the zoom of a card's picture where PhotoSwipe is
 * not (the side pane, the figure page). The picture is laid out whole in its frame (object-fit: contain, bars where its
 * shape differs from the frame's); a zoom maps a frame point p to the screen as p * k + (x, y), drawn as one transform
 * on the picture about the frame's top-left. Zoomed, the picture is held so it fills the frame along an axis it is
 * longer on and centred along one it is shorter on, as PhotoSwipe holds its own. Pure maths: no DOM.
 */

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Box extends Point, Size {}

export interface ImageZoom {
  /** The magnification: 1 is the picture laid out whole. */
  readonly k: number;
  readonly x: number;
  readonly y: number;
}

export const UNZOOMED: ImageZoom = { k: 1, x: 0, y: 0 };
/** As close as a look goes (PhotoSwipe's maxZoomLevel in the viewer). */
export const IMAGE_ZOOM_MAX = 4;
/** One zoom step: the double-tap's, the zoom control's (PhotoSwipe's secondaryZoomLevel in the viewer). */
export const IMAGE_ZOOM_STEP = 2;
/** While fingers are down a pinch may go this far under 1x; let go, it settles back at 1x. */
export const IMAGE_ZOOM_UNDER = 0.8;
/** A pinch let go under this settles at exactly 1x. */
export const IMAGE_ZOOM_SNAP = 1.05;

/** Where object-fit: contain lays a picture of `natural` size in the frame; a picture of no known size fills it. */
export function containBox(frame: Size, natural: Size): Box {
  if (natural.width <= 0 || natural.height <= 0) return { x: 0, y: 0, width: frame.width, height: frame.height };
  const s = Math.min(frame.width / natural.width, frame.height / natural.height);
  const width = natural.width * s;
  const height = natural.height * s;
  return { x: (frame.width - width) / 2, y: (frame.height - height) / 2, width, height };
}

/** One axis: the zoomed picture's leading edge held so it covers a frame it is longer than, centred in one it is not. */
function holdEdge(edge: number, area: number, size: number): number {
  if (size <= area) return (area - size) / 2;
  return Math.min(0, Math.max(area - size, edge));
}

/** Bounded: k within [kMin, IMAGE_ZOOM_MAX]; the picture held to the frame (holdEdge) on both axes. */
export function clampImageZoom(z: ImageZoom, frame: Size, natural: Size, kMin = 1): ImageZoom {
  const k = Math.min(IMAGE_ZOOM_MAX, Math.max(kMin, z.k));
  if (k === 1) return UNZOOMED;
  const box = containBox(frame, natural);
  const x = holdEdge(box.x * k + z.x, frame.width, box.width * k) - box.x * k;
  const y = holdEdge(box.y * k + z.y, frame.height, box.height * k) - box.y * k;
  return { k, x, y };
}

/** The picture's point under the frame point p stays at `at`, at magnification k. */
function about(z: ImageZoom, p: Point, at: Point, k: number): ImageZoom {
  const qx = (p.x - z.x) / z.k;
  const qy = (p.y - z.y) / z.k;
  return { k, x: at.x - qx * k, y: at.y - qy * k };
}

/** k at the frame point p: the picture's point there stays there, as far as the frame allows (a double-tap). */
export function zoomAtPoint(z: ImageZoom, p: Point, k: number, frame: Size, natural: Size): ImageZoom {
  return clampImageZoom(about(z, p, p, k), frame, natural);
}

/**
 * A pinch from `start`, its fingers first at a0 and b0, now at a1 and b1: magnified by how much farther apart they are,
 * the picture's point first under their midpoint now under their midpoint.
 */
export function pinchImageZoom(start: ImageZoom, a0: Point, b0: Point, a1: Point, b1: Point, frame: Size, natural: Size): ImageZoom {
  const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y);
  if (d0 === 0) return start;
  const d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
  const k = Math.min(IMAGE_ZOOM_MAX, Math.max(IMAGE_ZOOM_UNDER, (start.k * d1) / d0));
  const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
  const m1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
  const z = about(start, m0, m1, k);
  // under 1x (only while the fingers are down) the picture shrinks about the frame's middle
  return k < 1 ? { k, x: (frame.width * (1 - k)) / 2, y: (frame.height * (1 - k)) / 2 } : clampImageZoom(z, frame, natural);
}

/** One finger pans a zoomed picture by (dx, dy), up to its edges. */
export function panImageZoom(z: ImageZoom, dx: number, dy: number, frame: Size, natural: Size): ImageZoom {
  return clampImageZoom({ k: z.k, x: z.x + dx, y: z.y + dy }, frame, natural);
}

/** Where a gesture lets go: under IMAGE_ZOOM_SNAP exactly 1x, otherwise as it is, held to the frame. */
export function settleImageZoom(z: ImageZoom, frame: Size, natural: Size): ImageZoom {
  return z.k < IMAGE_ZOOM_SNAP ? UNZOOMED : clampImageZoom(z, frame, natural);
}

/** The picture's CSS transform (its transform-origin the frame's top-left); none at 1x. */
export function imageZoomTransform(z: ImageZoom): string {
  return z.k === 1 && z.x === 0 && z.y === 0 ? '' : `translate(${z.x}px, ${z.y}px) scale(${z.k})`;
}

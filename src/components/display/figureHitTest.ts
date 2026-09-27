import { alphaMaskDrawnIn, getAlphaMask } from './alphaMargin';

/**
 * Which figure a tap in the case belongs to: the nearest figure DRAWN at the
 * tapped pixel. The browser hit-tests boxes, so a figure standing in front
 * of another takes taps on its transparent surroundings, including pixels
 * where the user sees the figure behind it. Framed photos and silhouettes
 * take pointer events only on their drawn part (CSS), so the browser
 * already gets those right; a matted figure's image box is mostly
 * transparent, so its tap is checked against the image's alpha mask.
 *
 * Depth: the browser's own hit (a click's target) honours the case's 3D
 * depth, but elementsFromPoint lists a 3D case's elements in page order,
 * not depth order (Chromium: last in the page first). So the figure the
 * browser hit is asked first, and the others are ranked by their depth.
 */

/**
 * Half the side of the square read as the pixel under the finger, in CSS
 * px: a click reports whole pixels, up to half a pixel off the finger, so a
 * gap in the art narrower than a pixel never swallows a tap.
 */
export const TAP_POINT_PX = 0.5;

/**
 * Half the side of the square read when no figure is drawn under the
 * finger: the art's outermost pixel ring and narrow gaps in it, and a
 * pressed figure shrinking 1.5 % (.shelf-figure:active) away from the
 * finger, still take the tap.
 */
export const TAP_SLOP_PX = 1.5;

export interface ClientBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Where client point (x, y) falls on an image drawn with object-fit: contain
 * and object-position: bottom (centred across) in `box`, as fractions of the
 * image across and down (outside 0..1 off the image); null when the image or
 * the box has no size.
 */
export function imageFraction(
  box: ClientBox,
  naturalWidth: number,
  naturalHeight: number,
  x: number,
  y: number,
): { u: number; v: number } | null {
  if (naturalWidth <= 0 || naturalHeight <= 0 || box.width <= 0 || box.height <= 0) return null;
  const scale = Math.min(box.width / naturalWidth, box.height / naturalHeight);
  const drawnWidth = naturalWidth * scale;
  const drawnHeight = naturalHeight * scale;
  return {
    u: (x - (box.left + (box.width - drawnWidth) / 2)) / drawnWidth,
    v: (y - (box.top + box.height - drawnHeight)) / drawnHeight,
  };
}

/** Where a figure is drawn relative to a point: under it, only within TAP_SLOP_PX of it, or neither. */
const UNDER = 0;
const NEAR = 1;
const NOWHERE = 2;

/** Where figure `button` is drawn relative to client point (x, y). */
function reach(button: Element, x: number, y: number): number {
  const img = button.querySelector<HTMLImageElement>('img.shelf-figure__img:not(.shelf-figure__img--photo)');
  if (!img) return UNDER; // framed or silhouette: the browser hit its drawn part
  const mask = getAlphaMask(img.getAttribute('src') ?? '');
  const box = img.getBoundingClientRect();
  const drawnWithin = (r: number) => {
    const from = imageFraction(box, img.naturalWidth, img.naturalHeight, x - r, y - r);
    const to = imageFraction(box, img.naturalWidth, img.naturalHeight, x + r, y + r);
    // Not measured yet, unreadable, or not decoded: its box, as before.
    return !mask || !from || !to || alphaMaskDrawnIn(mask, from.u, from.v, to.u, to.v);
  };
  if (drawnWithin(TAP_POINT_PX)) return UNDER;
  return drawnWithin(TAP_SLOP_PX) ? NEAR : NOWHERE;
}

/** A figure's depth in the case (--fig-z, px; larger is nearer the viewer). */
function depth(button: HTMLElement): number {
  return parseFloat(button.style.getPropertyValue('--fig-z')) || 0;
}

/** Whether figure `a` is drawn over figure `b`: nearer the viewer, or as
 *  near and later in the page (painted over it). */
function inFront(a: HTMLElement, b: HTMLElement): boolean {
  const za = depth(a);
  const zb = depth(b);
  if (za !== zb) return za > zb;
  return (b.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/**
 * The figure drawn at client point (x, y) nearest the viewer, or null: one
 * drawn under the point, else one drawn within TAP_SLOP_PX of it. `hit` is
 * the figure the browser's own hit test chose there, which is in front of
 * every other figure at the point.
 */
export function figureAt(
  doc: Pick<Document, 'elementsFromPoint'>,
  x: number,
  y: number,
  hit: HTMLElement | null = null,
): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestReach = NOWHERE;
  if (hit) {
    bestReach = reach(hit, x, y);
    if (bestReach === UNDER) return hit;
    if (bestReach === NEAR) best = hit;
  }
  const asked = new Set<Element>(hit ? [hit] : []);
  for (const el of doc.elementsFromPoint(x, y)) {
    const button = el.closest<HTMLElement>('.shelf-figure');
    if (!button || asked.has(button)) continue;
    asked.add(button);
    const r = reach(button, x, y);
    if (r < bestReach || (r === bestReach && r !== NOWHERE && best !== hit && inFront(button, best!))) {
      best = button;
      bestReach = r;
    }
  }
  return best;
}

/**
 * The figure a click that landed on figure `own` selects. A tap resolves by
 * its point (possibly to another figure, or to none), with `own` (the
 * browser's hit) asked first. Keyboard, assistive and other synthetic
 * activation carries no pointer position (detail 0, or the point 0, 0) and
 * stays on `own`.
 */
export function tapTarget(own: HTMLElement, event: Pick<MouseEvent, 'detail' | 'clientX' | 'clientY'>): HTMLElement | null {
  const doc = own.ownerDocument;
  if (positionless(event) || typeof doc.elementsFromPoint !== 'function') return own;
  return figureAt(doc, event.clientX, event.clientY, own);
}

/** Keyboard, assistive and other synthetic activation: no pointer position (detail 0, or the point 0, 0). */
function positionless(event: Pick<MouseEvent, 'detail' | 'clientX' | 'clientY'>): boolean {
  return event.detail === 0 || (event.clientX === 0 && event.clientY === 0);
}

/**
 * The figure a click anywhere in the case selects; `target` is the element
 * the browser sent it to. A click on a figure goes by tapTarget. A pointer
 * click on a shelf row or bay resolves by its point: the browser sends a
 * click there when it was pressed on one element and released on another
 * (a pressed figure shrinks off the finger, .shelf-figure:active), their
 * common parent. Any other click, such as one on the shelf's front edge
 * (drawn over the bottom of the figures nearest the front), selects nothing.
 */
export function caseTapTarget(target: Element, event: Pick<MouseEvent, 'detail' | 'clientX' | 'clientY'>): HTMLElement | null {
  const own = target.closest<HTMLElement>('.shelf-figure');
  if (own) return tapTarget(own, event);
  const doc = target.ownerDocument;
  if (!target.matches('.case__row, .case__bay') || positionless(event) || typeof doc.elementsFromPoint !== 'function') {
    return null;
  }
  return figureAt(doc, event.clientX, event.clientY);
}

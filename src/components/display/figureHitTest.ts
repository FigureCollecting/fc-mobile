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
 * Half the side of the square a tap is read over, in CSS px: a click
 * reports whole pixels (up to half a pixel off) and a pressed figure
 * shrinks by 1.5 % (.shelf-figure:active), so a gap in the art narrower
 * than a pixel never swallows a tap.
 */
export const TAP_SLOP_PX = 1;

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

/** Whether figure `button` draws within TAP_SLOP_PX of client point (x, y). */
function drawsAt(button: Element, x: number, y: number): boolean {
  const img = button.querySelector<HTMLImageElement>('img.shelf-figure__img:not(.shelf-figure__img--photo)');
  if (!img) return true; // framed or silhouette: the browser hit its drawn part
  const mask = getAlphaMask(img.getAttribute('src') ?? '');
  const box = img.getBoundingClientRect();
  const from = imageFraction(box, img.naturalWidth, img.naturalHeight, x - TAP_SLOP_PX, y - TAP_SLOP_PX);
  const to = imageFraction(box, img.naturalWidth, img.naturalHeight, x + TAP_SLOP_PX, y + TAP_SLOP_PX);
  // Not measured yet, unreadable, or not decoded: its box, as before.
  if (!mask || !from || !to) return true;
  return alphaMaskDrawnIn(mask, from.u, from.v, to.u, to.v);
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
 * The figure drawn at client point (x, y) nearest the viewer, or null.
 * `hit` is the figure the browser's own hit test chose there, which is in
 * front of every other figure at the point.
 */
export function figureAt(
  doc: Pick<Document, 'elementsFromPoint'>,
  x: number,
  y: number,
  hit: HTMLElement | null = null,
): HTMLElement | null {
  if (hit && drawsAt(hit, x, y)) return hit;
  let best: HTMLElement | null = null;
  const asked = new Set<Element>(hit ? [hit] : []);
  for (const el of doc.elementsFromPoint(x, y)) {
    const button = el.closest<HTMLElement>('.shelf-figure');
    if (!button || asked.has(button)) continue;
    asked.add(button);
    if ((!best || inFront(button, best)) && drawsAt(button, x, y)) best = button;
  }
  return best;
}

function contains(el: Element, x: number, y: number): boolean {
  const r = el.getBoundingClientRect();
  return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
}

/**
 * The figure a click that landed on figure `own` selects. A tap resolves by
 * its point (possibly to another figure, or to none), with `own` (the
 * browser's hit) asked first; keyboard or assistive
 * activation carries no pointer position (detail 0, or a point outside the
 * element it landed on) and stays on `own`.
 */
export function tapTarget(
  own: HTMLElement,
  event: Pick<MouseEvent, 'detail' | 'clientX' | 'clientY' | 'target'>,
): HTMLElement | null {
  const doc = own.ownerDocument;
  const landed = event.target instanceof Element ? event.target : own;
  if (event.detail === 0 || typeof doc.elementsFromPoint !== 'function' || !contains(landed, event.clientX, event.clientY)) {
    return own;
  }
  return figureAt(doc, event.clientX, event.clientY, own);
}

/**
 * Dragging a pull-up card (SHEETS-FB1, Ross's Fold8 session 10-14).
 *
 * The bug this replaces: framer-motion's drag listened on the WHOLE card. A finger on the card's scrolling
 * contents started a card drag and, a few moves later, the browser took the same touch as a scroll and
 * cancelled the pointer; framer ended the drag on that pointercancel with a momentum (decay) animation off the
 * few samples it had, and nothing put the card back on a detent, so it crept for seconds, off its detent, and
 * a drag on the handle waited behind that animation.
 *
 * Here the two inputs never fight:
 * - the handle (any part of the card outside its contents) takes pointers: past a small slop the card follows
 *   the finger, stopping any settle where it stands, so the handle works mid-animation;
 * - the contents scroll natively; their touch moves are read to hand off: a finger pulling down once the
 *   contents are at their top (or pushing up while the card is below its top detent) moves the card at finger
 *   speed from that point, cancelling the browser's scroll where it still can.
 * A release settles on the detent nearest to where the release velocity projects, in one short animation
 * (SETTLE_MS), or closes when that is past the midpoint to off screen.
 * A drag is never also a tap: the browser still sends a click for a finger that moved less than its own tap
 * slop (about 15 px in Chromium, 8 dp on Android), which on the handle would undo the drag; that click is
 * swallowed before it reaches anything on the card. Only that one: a pointer's click (detail 1 and up) within
 * CLICK_AFTER_DRAG_MS of the lift. A click no pointer made (Enter or Space on a focused control, an assistive
 * activation: detail 0) is always the user's, and so is any click later than that.
 */

/** What moves the card: its translateY in px. */
export interface SheetDriver {
  get(): number;
  /** Put it there now (a finger moves it). */
  set(y: number): void;
  /** Animate it there in SETTLE_MS. */
  settle(y: number): void;
  /** Halt any animation where the card stands. */
  stop(): void;
  /** Put it there now AND in the page now, before the next paint: the card's contents or size just changed. */
  jump(y: number): void;
}

export interface SheetDragConfig {
  /** Rest positions (translateY px), top-most (smallest) first, measured when asked. */
  detents(): readonly number[];
  /** translateY at which the card is off screen when a drag may close it; null when it may not. */
  closeY(): number | null;
  /** The detent (index) the card is settling on. */
  onSettle(index: number): void;
  onClose(): void;
}

export interface SheetDragController {
  /** Settle on a detent (the last if out of range). */
  settleTo(index: number): void;
  /** The card's contents changed: back on the detent it rests on, measured anew, in the page before the next paint (CARD-FLICKER-1). */
  refit(): void;
  detach(): void;
}

export const SETTLE_MS = 240;
/** How far a pointer moves before it is a drag rather than a tap. */
export const SLOP_PX = 4;
/** The browser's click for a lift comes at once; one later than this after a drag is not the drag's. */
export const CLICK_AFTER_DRAG_MS = 400;
/** Past the top detent the card moves this fraction of the finger. */
export const RUBBER = 0.25;
/** A release is judged where its velocity would carry the card in this long. */
const PROJECT_S = 0.15;
/** Velocity is read over this last stretch of a drag. */
const VELOCITY_WINDOW_MS = 100;

interface Sample {
  t: number;
  y: number;
}

/** Where a release rests: a detent's index, or 'close'. */
export function restFor(y: number, velocity: number, detents: readonly number[], closeY: number | null): number | 'close' {
  const projected = y + velocity * PROJECT_S;
  let best: number | 'close' = 'close';
  let bestDistance = Infinity;
  detents.forEach((d, i) => {
    const distance = Math.abs(projected - d);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  });
  if (closeY !== null && Math.abs(projected - closeY) < bestDistance) return 'close';
  return best;
}

/** The card's position for a finger at `y`: free at or below the top detent, resisting past it. */
export function rubberBand(y: number, top: number): number {
  return y >= top ? y : top - (top - y) * RUBBER;
}

/** px per second over the last VELOCITY_WINDOW_MS of samples; 0 when they do not span any time. */
export function releaseVelocity(samples: readonly Sample[]): number {
  const last = samples.at(-1);
  if (!last) return 0;
  const first = samples.find((s) => s.t >= last.t - VELOCITY_WINDOW_MS)!;
  const dt = last.t - first.t;
  return dt > 0 ? ((last.y - first.y) / dt) * 1000 : 0;
}

export function attachSheetDrag(
  sheet: HTMLElement,
  content: HTMLElement | null,
  driver: SheetDriver,
  config: SheetDragConfig,
): SheetDragController {
  let restIndex: number | null = null;
  // the translateY it last settled on, to tell a resize that moves its detent from one that does not
  let restY = 0;
  // a finger holding the card: its translateY and the finger's y when it took it
  let hold: { base: number; anchor: number; samples: Sample[] } | null = null;
  // a pointer down on the handle, not yet past the slop
  let pending: { id: number; y: number } | null = null;
  // a finger on the contents: undecided until it moves, then scrolling them or holding the card
  let touch: { last: number; mode: 'undecided' | 'scroll' | 'card' } | null = null;
  // when a drag was let go (its lift's event time), until the click the browser may still send for it; that is no tap
  let releasedAt: number | null = null;

  const top = () => config.detents()[0] ?? 0;

  const take = (fingerY: number) => {
    driver.stop();
    hold = { base: driver.get(), anchor: fingerY, samples: [] };
  };

  const follow = (fingerY: number) => {
    const y = rubberBand(hold!.base + fingerY - hold!.anchor, top());
    hold!.samples.push({ t: Date.now(), y });
    driver.set(y);
  };

  const settleTo = (index: number) => {
    const detents = config.detents();
    restIndex = Math.min(index, detents.length - 1);
    restY = detents[restIndex];
    driver.settle(restY);
    config.onSettle(restIndex);
  };

  const release = (at: number) => {
    const held = hold!;
    hold = null;
    releasedAt = at;
    const y = driver.get();
    held.samples.push({ t: Date.now(), y });
    const rest = restFor(y, releaseVelocity(held.samples), config.detents(), config.closeY());
    if (rest === 'close') config.onClose();
    else settleTo(rest);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (pending === null || e.pointerId !== pending.id) return;
    if (hold === null) {
      if (Math.abs(e.clientY - pending.y) < SLOP_PX) return;
      take(e.clientY);
      try {
        sheet.setPointerCapture(e.pointerId);
      } catch {
        /* the pointer is gone already */
      }
    }
    follow(e.clientY);
  };

  const onPointerEnd = (e: PointerEvent) => {
    if (pending === null || e.pointerId !== pending.id) return;
    pending = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerEnd);
    window.removeEventListener('pointercancel', onPointerEnd);
    if (hold !== null) release(e.timeStamp);
  };

  const onPointerDown = (e: PointerEvent) => {
    // a new finger: a click from here on is its own
    releasedAt = null;
    if (e.button !== 0) return;
    // the contents scroll; their own touch moves hand off to the card (below)
    if (content !== null && content.contains(e.target as Node)) return;
    pending = { id: e.pointerId, y: e.clientY };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerEnd);
    window.addEventListener('pointercancel', onPointerEnd);
  };

  const onTouchStart = (e: TouchEvent) => {
    touch = e.touches.length === 1 ? { last: e.touches[0].clientY, mode: 'undecided' } : null;
  };

  const onTouchMove = (e: TouchEvent) => {
    if (touch === null || e.touches.length !== 1) return;
    const y = e.touches[0].clientY;
    const dy = y - touch.last;
    touch.last = y;
    if (touch.mode !== 'card') {
      if (dy === 0) return;
      const home = content!.scrollTop <= 0;
      const pullingHome = dy > 0 && home;
      const raising = dy < 0 && touch.mode === 'undecided' && driver.get() > top() + 0.5;
      if (!pullingHome && !raising) {
        touch.mode = 'scroll';
        return;
      }
      touch.mode = 'card';
      // from where the finger was: this move moves the card too
      take(y - dy);
    }
    if (e.cancelable) e.preventDefault();
    follow(y);
  };

  const onTouchEnd = (e: TouchEvent) => {
    const held = touch?.mode === 'card';
    touch = null;
    if (held && hold !== null) release(e.timeStamp);
  };

  // capturing, so nothing on the card (the handle's own tap) sees the click
  const onClick = (e: MouseEvent) => {
    // no pointer made it (a key, an assistive activation): the user's, whenever it comes
    if (releasedAt === null || e.detail === 0) return;
    const late = e.timeStamp - releasedAt > CLICK_AFTER_DRAG_MS;
    releasedAt = null;
    if (late) return;
    e.preventDefault();
    e.stopPropagation();
  };

  // a turn of the phone, or new contents: back on its detent where that moved, at once and on the screen in that same frame
  const refit = () => {
    if (hold !== null || restIndex === null) return;
    const y = config.detents()[restIndex];
    if (Math.abs(y - restY) < 0.5) return;
    restY = y;
    driver.stop();
    driver.jump(y);
  };
  const onResize = refit;
  const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onResize);
  resized?.observe(sheet);

  sheet.addEventListener('pointerdown', onPointerDown);
  // never taken off: a drag that closes the card detaches it before the click comes, while the card, leaving, is
  // still under the finger; it does nothing until a drag lets go
  sheet.addEventListener('click', onClick, true);
  window.addEventListener('resize', onResize);
  if (content !== null) {
    content.addEventListener('touchstart', onTouchStart, { passive: true });
    content.addEventListener('touchmove', onTouchMove, { passive: false });
    content.addEventListener('touchend', onTouchEnd);
    content.addEventListener('touchcancel', onTouchEnd);
  }

  return {
    settleTo,
    refit,
    detach() {
      sheet.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('resize', onResize);
      resized?.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerEnd);
      window.removeEventListener('pointercancel', onPointerEnd);
      if (content !== null) {
        content.removeEventListener('touchstart', onTouchStart);
        content.removeEventListener('touchmove', onTouchMove);
        content.removeEventListener('touchend', onTouchEnd);
        content.removeEventListener('touchcancel', onTouchEnd);
      }
    },
  };
}
